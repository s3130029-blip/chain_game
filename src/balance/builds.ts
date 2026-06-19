import type { UnitType } from '../types/unit'
import type { Direction } from '../types/direction'

/**
 * バランス検証用の「代表構築」定義（tasks.md T24）。
 *
 * 各構築は「片陣営の構築（プレイヤー側の自盤）」を **construction frame** で表す:
 *  - プレイヤー（自陣）は盤面下段（y が大きい側）に布陣する。
 *  - core は最後方（y=6）、攻め手（pusher 等）は前方（y=4..5）に置き `up`（敵方向）を向く。
 *  - 攻守を入れ替えるとき（相手役にするとき）は setupBattle が上下ミラーで敵陣へ移す。
 *
 * これは dojo/opponents.ts が「相手（enemy・上段・down 向き）」を直接置くのと対になる表現。
 * harness 側で setupBattle(myBuild, oppBuild) として総当たりに合成する。
 *
 * 構築は要件定義書 §215「強い数値ではなく便利な接続」を検証する archetype を網羅する:
 *  攻撃特化 / 連鎖伝播 / 爆発 / 制御(magnet,swapper) / 防御(壁) / 安価スパム。
 */
export interface BuildUnit {
  type: UnitType
  x: number
  y: number
  /** 省略時は 'up'（construction frame の攻撃方向）。core 等の不動ユニットでは無視される。 */
  facing?: Direction
}

export interface Build {
  id: string
  /** 検証レポートの見出しに使う短い名前。 */
  name: string
  units: ReadonlyArray<BuildUnit>
}

// 全構築共通の盤面サイズ（dojo/opponents.ts と一致させる）。
export const BALANCE_BOARD_W = 7
export const BALANCE_BOARD_H = 7

/**
 * 代表構築。各構築は core を1体だけ含み、コスト上限（Editor の COST_BUDGET=12）以内に収める。
 * harness の round-robin では下記に dojo 5 体を construction frame へ変換して加える。
 */
export const REPRESENTATIVE_BUILDS: readonly Build[] = [
  // --- 攻撃特化（pusher のみ）: 攻め手の枚数を振った系列 ---
  {
    id: 'solo_pusher',
    name: '単騎押し',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'pusher', x: 3, y: 4 },
    ],
  },
  {
    id: 'twin_pusher',
    name: '双押し',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'pusher', x: 2, y: 4 },
      { type: 'pusher', x: 4, y: 4 },
    ],
  },
  {
    id: 'triple_pusher',
    name: '三連押し',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'pusher', x: 2, y: 4 },
      { type: 'pusher', x: 3, y: 4 },
      { type: 'pusher', x: 4, y: 4 },
    ],
  },

  // --- 連鎖伝播（pusher → reactor のリレー）---
  {
    id: 'relay',
    name: '単リレー',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'pusher', x: 3, y: 5 },
      { type: 'reactor', x: 3, y: 4 },
    ],
  },
  {
    id: 'double_relay',
    name: '双リレー',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'pusher', x: 2, y: 5 },
      { type: 'pusher', x: 4, y: 5 },
      { type: 'reactor', x: 2, y: 4 },
      { type: 'reactor', x: 4, y: 4 },
    ],
  },

  // --- 爆発（bomber）---
  {
    id: 'bomber_spear',
    name: '爆槍',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'pusher', x: 3, y: 5 },
      { type: 'bomber', x: 3, y: 4 },
    ],
  },
  {
    id: 'bomber_wall',
    name: '爆壁',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'bomber', x: 2, y: 5 },
      { type: 'bomber', x: 4, y: 5 },
    ],
  },

  // --- 制御（magnet / swapper）---
  {
    id: 'control',
    name: '制御',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'pusher', x: 3, y: 4 },
      { type: 'magnet', x: 1, y: 4 },
      { type: 'swapper', x: 5, y: 4 },
    ],
  },

  // --- 複合コンボ（pusher×reactor の二重リレー＋押し増し）---
  {
    id: 'combo_aggro',
    name: '複合アグロ',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'pusher', x: 2, y: 5 },
      { type: 'pusher', x: 3, y: 5 },
      { type: 'pusher', x: 4, y: 5 },
      { type: 'reactor', x: 2, y: 4 },
      { type: 'reactor', x: 4, y: 4 },
    ],
  },

  // --- 防御（攻め手なし＝タイムアウト勝ちを狙う壁）---
  {
    id: 'pure_wall',
    name: '純防御壁',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'bomber', x: 2, y: 4 },
      { type: 'bomber', x: 4, y: 4 },
      { type: 'reactor', x: 1, y: 4 },
      { type: 'reactor', x: 5, y: 4 },
    ],
  },

  // --- 安価スパム（cost が低いユニットを枚数で詰め込み、生存数タイブレークを狙う「壊れ」候補）---
  {
    id: 'reactor_swarm',
    name: '反応群体',
    units: [
      { type: 'core', x: 3, y: 6 },
      { type: 'reactor', x: 0, y: 4 },
      { type: 'reactor', x: 1, y: 4 },
      { type: 'reactor', x: 2, y: 4 },
      { type: 'reactor', x: 3, y: 4 },
      { type: 'reactor', x: 4, y: 4 },
      { type: 'reactor', x: 5, y: 4 },
      { type: 'reactor', x: 6, y: 4 },
      { type: 'reactor', x: 2, y: 5 },
      { type: 'reactor', x: 4, y: 5 },
    ],
  },
]
