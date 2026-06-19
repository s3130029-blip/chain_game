import type { Unit, TriggerDef, TriggerEffect, TriggerEventKind } from '../types/unit'
import type { Position } from '../types/board'
import type { Direction } from '../types/direction'
import { DIR_DELTA } from '../types/direction'
import type { BattleEvent } from '../types/event'
import type { Board } from './Board'
import type { PushResolver } from './PushResolver'

/**
 * 1手番の連鎖（カスケード）の打ち切り上限。
 * グリッド上の push は単調（必ず盤端へ向かう）ため通常は自然収束するが、
 * 将来エフェクトや病的な構成での無限ループ・スタックオーバーフローを防ぐ安全網。
 * （CLAUDE.md §5「1手番の連鎖は MAX_CASCADE_STEPS で打ち切る」）
 */
export const MAX_CASCADE_STEPS = 1000

export interface TriggerQueueItem {
  unit: Unit
  triggerDef: TriggerDef
  // pushedBy: 押した主体 / dir: 生じた押し方向 / sourcePos: 発生源座標（on_destroy の爆心 lastPos 等）
  context: { pushedBy?: string; dir?: Direction; sourcePos?: Position }
}

/**
 * FIFO キューでトリガーを処理し、連鎖（カスケード）を解決する。
 *
 * 設計（test-spec §2 の挙動を architecture/tasks の現行 API へ翻訳）:
 *  - drainCascade はキューが空になるまで1件ずつトリガーを処理する。
 *  - 各エフェクトが push/destroy を生むと、その結果から次の反応
 *    （生存して押されたユニット → on_pushed、撃破されたユニット → on_destroy）を
 *    enqueue し直して FIFO で連鎖させる。
 *  - on_push_other はここでは自動連鎖させない。これは行動ユニットの move によって
 *    BattleEngine（T12）が spark するトリガーであり、カスケード内で再誘発すると
 *    pusher の自己連鎖が止まらなくなるため。MVP の連鎖伝播は on_pushed / on_destroy が担う。
 */
export class TriggerProcessor {
  private queue: TriggerQueueItem[] = []

  enqueue(item: TriggerQueueItem): void {
    this.queue.push(item)
  }

  /** 指定イベントに反応するトリガーを1つ以上持つユニットを列挙する。 */
  static findResponders(units: Unit[], eventKind: TriggerEventKind): Unit[] {
    return units.filter(u => u.triggers.some(t => t.on === eventKind))
  }

  /**
   * キューが空になるまで全トリガーを処理する。
   * board を直接更新し、全発生イベント（trigger_fire / unit_push / unit_destroy / unit_move）を返す。
   */
  drainCascade(board: Board, pushResolver: PushResolver, step: number): BattleEvent[] {
    const events: BattleEvent[] = []
    let processed = 0

    while (this.queue.length > 0) {
      // 上限ガード: 病的な連鎖を打ち切り、必ず関数が返るようにする（TP-09）。
      if (processed >= MAX_CASCADE_STEPS) break
      processed++

      const item = this.queue.shift()
      if (item === undefined) break
      const { triggerDef } = item

      // 盤面を離れたユニットの「生存中トリガー」はスキップする（TP-11）。
      // ただし on_destroy は撃破後に発火するのが本義なので、盤外でも処理する（TP-04/05）。
      const live = board.getUnit(item.unit.id)
      if (live === undefined && triggerDef.on !== 'on_destroy') continue

      const actor = live ?? item.unit

      events.push({
        step,
        kind: 'trigger_fire',
        unitId: actor.id,
        triggerKind: triggerDef.on,
        effectKind: triggerDef.effect.kind,
      })

      // 撃破されるユニットの定義（triggers/lastPos）を参照するため、効果実行前に控える。
      const before = new Map(board.getAllUnits().map(u => [u.id, u]))
      const effectEvents = this.executeEffect(board, pushResolver, actor, item, step)
      events.push(...effectEvents)
      this.enqueueReactions(board, effectEvents, actor, before)
    }

    // 上限で打ち切った場合に残ったアイテムを次の drain へ漏らさない。
    this.queue = []
    return events
  }

  // --- effect dispatch ---

