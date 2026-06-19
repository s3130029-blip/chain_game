import { describe, it, expect } from 'vitest'
import { Board } from '../../src/engine/Board'
import { PushResolver } from '../../src/engine/PushResolver'
import { TriggerProcessor, MAX_CASCADE_STEPS } from '../../src/engine/TriggerProcessor'
import { createUnit } from '../../src/data/unitTemplates'
import type { Unit, TriggerDef, TriggerEventKind } from '../../src/types/unit'
import type { Position } from '../../src/types/board'
import type { BattleEvent } from '../../src/types/event'

// --- local helpers（test-spec §0 / 既存テストと同方針: Board + ローカルヘルパー） ---

function makeBoard(width: number, height: number, units: Unit[]): Board {
  const board = new Board(width, height)
  for (const u of units) board.placeUnit(u)
  return board
}

function posOf(board: Board, id: string): Position | undefined {
  return board.getUnit(id)?.position
}

function isAlive(board: Board, id: string): boolean {
  return board.getUnit(id) !== undefined
}

function kindsOf(events: BattleEvent[]): string[] {
  return events.map(e => e.kind)
}

/** ユニットの指定トリガー定義を取り出す（noUncheckedIndexedAccess 対応）。 */
function trig(unit: Unit, on: TriggerEventKind): TriggerDef {
  const t = unit.triggers.find(td => td.on === on)
  if (t === undefined) throw new Error(`unit ${unit.id} has no trigger ${on}`)
  return t
}

