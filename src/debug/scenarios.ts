import { Board } from '../engine/Board'
import { createUnit } from '../data/unitTemplates'
import type { Side, Unit } from '../types/unit'
import type { WinReason } from '../types/battle'

/**
 * 手作りの検証用シナリオ（tasks.md T15）。
 * 「この盤面ならこの連鎖になる」を目視・自動の両方で確認するための固定盤面集。
 *
 * 各 `board` は両陣営を配置済みの初期盤面。`BattleEngine.run()` は board を破壊的に
 * 進めるため、実行側は必ず `board.clone()` を渡して scenario を不変に保つこと
 * （main.ts / tests/scenarios/chainScenarios.test.ts 参照）。
 */
export interface Scenario {
  name: string
  description: string
  board: Board
  expectedWinner: Side | 'draw'
  expectedReason: WinReason
  /** 連鎖が実際に起きたことの下限（result.maxChainDepth = 1手番の trigger_fire 数で確認）。 */
  minChainDepth?: number
}

function buildBoard(width: number, height: number, units: Unit[]): Board {
  const board = new Board(width, height)
  for (const u of units) board.placeUnit(u)
  return board
}

// シナリオ1「基本押し出し」: pusher が直進して敵コアに到達し、そのまま盤外へ。連鎖なしの最短勝利。
const basicPush: Scenario = {
  name: '基本押し出し',
  description: 'pusher が直進し、敵コアを直接盤外へ押し出す（連鎖なしの最短勝利）。',
  board: buildBoard(5, 3, [
    createUnit('pusher', 'player', { x: 0, y: 1 }, 'right', 'PP'),
    createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC'),
    createUnit('core', 'enemy', { x: 4, y: 1 }, 'left', 'EC'),
  ]),
  expectedWinner: 'player',
  expectedReason: 'core_destroyed',
}

// シナリオ2「2段連鎖」: pusher が reactor を押す → reactor の on_pushed が前方の敵コアを押して盤外へ。
const twoStepChain: Scenario = {
  name: '2段連鎖',
  description:
    'pusher が reactor を押す → reactor の on_pushed が伝播して前方の敵コアを盤外へ押し出す（連鎖深度 >= 2）。',
  board: buildBoard(6, 3, [
    createUnit('pusher', 'player', { x: 0, y: 1 }, 'right', 'PP'),
    createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC'),
    createUnit('reactor', 'enemy', { x: 2, y: 1 }, 'left', 'ER'),
    createUnit('core', 'enemy', { x: 5, y: 1 }, 'left', 'EC'),
  ]),
  expectedWinner: 'player',
  expectedReason: 'core_destroyed',
  minChainDepth: 2,
}

// シナリオ3「ボマー爆発連鎖」: pusher が bomber を右端から盤外へ → on_destroy の explode →
// 爆心(lastPos=(6,1))の上隣にいた敵コア(6,0)が爆風で上方向へ押し出され盤外撃破。
// （コアは bomber の押し出し射線 y=1 の外＝(6,0) に置く。射線上に置くと連鎖押しでコアが先に出てしまい
//   bomber が撃破されず爆発が起きないため。tasks.md T15 の配置矛盾を実証の上で修正した。）
const bomberChain: Scenario = {
  name: 'ボマー爆発連鎖',
  description:
    'pusher が bomber を右端から盤外へ押し出す → bomber の on_destroy で explode → 爆風で隣の敵コアを盤外撃破。',
  board: buildBoard(7, 3, [
    createUnit('pusher', 'player', { x: 0, y: 1 }, 'right', 'PP'),
    createUnit('core', 'player', { x: 0, y: 2 }, 'right', 'PC'),
    createUnit('bomber', 'enemy', { x: 5, y: 1 }, 'left', 'EB'),
    createUnit('core', 'enemy', { x: 6, y: 0 }, 'left', 'EC'),
  ]),
  expectedWinner: 'player',
  expectedReason: 'core_destroyed',
  minChainDepth: 2,
}

export const scenarios: Scenario[] = [basicPush, twoStepChain, bomberChain]
