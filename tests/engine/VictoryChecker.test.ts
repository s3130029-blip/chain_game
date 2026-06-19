import { describe, it, expect } from 'vitest'
import { Board } from '../../src/engine/Board'
import { VictoryChecker } from '../../src/engine/VictoryChecker'
import { createUnit } from '../../src/data/unitTemplates'
import type { Unit } from '../../src/types/unit'

// --- local helpers（test-spec §0 / 既存テストと同方針: Board + ローカルヘルパー） ---

function makeBoard(width: number, height: number, units: Unit[]): Board {
  const board = new Board(width, height)
  for (const u of units) board.placeUnit(u)
  return board
}

/** hp を上書きしたユニットを返す（テスト用の微調整）。 */
function withHp(unit: Unit, hp: number): Unit {
  return { ...unit, hp }
}

describe('VictoryChecker', () => {
  // --- checkCoreDestroyed ---

  // T11 完了条件1 / SUP-03: player コアのみ消失 → enemy の勝ち
  it('T11-1 / SUP-03: player コアのみ消失なら enemy の勝ち（core_destroyed）', () => {
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 2 }, 'left', 'EC')
    // player 側にはコア以外のユニットのみ（コアは盤上に存在しない）
    const playerPusher = createUnit('pusher', 'player', { x: 0, y: 2 }, 'right', 'PP')
    const board = makeBoard(5, 5, [enemyCore, playerPusher])

    const result = VictoryChecker.checkCoreDestroyed(board)

    expect(result).toEqual({ winner: 'enemy', reason: 'core_destroyed' })
  })

  // 対称: enemy コアのみ消失 → player の勝ち
  it('T11: enemy コアのみ消失なら player の勝ち（core_destroyed）', () => {
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC')
    const enemyPusher = createUnit('pusher', 'enemy', { x: 4, y: 2 }, 'left', 'EP')
    const board = makeBoard(5, 5, [playerCore, enemyPusher])

    const result = VictoryChecker.checkCoreDestroyed(board)

    expect(result).toEqual({ winner: 'player', reason: 'core_destroyed' })
  })

  // T11 完了条件2 / SUP-04: 両コア消失 → draw
  it('T11-2 / SUP-04: 両コア消失なら draw', () => {
    // 双方コアなし。連鎖の結果、両コアが同時に盤外撃破された状況を表す。
    const playerPusher = createUnit('pusher', 'player', { x: 0, y: 2 }, 'right', 'PP')
    const enemyPusher = createUnit('pusher', 'enemy', { x: 4, y: 2 }, 'left', 'EP')
    const board = makeBoard(5, 5, [playerPusher, enemyPusher])

    const result = VictoryChecker.checkCoreDestroyed(board)

    expect(result).toEqual({ winner: 'draw', reason: 'core_destroyed' })
  })

  // 両コア存命なら戦闘継続（null）
  it('T11: 両コア存命なら null（戦闘継続）', () => {
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC')
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 2 }, 'left', 'EC')
    const board = makeBoard(5, 5, [playerCore, enemyCore])

    expect(VictoryChecker.checkCoreDestroyed(board)).toBeNull()
  })

  // SUP-05: 片方の全ユニット消滅（=コアも無い）で勝利
  it('T11 / SUP-05: enemy のユニットが0なら player の勝ち', () => {
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC')
    const board = makeBoard(5, 5, [playerCore])

    expect(VictoryChecker.checkCoreDestroyed(board)).toEqual({
      winner: 'player',
      reason: 'core_destroyed',
    })
  })

  // --- checkEndOfGame ---

  // T11 完了条件3 / SUP-06: 生存ユニット数判定
  it('T11-3 / SUP-06: 生存ユニット数が多い側が勝ち（unit_count）', () => {
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC')
    const playerPusher = createUnit('pusher', 'player', { x: 1, y: 2 }, 'right', 'PP')
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 2 }, 'left', 'EC')
    const board = makeBoard(5, 5, [playerCore, playerPusher, enemyCore])

    // player 2体 vs enemy 1体
    expect(VictoryChecker.checkEndOfGame(board)).toEqual({
      winner: 'player',
      reason: 'unit_count',
    })
  })

  // SUP-06: 生存数同値 → コアHP で決まる
  it('T11 / SUP-06: 生存数同値ならコアHPが高い側が勝ち（core_hp）', () => {
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC') // hp=5
    const enemyCore = withHp(createUnit('core', 'enemy', { x: 4, y: 2 }, 'left', 'EC'), 3)
    const board = makeBoard(5, 5, [playerCore, enemyCore])

    expect(VictoryChecker.checkEndOfGame(board)).toEqual({
      winner: 'player',
      reason: 'core_hp',
    })
  })

  // T11 完了条件4 / SUP-06: 合計残HP 判定
  it('T11-4 / SUP-06: 生存数・コアHP同値なら合計残HPが高い側が勝ち（total_hp）', () => {
    // 双方: core(hp=5) + pusher。pusher の hp 差で総HP が決まる。
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC') // hp=5
    const playerPusher = createUnit('pusher', 'player', { x: 1, y: 2 }, 'right', 'PP') // hp=3
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 2 }, 'left', 'EC') // hp=5
    const enemyPusher = withHp(createUnit('pusher', 'enemy', { x: 3, y: 2 }, 'left', 'EP'), 1) // hp=1
    const board = makeBoard(5, 5, [playerCore, playerPusher, enemyCore, enemyPusher])

    // 生存数 2=2、コアHP 5=5、総HP player(8) > enemy(6)
    expect(VictoryChecker.checkEndOfGame(board)).toEqual({
      winner: 'player',
      reason: 'total_hp',
    })
  })

  // SUP-06: 全項目同値なら draw
  it('T11 / SUP-06: 生存数・コアHP・総HP すべて同値なら draw（timeout）', () => {
    const playerCore = createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC')
    const playerPusher = createUnit('pusher', 'player', { x: 1, y: 2 }, 'right', 'PP')
    const enemyCore = createUnit('core', 'enemy', { x: 4, y: 2 }, 'left', 'EC')
    const enemyPusher = createUnit('pusher', 'enemy', { x: 3, y: 2 }, 'left', 'EP')
    const board = makeBoard(5, 5, [playerCore, playerPusher, enemyCore, enemyPusher])

    expect(VictoryChecker.checkEndOfGame(board)).toEqual({
      winner: 'draw',
      reason: 'timeout',
    })
  })
})
