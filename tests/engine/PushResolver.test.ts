import { describe, it, expect } from 'vitest'
import { Board } from '../../src/engine/Board'
import { PushResolver } from '../../src/engine/PushResolver'
import type { Unit, UnitType, Side } from '../../src/types/unit'
import type { Direction } from '../../src/types/direction'
import type { Position } from '../../src/types/board'
import type { BattleEvent } from '../../src/types/event'

function makeUnit(
  id: string,
  x: number,
  y: number,
  opts: { side?: Side; type?: UnitType } = {},
): Unit {
  return {
    id,
    type: opts.type ?? 'pusher',
    hp: 3,
    maxHp: 3,
    speed: 5,
    facing: 'right',
    position: { x, y },
    side: opts.side ?? 'player',
    triggers: [],
    cost: 2,
  }
}

/** 盤面を作り、specs のユニットを配置する。 */
function makeBoard(
  size: number,
  specs: Array<{ id: string; x: number; y: number; type?: UnitType; side?: Side }>,
): Board {
  const board = new Board(size, size)
  for (const s of specs) {
    const opts: { type?: UnitType; side?: Side } = {}
    if (s.type !== undefined) opts.type = s.type
    if (s.side !== undefined) opts.side = s.side
    board.placeUnit(makeUnit(s.id, s.x, s.y, opts))
  }
  return board
}

function posOf(board: Board, id: string): Position | undefined {
  return board.getUnit(id)?.position
}

function isAlive(board: Board, id: string): boolean {
  return board.getUnit(id) !== undefined
}

/** イベント種別を発生順に並べた配列。順序検証用。 */
function kindsOf(events: BattleEvent[]): string[] {
  return events.map(e => e.kind)
}