  private executeEffect(
    board: Board,
    pushResolver: PushResolver,
    actor: Unit,
    item: TriggerQueueItem,
    step: number,
  ): BattleEvent[] {
    const effect = item.triggerDef.effect
    const ctx = item.context
    switch (effect.kind) {
      case 'push_target': return this.pushTarget(board, pushResolver, actor, effect, ctx, step)
      case 'push_self': return this.pushSelf(board, pushResolver, actor, effect, ctx, step)
      case 'pull_nearest': return this.pullNearest(board, actor, step)
      case 'explode': return this.explode(board, pushResolver, actor, item, step)
      case 'swap_adjacent': return this.swapAdjacent(board, actor, step)
      default: {
        // discriminated union の網羅を never で検出（CLAUDE.md §6）。
        const _exhaustive: never = effect.kind
        return _exhaustive
      }
    }
  }

  /**
   * effect.dir を実方向へ解決する。
   *  - 'facing'          → 自分の向き
   *  - 'away_from_self'  → 押された方向（押し主から離れる向き）をそのまま伝播
   *  - リテラル方向       → そのまま
   */
  private resolveDir(effect: TriggerEffect, unit: Unit, context: TriggerQueueItem['context']): Direction {
    const d = effect.dir
    if (d === 'facing') return unit.facing
    if (d === 'away_from_self') return context.dir ?? unit.facing
    if (d !== undefined) return d
    return unit.facing
  }

  /** 進行方向先にいるユニットを同方向へ1マス押す（reactor.on_pushed / pusher.on_push_other）。 */
  private pushTarget(
    board: Board,
    pushResolver: PushResolver,
    actor: Unit,
    effect: TriggerEffect,
    context: TriggerQueueItem['context'],
    step: number,
  ): BattleEvent[] {
    const dir = this.resolveDir(effect, actor, context)
    const { dx, dy } = DIR_DELTA[dir]
    const targetCell: Position = { x: actor.position.x + dx, y: actor.position.y + dy }
    const target = board.getUnitAt(targetCell)
    if (target === undefined) return [] // 前方が空なら反応なし（TP-02）
    return pushResolver.push(board, target.id, dir, step).events
  }

  /** 自ユニットを1マス押す。 */
  private pushSelf(
    board: Board,
    pushResolver: PushResolver,
    actor: Unit,
    effect: TriggerEffect,
    context: TriggerQueueItem['context'],
    step: number,
  ): BattleEvent[] {
    const dir = this.resolveDir(effect, actor, context)
    return pushResolver.push(board, actor.id, dir, step).events
  }

  /**
   * 爆発: 中心（sourcePos=撃破直前の lastPos）の直交近傍を外向きに押す（bomber.on_destroy）。
   * MVP は radius=1 の4近傍。遠い升から押すことで近い升との二重処理を避ける。
   */
  private explode(
    board: Board,
    pushResolver: PushResolver,
    actor: Unit,
    item: TriggerQueueItem,
    step: number,
  ): BattleEvent[] {
    const center = item.context.sourcePos ?? actor.position
    const radius = item.triggerDef.effect.radius ?? 1
    const events: BattleEvent[] = []
    // 読み順に近い決定論的順序（up→left→right→down）で近傍を処理する。
    const dirs: Direction[] = ['up', 'left', 'right', 'down']
    for (const dir of dirs) {
      const { dx, dy } = DIR_DELTA[dir]
      for (let d = radius; d >= 1; d--) {
        const cell: Position = { x: center.x + dx * d, y: center.y + dy * d }
        const u = board.getUnitAt(cell)
        if (u !== undefined) events.push(...pushResolver.push(board, u.id, dir, step).events)
      }
    }
    return events
  }