describe('TriggerProcessor', () => {
  // --- tasks.md T10 完了条件1 / TP-01: on_pushed → push_target の1段階トリガー ---
  it('T10-1 / TP-01: reactor の on_pushed が前方ユニットを同方向へ押す', () => {
    const R = createUnit('reactor', 'player', { x: 2, y: 2 }, 'right', 'R')
    const T = createUnit('core', 'enemy', { x: 3, y: 2 }, 'right', 'T') // 前方の不動ダミー
    const board = makeBoard(5, 5, [R, T])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    // R は右へ押されて (2,2) で生存している、という spark を注入する。
    tp.enqueue({ unit: R, triggerDef: trig(R, 'on_pushed'), context: { dir: 'right' } })
    const events = tp.drainCascade(board, pr, 0)

    expect(posOf(board, T.id)).toEqual({ x: 4, y: 2 })
    expect(posOf(board, R.id)).toEqual({ x: 2, y: 2 })
    expect(events.some(e => e.kind === 'unit_push' && e.unitId === T.id)).toBe(true)
  })

  // TP-02: 前方が空なら反応なし（trigger_fire は出るが push は出ない）
  it('T10-2 / TP-02: 前方が空なら反応しない', () => {
    const R = createUnit('reactor', 'player', { x: 2, y: 2 }, 'right', 'R')
    const board = makeBoard(5, 5, [R])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    tp.enqueue({ unit: R, triggerDef: trig(R, 'on_pushed'), context: { dir: 'right' } })
    const events = tp.drainCascade(board, pr, 0)

    expect(events.some(e => e.kind === 'unit_push')).toBe(false)
    expect(posOf(board, R.id)).toEqual({ x: 2, y: 2 })
  })

  // TP-03: 非 reactor は on_pushed に反応しない
  it('T10-3 / TP-03: findResponders は on_pushed 反応ユニットのみ返す', () => {
    const P = createUnit('pusher', 'player', { x: 2, y: 2 }, 'right', 'P')
    const R = createUnit('reactor', 'player', { x: 0, y: 0 }, 'right', 'R')

    expect(TriggerProcessor.findResponders([P], 'on_pushed')).toEqual([])
    expect(TriggerProcessor.findResponders([P, R], 'on_pushed').map(u => u.id)).toEqual([R.id])
  })

  // --- tasks.md T10 完了条件2 / TP-08: 2段階の連鎖（多段ドミノ） ---
  it('T10-4 / TP-08: 押し→reactor 伝播→前方ユニット移動（連鎖段数 ≥ 2）', () => {
    const R = createUnit('reactor', 'player', { x: 2, y: 2 }, 'right', 'R')
    const D = createUnit('core', 'enemy', { x: 4, y: 2 }, 'right', 'D')
    const board = makeBoard(6, 6, [R, D])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    // (1段目) R を右へ押す: (2,2)→(3,2)。続けて on_pushed を spark。
    const spark = pr.push(board, R.id, 'right', 0)
    expect(posOf(board, R.id)).toEqual({ x: 3, y: 2 })

    tp.enqueue({ unit: R, triggerDef: trig(R, 'on_pushed'), context: { dir: 'right' } })
    const cascade = tp.drainCascade(board, pr, 0)

    // (2段目) R の on_pushed が前方の D を右へ押す。
    expect(posOf(board, R.id)).toEqual({ x: 3, y: 2 })
    expect(posOf(board, D.id)).toEqual({ x: 5, y: 2 })

    // 連鎖の流れ: push(R)[spark] → trigger_fire(R) → push(D)[cascade]
    expect(kindsOf(spark.events)).toEqual(['unit_push'])
    expect(kindsOf(cascade)).toEqual(['trigger_fire', 'unit_push'])
    expect(cascade.find(e => e.kind === 'unit_push')?.unitId).toBe(D.id)
  })

  // --- tasks.md T10 完了条件3 / TP-04: on_destroy → explode ---
  it('T10-5 / TP-04: bomber の on_destroy が4近傍を外向きに吹き飛ばす', () => {
    const Bm = createUnit('bomber', 'player', { x: 2, y: 2 }, 'right', 'Bm')
    const d1 = createUnit('core', 'enemy', { x: 1, y: 2 }, 'right', 'd1') // left
    const d2 = createUnit('core', 'enemy', { x: 3, y: 2 }, 'right', 'd2') // right
    const d3 = createUnit('core', 'enemy', { x: 2, y: 1 }, 'right', 'd3') // up
    const d4 = createUnit('core', 'enemy', { x: 2, y: 3 }, 'right', 'd4') // down
    const board = makeBoard(5, 5, [Bm, d1, d2, d3, d4])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    // Bm は撃破済み（盤上から除去）。lastPos=(2,2) を中心に爆発させる。
    board.removeUnit(Bm.id)
    tp.enqueue({ unit: Bm, triggerDef: trig(Bm, 'on_destroy'), context: { sourcePos: { x: 2, y: 2 } } })
    tp.drainCascade(board, pr, 0)

    expect(posOf(board, d1.id)).toEqual({ x: 0, y: 2 })
    expect(posOf(board, d2.id)).toEqual({ x: 4, y: 2 })
    expect(posOf(board, d3.id)).toEqual({ x: 2, y: 0 })
    expect(posOf(board, d4.id)).toEqual({ x: 2, y: 4 })
  })

  // TP-05: 盤外撃破された bomber も lastPos を中心に爆発
  it('T10-6 / TP-05: 盤外撃破された bomber も lastPos を中心に爆発', () => {
    const Bm = createUnit('bomber', 'player', { x: 4, y: 2 }, 'right', 'Bm')
    const D = createUnit('core', 'enemy', { x: 4, y: 1 }, 'right', 'D') // 爆心の上隣
    const board = makeBoard(5, 5, [Bm, D])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    // Bm を右へ押して盤外撃破（lastPos=(4,2)）。
    const r = pr.push(board, Bm.id, 'right', 0)
    expect(isAlive(board, Bm.id)).toBe(false)
    const destroyEv = r.events.find(e => e.kind === 'unit_destroy')
    expect(destroyEv?.from).toEqual({ x: 4, y: 2 })

    tp.enqueue({
      unit: Bm,
      triggerDef: trig(Bm, 'on_destroy'),
      context: { sourcePos: destroyEv?.from ?? { x: 4, y: 2 } },
    })
    tp.drainCascade(board, pr, 0)

    expect(posOf(board, D.id)).toEqual({ x: 4, y: 0 })
  })

  // TP-06: 非 bomber の死亡では爆発しない
  it('T10-7 / TP-06: 非 bomber の死亡では on_destroy 反応がない', () => {
    const P = createUnit('pusher', 'player', { x: 2, y: 2 }, 'right', 'P')
    expect(TriggerProcessor.findResponders([P], 'on_destroy')).toEqual([])
  })

  // --- tasks.md T10 完了条件4 / TP-11: 盤面を離れたユニットのトリガーはスキップ ---
  it('T10-8 / TP-11: 盤外撃破された reactor は on_pushed を発火しない', () => {
    const R = createUnit('reactor', 'enemy', { x: 4, y: 2 }, 'right', 'R') // 右端
    const board = makeBoard(5, 5, [R])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    // R を右へ押して盤外撃破。
    pr.push(board, R.id, 'right', 0)
    expect(isAlive(board, R.id)).toBe(false)

    // 撃破済み R の on_pushed を誤って enqueue しても、drain 時にスキップされる。
    tp.enqueue({ unit: R, triggerDef: trig(R, 'on_pushed'), context: { dir: 'right' } })
    const events = tp.drainCascade(board, pr, 0)

    expect(events).toEqual([])
  })

  // TP-09: 無限ループ防止（上限ガード）。盤端より長く自己 push し続ける looper を用意。
  it('T10-9 / TP-09: 連鎖は MAX_CASCADE_STEPS で打ち切られハングしない', () => {
    const looper: Unit = {
      id: 'L',
      type: 'reactor',
      hp: 1,
      maxHp: 1,
      speed: 1,
      facing: 'right',
      position: { x: 0, y: 0 },
      side: 'player',
      cost: 0,
      // 押されたら自分を同方向へ再 push → 移動 → 再び on_pushed … という循環。
      triggers: [{ on: 'on_pushed', effect: { kind: 'push_self', dir: 'right' } }],
    }
    // 上限までに盤外へ落ちないよう、十分に長い盤を用意する。
    const board = makeBoard(MAX_CASCADE_STEPS + 10, 1, [looper])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    tp.enqueue({ unit: looper, triggerDef: trig(looper, 'on_pushed'), context: { dir: 'right' } })
    const events = tp.drainCascade(board, pr, 0)

    // 上限で確実に打ち切られ、関数は返る（ハング/スタックオーバーフローしない）。
    expect(events.length).toBeGreaterThan(MAX_CASCADE_STEPS)
    expect(events.length).toBeLessThanOrEqual(MAX_CASCADE_STEPS * 2 + 2)
    expect(isAlive(board, looper.id)).toBe(true)
  })

  // TP-10 / TP-14: 連鎖中の死亡が on_destroy を同一カスケード内で発火（爆風で連鎖）
  it('T10-10 / TP-10,TP-14: 連鎖中に bomber が撃破され on_destroy(explode) が同一カスケードで発火', () => {
    const R = createUnit('reactor', 'player', { x: 3, y: 2 }, 'right', 'R')
    const Bm = createUnit('bomber', 'enemy', { x: 4, y: 2 }, 'right', 'Bm') // 右端
    const D = createUnit('core', 'enemy', { x: 4, y: 1 }, 'right', 'D') // Bm の上隣
    const board = makeBoard(5, 5, [R, Bm, D])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    // R は右へ押されて (3,2) で生存している、という spark を注入する。
    tp.enqueue({ unit: R, triggerDef: trig(R, 'on_pushed'), context: { dir: 'right' } })
    const events = tp.drainCascade(board, pr, 0)

    // R が Bm を右へ押す → Bm 盤外撃破 → on_destroy で爆発 → D が上へ。
    expect(isAlive(board, Bm.id)).toBe(false)
    expect(posOf(board, D.id)).toEqual({ x: 4, y: 0 })

    const destroyIdx = events.findIndex(e => e.kind === 'unit_destroy' && e.unitId === Bm.id)
    const explodeFireIdx = events.findIndex(
      e => e.kind === 'trigger_fire' && e.unitId === Bm.id && e.triggerKind === 'on_destroy',
    )
    expect(destroyIdx).toBeGreaterThanOrEqual(0)
    expect(explodeFireIdx).toBeGreaterThan(destroyIdx)
  })

  // TP-12: pull は on_pushed を発火しない
  it('T10-11 / TP-12: pull は on_pushed を発火しない', () => {
    const M = createUnit('magnet', 'player', { x: 2, y: 2 }, 'right', 'M')
    const R = createUnit('reactor', 'enemy', { x: 2, y: 0 }, 'right', 'R')
    const board = makeBoard(5, 5, [M, R])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    tp.enqueue({ unit: M, triggerDef: trig(M, 'on_adjacent_enemy'), context: {} })
    const events = tp.drainCascade(board, pr, 0)

    expect(posOf(board, R.id)).toEqual({ x: 2, y: 1 }) // M 側へ1マス引き寄せ（down）
    expect(posOf(board, M.id)).toEqual({ x: 2, y: 2 }) // M は押されない（on_pushed 不発）
    expect(events.some(e => e.kind === 'unit_push')).toBe(false)
    expect(events.some(e => e.kind === 'unit_move')).toBe(true)
  })

  // TP-07: 反応のないスパークは即収束する
  it('T10-12 / TP-07: 反応のない（空キューの）カスケードは即収束する', () => {
    const board = makeBoard(5, 5, [createUnit('core', 'player', { x: 2, y: 2 }, 'right', 'C')])
    const tp = new TriggerProcessor()
    const pr = new PushResolver()

    expect(tp.drainCascade(board, pr, 0)).toEqual([])
  })
})