describe('PushResolver', () => {
  const resolver = new PushResolver()

  // --- tasks.md T09 完了条件: 空きマスへの押し出し → 1マス移動 (PR-01) ---
  it('PR-01: 空き升への単純な押し → 1マス移動', () => {
    const board = makeBoard(5, [{ id: 'X', x: 2, y: 2 }])
    const result = resolver.push(board, 'X', 'right', 0)

    expect(posOf(board, 'X')).toEqual({ x: 3, y: 2 })
    expect(isAlive(board, 'X')).toBe(true)
    expect(result.destroyed).toEqual([])
    expect(result.moved).toEqual([{ unitId: 'X', from: { x: 2, y: 2 }, to: { x: 3, y: 2 } }])
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      kind: 'unit_push',
      unitId: 'X',
      to: { x: 3, y: 2 },
      dir: 'right',
    })
  })

  // PR-02: 4方向の座標符号の正しさ（パラメタライズ）
  it.each<[Direction, Position]>([
    ['up', { x: 2, y: 1 }],
    ['down', { x: 2, y: 3 }],
    ['left', { x: 1, y: 2 }],
    ['right', { x: 3, y: 2 }],
  ])('PR-02: %s 方向に押すと座標が正しく変化する', (dir, expected) => {
    const board = makeBoard(5, [{ id: 'X', x: 2, y: 2 }])
    resolver.push(board, 'X', dir, 0)
    expect(posOf(board, 'X')).toEqual(expected)
  })

  // PR-03: 連続呼び出しで2マス移動（push() は1マスのみ、多マスは反復）
  it('PR-03: 連続 push で2マス移動', () => {
    const board = makeBoard(5, [{ id: 'X', x: 1, y: 2 }])

    const r1 = resolver.push(board, 'X', 'right', 0)
    expect(posOf(board, 'X')).toEqual({ x: 2, y: 2 })
    expect(kindsOf(r1.events)).toEqual(['unit_push'])

    const r2 = resolver.push(board, 'X', 'right', 0)
    expect(posOf(board, 'X')).toEqual({ x: 3, y: 2 })
    expect(kindsOf(r2.events)).toEqual(['unit_push'])

    expect(isAlive(board, 'X')).toBe(true)
  })

  // --- tasks.md T09 完了条件: A→盤外 → A が撃破 (PR-04) ---
  it('PR-04: 盤外へ押されて撃破', () => {
    const board = makeBoard(5, [{ id: 'X', x: 4, y: 2 }])
    const result = resolver.push(board, 'X', 'right', 0)

    expect(isAlive(board, 'X')).toBe(false)
    expect(board.getUnitAt({ x: 4, y: 2 })).toBeUndefined()
    expect(result.destroyed).toEqual(['X'])
    expect(result.moved).toEqual([])
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      kind: 'unit_destroy',
      unitId: 'X',
      from: { x: 4, y: 2 },
    })
    expect(result.events[0]?.metadata?.cause).toBe('offBoard')
  })

  // PR-05: 端到達 → 次の push で盤外撃破（旧「距離2」を再構成）
  it('PR-05: 端到達後の push で盤外撃破', () => {
    const board = makeBoard(5, [{ id: 'X', x: 3, y: 2 }])

    const r1 = resolver.push(board, 'X', 'right', 0)
    expect(posOf(board, 'X')).toEqual({ x: 4, y: 2 })
    expect(kindsOf(r1.events)).toEqual(['unit_push'])

    const r2 = resolver.push(board, 'X', 'right', 0)
    expect(isAlive(board, 'X')).toBe(false)
    expect(r2.destroyed).toEqual(['X'])
    expect(r2.events).toHaveLength(1)
    expect(r2.events[0]).toMatchObject({
      kind: 'unit_destroy',
      unitId: 'X',
      from: { x: 4, y: 2 },
    })
    expect(r2.events[0]?.metadata?.cause).toBe('offBoard')
  })

  // --- tasks.md T09 完了条件: A→B→空き の連鎖押し → A と B が移動 (PR-06) ---
  it('PR-06: 連鎖押し（前方に空きあり）→ 前方先行のイベント順', () => {
    const board = makeBoard(5, [
      { id: 'X', x: 1, y: 2 },
      { id: 'Y', x: 2, y: 2 },
    ])
    const result = resolver.push(board, 'X', 'right', 0)

    expect(posOf(board, 'Y')).toEqual({ x: 3, y: 2 })
    expect(posOf(board, 'X')).toEqual({ x: 2, y: 2 })
    expect(isAlive(board, 'X')).toBe(true)
    expect(isAlive(board, 'Y')).toBe(true)
    // 前方（Y）の push が先、後方（X）の push が後。
    expect(result.events.map(e => e.unitId)).toEqual(['Y', 'X'])
    expect(kindsOf(result.events)).toEqual(['unit_push', 'unit_push'])
  })

  // --- tasks.md T09 完了条件: A→B→盤外 → B が撃破、A が移動 (PR-07) ---
  it('PR-07: 連鎖押しの先頭が盤外撃破', () => {
    const board = makeBoard(5, [
      { id: 'X', x: 3, y: 2 },
      { id: 'Y', x: 4, y: 2 },
    ])
    const result = resolver.push(board, 'X', 'right', 0)

    expect(isAlive(board, 'Y')).toBe(false)
    expect(posOf(board, 'X')).toEqual({ x: 4, y: 2 })
    expect(isAlive(board, 'X')).toBe(true)
    expect(result.destroyed).toEqual(['Y'])
    // イベント順: death{Y} → push{X}
    expect(kindsOf(result.events)).toEqual(['unit_destroy', 'unit_push'])
    expect(result.events[0]).toMatchObject({ kind: 'unit_destroy', unitId: 'Y' })
    expect(result.events[1]).toMatchObject({ kind: 'unit_push', unitId: 'X', to: { x: 4, y: 2 } })
  })

  // PR-08: 3体連鎖、先頭が盤外撃破（6×6）
  it('PR-08: 3体連鎖、先頭が盤外撃破', () => {
    const board = makeBoard(6, [
      { id: 'X', x: 3, y: 2 },
      { id: 'Y', x: 4, y: 2 },
      { id: 'Z', x: 5, y: 2 },
    ])
    const result = resolver.push(board, 'X', 'right', 0)

    expect(isAlive(board, 'Z')).toBe(false)
    expect(posOf(board, 'Y')).toEqual({ x: 5, y: 2 })
    expect(posOf(board, 'X')).toEqual({ x: 4, y: 2 })
    // イベント順: death{Z} → push{Y} → push{X}
    expect(result.events.map(e => e.unitId)).toEqual(['Z', 'Y', 'X'])
    expect(kindsOf(result.events)).toEqual(['unit_destroy', 'unit_push', 'unit_push'])
  })

  // PR-09: 盤上に存在しないユニットへの push は no-op（旧「距離0」を再構成）
  it('PR-09: 存在しないユニットへの push は no-op', () => {
    const board = makeBoard(5, [{ id: 'X', x: 2, y: 2 }])
    const result = resolver.push(board, 'ghost', 'right', 0)

    expect(result.events).toEqual([])
    expect(result.moved).toEqual([])
    expect(result.destroyed).toEqual([])
    // 既存ユニットは不変
    expect(posOf(board, 'X')).toEqual({ x: 2, y: 2 })
  })

  // PR-10: 敵コアを盤外へ押す（勝利の起点）
  it('PR-10: 敵コアを盤外へ押すと撃破され盤上から消える', () => {
    const board = makeBoard(5, [{ id: 'core', x: 4, y: 2, type: 'core', side: 'enemy' }])
    const result = resolver.push(board, 'core', 'right', 0)

    expect(isAlive(board, 'core')).toBe(false)
    expect(board.getUnitsBySide('enemy')).toHaveLength(0)
    expect(result.destroyed).toEqual(['core'])
  })

  // PR-11: 列外のユニットに影響しない
  it('PR-11: 同列にないユニットは不変', () => {
    const board = makeBoard(5, [
      { id: 'X', x: 1, y: 2 },
      { id: 'Y', x: 2, y: 2 },
      { id: 'W', x: 2, y: 0 },
    ])
    resolver.push(board, 'X', 'right', 0)

    expect(posOf(board, 'X')).toEqual({ x: 2, y: 2 })
    expect(posOf(board, 'Y')).toEqual({ x: 3, y: 2 })
    expect(posOf(board, 'W')).toEqual({ x: 2, y: 0 })
  })

  // PR-12: 満員列の押し出し（全シフト＋先頭撃破）
  it('PR-12: 満員列を押すと先頭が盤外撃破され残りがシフト', () => {
    const board = makeBoard(6, [
      { id: 'u1', x: 1, y: 2 },
      { id: 'u2', x: 2, y: 2 },
      { id: 'u3', x: 3, y: 2 },
      { id: 'u4', x: 4, y: 2 },
      { id: 'u5', x: 5, y: 2 },
    ])
    const result = resolver.push(board, 'u1', 'right', 0)

    // 先頭 u5（右端）が盤外撃破、残り4体が1マスずつ右へシフト
    expect(isAlive(board, 'u5')).toBe(false)
    expect(posOf(board, 'u4')).toEqual({ x: 5, y: 2 })
    expect(posOf(board, 'u3')).toEqual({ x: 4, y: 2 })
    expect(posOf(board, 'u2')).toEqual({ x: 3, y: 2 })
    expect(posOf(board, 'u1')).toEqual({ x: 2, y: 2 })
    expect(board.getAllUnits()).toHaveLength(4)

    expect(result.destroyed).toEqual(['u5'])
    // イベント順: 先頭撃破 → 後方ほど後（前方先行）
    expect(result.events[0]).toMatchObject({ kind: 'unit_destroy', unitId: 'u5' })
    expect(result.events.map(e => e.unitId)).toEqual(['u5', 'u4', 'u3', 'u2', 'u1'])
  })

  // PR-13: 縦方向の端（上）でのチェーン撃破
  it('PR-13: 縦方向の端（上）でのチェーン撃破', () => {
    const board = makeBoard(5, [
      { id: 'X', x: 2, y: 1 },
      { id: 'Y', x: 2, y: 0 },
    ])
    const result = resolver.push(board, 'X', 'up', 0)

    expect(isAlive(board, 'Y')).toBe(false)
    expect(posOf(board, 'X')).toEqual({ x: 2, y: 0 })
    expect(result.destroyed).toEqual(['Y'])
    expect(kindsOf(result.events)).toEqual(['unit_destroy', 'unit_push'])
  })

  // PR-14: 端まで反復 push してもハングしない（旧「距離10」を再構成）
  it('PR-14: 端まで反復 push しても有限回で撃破に至りハングしない', () => {
    const board = makeBoard(5, [{ id: 'X', x: 0, y: 2 }])
    const maxIterations = board.width + 1
    const path: Array<Position | 'destroyed'> = []

    let iterations = 0
    while (isAlive(board, 'X') && iterations < maxIterations) {
      resolver.push(board, 'X', 'right', 0)
      iterations++
      path.push(posOf(board, 'X') ?? 'destroyed')
    }

    expect(isAlive(board, 'X')).toBe(false)
    expect(path).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      'destroyed',
    ])
    // size+1 回以内に必ず撃破まで到達（ハングしない）
    expect(iterations).toBeLessThanOrEqual(maxIterations)
  })

  // PR-15: 角からの即時盤外撃破
  it('PR-15: 角からの即時盤外撃破', () => {
    const board = makeBoard(5, [{ id: 'X', x: 0, y: 0 }])
    const result = resolver.push(board, 'X', 'up', 0)

    expect(isAlive(board, 'X')).toBe(false)
    expect(result.moved).toEqual([])
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      kind: 'unit_destroy',
      unitId: 'X',
      from: { x: 0, y: 0 },
    })
    expect(result.events[0]?.metadata?.cause).toBe('offBoard')
  })
})
