import { describe, it, expect } from 'vitest'
import { Board } from '../../src/engine/Board'
import { BattleEngine } from '../../src/engine/BattleEngine'
import { createUnit } from '../../src/data/unitTemplates'
import type { Unit } from '../../src/types/unit'

// --- local helpers（test-spec §0 / 既存テストと同方針: Board + ローカルヘルパー） ---

function makeBoard(width: number, height: number, units: Unit[]): Board {
  const board = new Board(width, height)
  for (const u of units) board.placeUnit(u)
  return board
}

function isAlive(board: Board, id: string): boolean {
  return board.getUnit(id) !== undefined
}

describe('BattleEngine', () => {
  // T12 完了条件1: 盤面に core のみ → 動くユニットがいないので maxTurns で draw
  it('T12-1: core のみの盤面は maxTurns 到達で draw(timeout) になる', () => {
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC')
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 2 }, 'left', 'EC')
    const board = makeBoard(5, 5, [playerCore, enemyCore])

    const result = new BattleEngine().run(board)

    expect(result.winner).toBe('draw')
    expect(result.reason).toBe('timeout')
    expect(result.totalTurns).toBe(30) // DEFAULT_CONFIG.maxTurns
    // 末尾は battle_end（SUP-08 と同方針）。
    expect(result.events.at(-1)?.kind).toBe('battle_end')
  })

  // T12 完了条件2 / SUP-08: player pusher が enemy core を直接押して盤外へ → player 勝利
  it('T12-2 / SUP-08: pusher が敵コアを盤外へ押し出すと player の core_destroyed 勝利', () => {
    const pusher = createUnit('pusher', 'player', { x: 0, y: 2 }, 'right', 'PP')
    const playerCore = createUnit('core', 'player', { x: 0, y: 4 }, 'right', 'PC')
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 2 }, 'left', 'EC')
    const board = makeBoard(5, 5, [pusher, playerCore, enemyCore])

    const result = new BattleEngine().run(board)

    expect(result.winner).toBe('player')
    expect(result.reason).toBe('core_destroyed')
    expect(isAlive(board, 'e_core_EC')).toBe(false) // 敵コアは盤外撃破済み
    expect(isAlive(board, 'p_pusher_PP')).toBe(true)
    expect(result.events.at(-1)?.kind).toBe('battle_end')
    // 連鎖ログに撃破イベントが含まれること（観戦できる証跡）。
    expect(result.events.some(e => e.kind === 'unit_destroy' && e.unitId === 'e_core_EC')).toBe(true)
  })

  // T12 完了条件3: maxStepsPerTurn を絞っても無限ループせず必ず終了する（ハングしない）
  it('T12-3: maxStepsPerTurn 超過設定でも run() はハングせず BattleResult を返す', () => {
    // pusher が複数ユニットの列を押してイベントを多発させ、step 予算(=1)を即超過させる。
    const pusher = createUnit('pusher', 'player', { x: 0, y: 2 }, 'right', 'PP')
    const playerCore = createUnit('core', 'player', { x: 0, y: 0 }, 'right', 'PC')
    const r1 = createUnit('reactor', 'enemy', { x: 1, y: 2 }, 'left', 'R1')
    const r2 = createUnit('reactor', 'enemy', { x: 2, y: 2 }, 'left', 'R2')
    const enemyCore = createUnit('core', 'enemy', { x: 5, y: 2 }, 'left', 'EC')
    const board = makeBoard(6, 6, [pusher, playerCore, r1, r2, enemyCore])

    const engine = new BattleEngine({ maxTurns: 3, maxStepsPerTurn: 1 })
    const result = engine.run(board)

    // 主眼は「必ず返る」こと。結果は妥当な勝者のいずれか。
    expect(['player', 'enemy', 'draw']).toContain(result.winner)
    expect(result.totalTurns).toBeLessThanOrEqual(3)
    expect(result.events.at(-1)?.kind).toBe('battle_end')
  })

  // SUP-07 [CRITICAL]: 同一盤面からの run は完全に一致するイベント列を返す（決定論）
  it('SUP-07: 同一盤面なら run の events / winner / totalTurns が完全一致する', () => {
    const build = (): Board => {
      const pusher = createUnit('pusher', 'player', { x: 0, y: 1 }, 'right', 'PP')
      const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC')
      const reactor = createUnit('reactor', 'enemy', { x: 2, y: 1 }, 'left', 'ER')
      const enemyCore = createUnit('core', 'enemy', { x: 5, y: 1 }, 'left', 'EC')
      return makeBoard(6, 3, [pusher, playerCore, reactor, enemyCore])
    }

    const r1 = new BattleEngine().run(build())
    const r2 = new BattleEngine().run(build())

    expect(r1.winner).toBe(r2.winner)
    expect(r1.totalTurns).toBe(r2.totalTurns)
    expect(r1.events).toEqual(r2.events)
  })

  // 補強: reactor を介した連鎖で敵コアを盤外へ → 連鎖が記録される（chainDepth >= 2）
  it('T12: pusher→reactor の連鎖で敵コアを撃破し maxChainDepth>=2 を記録する', () => {
    const pusher = createUnit('pusher', 'player', { x: 0, y: 1 }, 'right', 'PP')
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC')
    const reactor = createUnit('reactor', 'enemy', { x: 2, y: 1 }, 'left', 'ER')
    const enemyCore = createUnit('core', 'enemy', { x: 5, y: 1 }, 'left', 'EC')
    const board = makeBoard(6, 3, [pusher, playerCore, reactor, enemyCore])

    const result = new BattleEngine().run(board)

    expect(result.winner).toBe('player')
    expect(result.reason).toBe('core_destroyed')
    expect(result.maxChainDepth).toBeGreaterThanOrEqual(2)
    expect(isAlive(board, 'e_core_EC')).toBe(false)
    // reactor の on_pushed 反応が連鎖ログに現れること。
    expect(
      result.events.some(e => e.kind === 'trigger_fire' && e.triggerKind === 'on_pushed'),
    ).toBe(true)
  })

  // T13: magnet の on_adjacent_enemy が自ターン開始時に発火する。
  // pull_nearest は最寄り敵を magnet へ向けて押すため、直交隣接の敵は magnet 自身の升へ
  // 押し込めず移動しない（隣接敵は常に最寄り）。よって観測可能な T13 の効果は「発火」であり、
  // ここでは trigger_fire の出現を検証する（pull の移動は構造上起こらない）。
  it('T13: magnet は自ターン開始時に隣接敵がいると on_adjacent_enemy が発火する', () => {
    const magnet = createUnit('magnet', 'player', { x: 2, y: 2 }, 'right', 'PM')
    const enemyReactor = createUnit('reactor', 'enemy', { x: 2, y: 1 }, 'down', 'ER') // magnet の上隣
    const playerCore = createUnit('core', 'player', { x: 0, y: 4 }, 'right', 'PC')
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 4 }, 'left', 'EC')
    const board = makeBoard(5, 5, [magnet, enemyReactor, playerCore, enemyCore])

    const result = new BattleEngine().run(board)

    expect(
      result.events.some(
        e =>
          e.kind === 'trigger_fire' &&
          e.unitId === 'p_magnet_PM' &&
          e.triggerKind === 'on_adjacent_enemy' &&
          e.effectKind === 'pull_nearest',
      ),
    ).toBe(true)
  })

  // T13[EDGE]: 隣に敵がいなければ on_adjacent_enemy は発火しない（ゲート条件の検証）。
  it('T13: 隣接敵がいなければ on_adjacent_enemy は発火しない', () => {
    const magnet = createUnit('magnet', 'player', { x: 2, y: 2 }, 'right', 'PM')
    const enemyReactor = createUnit('reactor', 'enemy', { x: 4, y: 1 }, 'down', 'ER') // 非隣接
    const playerCore = createUnit('core', 'player', { x: 0, y: 4 }, 'right', 'PC')
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 4 }, 'left', 'EC')
    const board = makeBoard(5, 5, [magnet, enemyReactor, playerCore, enemyCore])

    const result = new BattleEngine().run(board)

    expect(
      result.events.some(
        e => e.kind === 'trigger_fire' && e.triggerKind === 'on_adjacent_enemy',
      ),
    ).toBe(false)
  })
})
