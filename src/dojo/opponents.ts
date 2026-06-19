import { Board } from '../engine/Board'
import { createUnit } from '../data/unitTemplates'
import type { Unit } from '../types/unit'

/**
 * 道場相手プリセット（tasks.md T17）。コールドスタート対策として、
 * プレイヤーが最初に当てられる固定構成の対戦相手を 5 体、段階的な難易度で用意する。
 *
 * 各 `buildBoard()` は「相手（enemy 側）の布陣のみ」を配置した盤面を返す。
 * 盤面上部（y が小さい側）に布陣し、攻撃ユニットはプレイヤー側（y が大きい側）へ
 * 向かう `down` を向く。プレイヤー盤面との合成はフェーズ2で行う想定のため、
 * ここでは相手ユニットだけを置いた検証可能な Board を返す。
 *
 * `id` は決定論のため常に明示 suffix を渡す（unitTemplates の方針に準拠）。
 */
export interface DojoOpponent {
  id: string
  name: string
  /** 「〇〇型構築。〜〜が弱点」の形式で構築の狙いと弱点を一言で示す。 */
  description: string
  difficulty: 1 | 2 | 3 | 4 | 5
  /** 相手の盤面を生成するファクトリ。呼ぶたびに新しい Board を返す。 */
  buildBoard(): Board
}

// 全道場相手で共通の盤面サイズ。相手は上部 (y=0..2) に布陣し、下部はプレイヤー用に空ける。
const BOARD_W = 7
const BOARD_H = 7

function buildBoard(units: Unit[]): Board {
  const board = new Board(BOARD_W, BOARD_H)
  for (const u of units) board.placeUnit(u)
  return board
}

export const DOJO_OPPONENTS: DojoOpponent[] = [
  // Lv1: core + pusher x1。まっすぐ来るだけの単騎。
  {
    id: 'dojo_01_straight',
    name: '一番組・直進',
    description: '単騎直進型構築。pusher 1 体が中央を直進するのみ。側面が完全に空き、横からの一押しに弱い。',
    difficulty: 1,
    buildBoard() {
      return buildBoard([
        createUnit('core', 'enemy', { x: 3, y: 0 }, 'down', 'C'),
        createUnit('pusher', 'enemy', { x: 3, y: 1 }, 'down', 'P0'),
      ])
    },
  },

  // Lv2: core + pusher x2（並列配置）。同時に押し寄せる二段突き。
  {
    id: 'dojo_02_twin_push',
    name: '二番組・双突',
    description: '並列突進型構築。pusher 2 体を横並びで同時に押し込む。中央の連携が薄く、各個撃破に弱い。',
    difficulty: 2,
    buildBoard() {
      return buildBoard([
        createUnit('core', 'enemy', { x: 3, y: 0 }, 'down', 'C'),
        createUnit('pusher', 'enemy', { x: 2, y: 1 }, 'down', 'P0'),
        createUnit('pusher', 'enemy', { x: 4, y: 1 }, 'down', 'P1'),
      ])
    },
  },

  // Lv3: core + pusher + reactor の連携。押されると反応が伝播する。
  {
    id: 'dojo_03_relay',
    name: '三番組・連反',
    description: '伝播型構築。pusher の押しに reactor が反応して連鎖を伸ばす。起点の pusher を先に潰せば伝播が止まる。',
    difficulty: 3,
    buildBoard() {
      return buildBoard([
        createUnit('core', 'enemy', { x: 3, y: 0 }, 'down', 'C'),
        createUnit('pusher', 'enemy', { x: 2, y: 1 }, 'down', 'P0'),
        createUnit('reactor', 'enemy', { x: 4, y: 1 }, 'down', 'R0'),
      ])
    },
  },

  // Lv4: core + bomber 配置。爆発範囲が脅威。
  {
    id: 'dojo_04_minefield',
    name: '四番組・爆陣',
    description: 'bomber 設置型構築。撃破時の爆風が周囲を巻き込む脅威。自爆を誘発し爆風を相手側へ向け返せば弱い。',
    difficulty: 4,
    buildBoard() {
      return buildBoard([
        createUnit('core', 'enemy', { x: 3, y: 0 }, 'down', 'C'),
        createUnit('bomber', 'enemy', { x: 2, y: 1 }, 'down', 'B0'),
        createUnit('bomber', 'enemy', { x: 4, y: 1 }, 'down', 'B1'),
      ])
    },
  },

  // Lv5: 全種を組み合わせた複合構成。
  {
    id: 'dojo_05_grandmaster',
    name: '五番組・総帥',
    description: '全種複合型構築。pusher/reactor/bomber/magnet/swapper を揃えた総合布陣。隙は少ないが手数で崩せる。',
    difficulty: 5,
    buildBoard() {
      return buildBoard([
        createUnit('core', 'enemy', { x: 3, y: 0 }, 'down', 'C'),
        createUnit('reactor', 'enemy', { x: 2, y: 1 }, 'down', 'R0'),
        createUnit('bomber', 'enemy', { x: 4, y: 1 }, 'down', 'B0'),
        createUnit('pusher', 'enemy', { x: 3, y: 2 }, 'down', 'P0'),
        createUnit('magnet', 'enemy', { x: 1, y: 2 }, 'down', 'M0'),
        createUnit('swapper', 'enemy', { x: 5, y: 2 }, 'down', 'S0'),
      ])
    },
  },
]
