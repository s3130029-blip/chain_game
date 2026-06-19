import type { BattleConfig, BattleResult } from '../types/battle'
import type { BattleEvent } from '../types/event'
import type { Unit } from '../types/unit'
import type { Position } from '../types/board'
import { DIR_DELTA } from '../types/direction'
import type { Board } from './Board'
import { InitiativeQueue } from './InitiativeQueue'
import { PushResolver } from './PushResolver'
import { TriggerProcessor } from './TriggerProcessor'
import type { TriggerQueueItem } from './TriggerProcessor'
import { VictoryChecker } from './VictoryChecker'
import type { VictoryOutcome } from './VictoryChecker'

export const DEFAULT_CONFIG: BattleConfig = {
  maxTurns: 30,
  maxStepsPerTurn: 200,
}

/**
 * 全モジュールを統合する戦闘エンジンのメインループ。
 *
 * 入力は「両陣営のユニットを配置済みの単一 Board」（tasks.md T12 の設計判断）。
 * 決定論を厳守する（CLAUDE.md §5）:
 *  - 行動順は InitiativeQueue（speed 降順 → 読み順）で毎ラウンド再構築。
 *  - カスケードは TriggerProcessor の FIFO ＋ 読み順安定ソートで解決。
 *  - 乱数・時刻・反復順依存を一切持たない。
 *
 * 1ラウンド = 行動キューを1巡（全ユニットが1回ずつ行動）。`maxTurns` ラウンドで打ち切り、
 * 最終判定（checkEndOfGame）でタイブレークする。コア消失は各行動の直後に検出して即終了する。
 */
export class BattleEngine {
  private readonly config: BattleConfig

  constructor(config: BattleConfig = DEFAULT_CONFIG) {
    this.config = config
  }

  run(board: Board): BattleResult {
    const events: BattleEvent[] = []
    const pushResolver = new PushResolver()
    const queue = new InitiativeQueue(board.getAllUnits())

    // step はイベント表示用の単調増加カウンタ（test-spec §0: 値はアサート対象外）。
    let step = 0
    let round = 0
    let maxChainDepth = 0
    let outcome: VictoryOutcome | null = null

    while (round < this.config.maxTurns && outcome === null) {
      round++
      // ラウンド開始時に現在の盤面で行動順を再構築する（決定論ルール1）。
      queue.reset(board.getAllUnits())
      let stepsThisTurn = 0

      while (queue.hasNext() && outcome === null) {
        const queued = queue.next()
        if (queued === undefined) break

        // キューはラウンド開始時のスナップショット。同ラウンド内で先に撃破された
        // ユニットは盤上にいないためスキップする（決定論的: 状態のみで判断）。
        const acting = board.getUnit(queued.id)
        if (acting === undefined) continue

        events.push({
          step,
          kind: 'turn_start',
          unitId: acting.id,
          metadata: { round, speed: acting.speed },
        })
        step++

        const turnEvents = this.executeTurn(board, pushResolver, acting, step)
        events.push(...turnEvents)
        step += Math.max(turnEvents.length, 1)

        // 連鎖深度の記録用プロキシ: そのターンに発火した反応（trigger_fire）の数。
        const trigFires = turnEvents.reduce(
          (n, e) => (e.kind === 'trigger_fire' ? n + 1 : n),
          0,
        )
        maxChainDepth = Math.max(maxChainDepth, trigFires)
        stepsThisTurn += turnEvents.length

        // 各行動の直後にコア消失を検出 → 最初に消えた側の負けで即終了。
        const coreOutcome = VictoryChecker.checkCoreDestroyed(board)
        if (coreOutcome !== null) {
          outcome = coreOutcome
          break
        }

        // 無限ループ防止ガード: 1ラウンドが step 予算を超えたらラウンドを強制終了する
        // （カスケード自体も TriggerProcessor の MAX_CASCADE_STEPS で別途有界）。
        if (this.guardStep(stepsThisTurn)) break
      }
    }

    // maxTurns 以内に決着がつかなければ最終判定でタイブレーク（生存数→コアHP→総HP→draw）。
    if (outcome === null) outcome = VictoryChecker.checkEndOfGame(board)

    events.push({
      step,
      kind: 'battle_end',
      metadata: { winner: outcome.winner, reason: outcome.reason },
    })

    return {
      winner: outcome.winner,
      reason: outcome.reason,
      totalTurns: round,
      maxChainDepth,
      events,
    }
  }

  /**
   * 1ユニットの行動（move）とそれに続くカスケードを解決し、発生イベントを返す。
   * move で生じた押し/撃破から反応トリガーを spark し、drainCascade で収束させる。
   */
  private executeTurn(
    board: Board,
    pushResolver: PushResolver,
    actingUnit: Unit,
    step: number,
  ): BattleEvent[] {
    const events: BattleEvent[] = []
    const tp = new TriggerProcessor()

    // move 前のスナップショット。盤外撃破された相手の on_destroy が、消える直前の
    // trigger 定義（爆発等）と lastPos を参照できるようにする。
    const before = new Map(board.getAllUnits().map(u => [u.id, u]))

    // 行動ユニットの on_adjacent_enemy（T13）: 自ターン開始時、隣（上下左右）に敵がいれば発火。
    // executeMove より前に判定・enqueue する（magnet/swapper は不動なので移動前後で隣接は不変）。
    this.sparkAdjacentEnemy(board, tp, actingUnit)

    const moveEvents = this.executeMove(board, pushResolver, actingUnit, step)
    events.push(...moveEvents)

    this.sparkMoveReactions(board, tp, actingUnit, moveEvents, before)
    events.push(...tp.drainCascade(board, pushResolver, step))

    return events
  }