  /**
   * 最寄り敵を自ユニット側へ1マス引き寄せる（magnet.on_adjacent_enemy）。
   * pull は push ではないため on_pushed を誘発しない（TP-12）。空き升へのみ移動する単純実装。
   */
  private pullNearest(board: Board, actor: Unit, step: number): BattleEvent[] {
    const enemies = board.getAllUnits().filter(u => u.side !== actor.side)
    // 最寄り（マンハッタン距離）、同距離は読み順で安定化。
    const sorted = [...enemies].sort((a, b) => {
      const da = Math.abs(a.position.x - actor.position.x) + Math.abs(a.position.y - actor.position.y)
      const db = Math.abs(b.position.x - actor.position.x) + Math.abs(b.position.y - actor.position.y)
      return da - db || a.position.y - b.position.y || a.position.x - b.position.x
    })
    const target = sorted[0]
    if (target === undefined) return []

    const ddx = actor.position.x - target.position.x
    const ddy = actor.position.y - target.position.y
    let dir: Direction
    if (Math.abs(ddx) >= Math.abs(ddy) && ddx !== 0) dir = ddx > 0 ? 'right' : 'left'
    else if (ddy !== 0) dir = ddy > 0 ? 'down' : 'up'
    else return []

    const { dx, dy } = DIR_DELTA[dir]
    const dest: Position = { x: target.position.x + dx, y: target.position.y + dy }
    if (!board.isInBounds(dest) || !board.isEmpty(dest)) return []

    const from: Position = { ...target.position }
    board.moveUnit(target.id, dest)
    return [{ step, kind: 'unit_move', unitId: target.id, from, to: { ...dest }, dir }]
  }

  /**
   * 隣の敵と自ユニットの座標を入れ替える（swapper.on_adjacent_enemy）。
   * swap は push ではないため on_pushed を誘発しない。
   */
  private swapAdjacent(board: Board, actor: Unit, step: number): BattleEvent[] {
    const target = board.getAdjacentUnits(actor.position).filter(u => u.side !== actor.side)[0]
    if (target === undefined) return []

    const posSelf: Position = { ...actor.position }
    const posTarget: Position = { ...target.position }
    // target を一旦外し、actor を target の升へ、target を actor の旧升へ再配置する。
    board.removeUnit(target.id)
    board.moveUnit(actor.id, posTarget)
    board.placeUnit({ ...target, position: { ...posSelf } })
    return [
      { step, kind: 'unit_move', unitId: actor.id, from: posSelf, to: posTarget },
      { step, kind: 'unit_move', unitId: target.id, from: posTarget, to: posSelf },
    ]
  }

  // --- reaction enqueueing ---

  /**
   * 効果で生じた push/destroy から次のトリガーを enqueue する。
   *  - unit_push（生存移動） → 押されたユニットの on_pushed
   *  - unit_destroy          → 撃破されたユニットの on_destroy（爆心は from=lastPos）
   * 同時に生じた反応は enqueue 前に読み順（y昇順→x昇順）で安定ソートする（決定論ルール2）。
   */
  private enqueueReactions(
    board: Board,
    events: BattleEvent[],
    sourceUnit: Unit,
    before: Map<string, Unit>,
  ): void {
    interface Pending {
      unit: Unit
      pos: Position
      eventKind: TriggerEventKind
      context: TriggerQueueItem['context']
    }
    const pending: Pending[] = []

    for (const ev of events) {
      if (ev.unitId === undefined) continue
      if (ev.kind === 'unit_push') {
        const u = board.getUnit(ev.unitId) // 生存して移動したユニットのみ on_pushed
        if (u === undefined) continue
        const context: TriggerQueueItem['context'] = { pushedBy: sourceUnit.id }
        if (ev.dir !== undefined) context.dir = ev.dir
        pending.push({ unit: u, pos: u.position, eventKind: 'on_pushed', context })
      } else if (ev.kind === 'unit_destroy') {
        const dead = before.get(ev.unitId) // 撃破直前の定義（盤上からは消えている）
        if (dead === undefined) continue
        const lastPos: Position = ev.from ?? dead.position
        const context: TriggerQueueItem['context'] = { sourcePos: lastPos }
        if (ev.dir !== undefined) context.dir = ev.dir
        pending.push({ unit: dead, pos: lastPos, eventKind: 'on_destroy', context })
      }
    }

    pending.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)
    for (const p of pending) {
      for (const trigger of p.unit.triggers) {
        if (trigger.on === p.eventKind) {
          this.enqueue({ unit: p.unit, triggerDef: trigger, context: p.context })
        }
      }
    }
  }
}