  /**
   * 行動ユニットの on_adjacent_enemy トリガーを spark する（T13）。
   * magnet / swapper は自ターン開始時、隣（上下左右4マス）に敵がいる場合に発火する。
   * 判定は executeMove より前に行い、move 由来の反応と同一カスケード（drainCascade）で収束させる。
   */
  private sparkAdjacentEnemy(board: Board, tp: TriggerProcessor, actingUnit: Unit): void {
    const hasAdjacentEnemy = board
      .getAdjacentUnits(actingUnit.position)
      .some(u => u.side !== actingUnit.side)
    if (!hasAdjacentEnemy) return
    for (const trigger of actingUnit.triggers) {
      if (trigger.on === 'on_adjacent_enemy') {
        tp.enqueue({ unit: actingUnit, triggerDef: trigger, context: {} })
      }
    }
  }

  /**
   * 行動ユニットの移動を実行する。
   * MVP では pusher のみが自走する（他種は不動で、効果はトリガー由来）。
   *  - 移動先が盤内かつ空 → 単純移動（unit_move）。
   *  - 移動先が他ユニット or 盤外 → PushResolver で解決（連鎖押し / 盤外撃破）。
   */
  private executeMove(
    board: Board,
    pushResolver: PushResolver,
    unit: Unit,
    step: number,
  ): BattleEvent[] {
    if (unit.type !== 'pusher') return []

    const { dx, dy } = DIR_DELTA[unit.facing]
    const dest: Position = { x: unit.position.x + dx, y: unit.position.y + dy }

    if (board.isInBounds(dest) && board.isEmpty(dest)) {
      const from: Position = { ...unit.position }
      board.moveUnit(unit.id, dest)
      return [{ step, kind: 'unit_move', unitId: unit.id, from, to: { ...dest }, dir: unit.facing }]
    }

    return pushResolver.push(board, unit.id, unit.facing, step).events
  }

  /**
   * move で生じたイベントから最初の反応トリガーを TriggerProcessor へ積む。
   *  - 行動ユニット自身: on_move（移動した）/ on_push_other（他を押した）。
   *  - 押されて生存した相手: on_pushed。
   *  - 撃破された相手: on_destroy（爆心は from=lastPos）。
   *
   * on_push_other はここ（BattleEngine）でのみ spark する。drainCascade 内では
   * 再誘発させない設計（TriggerProcessor 参照）なので、pusher の自己連鎖が暴走しない。
   * 同時に生じた相手側の反応は enqueue 前に読み順で安定ソートする（決定論ルール2）。
   */
  private sparkMoveReactions(
    board: Board,
    tp: TriggerProcessor,
    actingUnit: Unit,
    moveEvents: readonly BattleEvent[],
    before: Map<string, Unit>,
  ): void {
    interface Pending {
      unit: Unit
      pos: Position
      eventKind: 'on_pushed' | 'on_destroy'
      context: TriggerQueueItem['context']
    }
    const pending: Pending[] = []
    let pushedOthers = false

    for (const ev of moveEvents) {
      if (ev.unitId === undefined) continue

      if (ev.kind === 'unit_move' || ev.kind === 'unit_push') {
        // 行動ユニット自身の移動は「押された」ではない（on_move は後段で扱う）。
        if (ev.unitId === actingUnit.id) continue
        pushedOthers = true
        const live = board.getUnit(ev.unitId)
        // 同じ押し連鎖の後段で撃破された場合は on_destroy 側で処理されるためスキップ。
        if (live === undefined) continue
        const context: TriggerQueueItem['context'] = { pushedBy: actingUnit.id }
        if (ev.dir !== undefined) context.dir = ev.dir
        pending.push({ unit: live, pos: live.position, eventKind: 'on_pushed', context })
      } else if (ev.kind === 'unit_destroy') {
        if (ev.unitId !== actingUnit.id) pushedOthers = true
        const dead = before.get(ev.unitId)
        if (dead === undefined) continue
        const lastPos: Position = { ...(ev.from ?? dead.position) }
        const context: TriggerQueueItem['context'] = { sourcePos: lastPos }
        if (ev.dir !== undefined) context.dir = ev.dir
        pending.push({ unit: dead, pos: lastPos, eventKind: 'on_destroy', context })
      }
    }

    // 1. 行動ユニット自身のトリガー（on_move / on_push_other）を先に積む。
    const actingLive = board.getUnit(actingUnit.id)
    if (actingLive !== undefined) {
      const actingMoved = moveEvents.some(
        ev =>
          ev.unitId === actingUnit.id &&
          (ev.kind === 'unit_move' || ev.kind === 'unit_push'),
      )
      for (const trig of actingLive.triggers) {
        if (trig.on === 'on_move' && actingMoved) {
          tp.enqueue({ unit: actingLive, triggerDef: trig, context: {} })
        } else if (trig.on === 'on_push_other' && pushedOthers) {
          tp.enqueue({ unit: actingLive, triggerDef: trig, context: { dir: actingUnit.facing } })
        }
      }
    }

    // 2. 相手側の反応を読み順で積む。
    pending.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)
    for (const p of pending) {
      for (const trig of p.unit.triggers) {
        if (trig.on === p.eventKind) {
          tp.enqueue({ unit: p.unit, triggerDef: trig, context: p.context })
        }
      }
    }
  }

  /** 無限ループ保護: 1ラウンドの step 累積が上限を超えたら true（ラウンド強制終了）。 */
  private guardStep(stepsThisTurn: number): boolean {
    return stepsThisTurn > this.config.maxStepsPerTurn
  }
}
