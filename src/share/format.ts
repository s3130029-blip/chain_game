import type { UnitType, Side } from '../types/unit'
import type { Direction } from '../types/direction'

// 共有コード先頭プレフィックス。スキーマを変えたら必ずインクリメントし、
// decode 側の互換チェック（SUP-10）で旧コードを安全に弾けるようにする。
export const SCHEMA_VERSION = 'v1'

// UnitType / Side / Direction の整数トークン化テーブル（index = トークン）。
// 順序はコードの永続的な意味なので、既存トークンの並びを変えてはならない
// （拡張は末尾に追加し、その場合は SCHEMA_VERSION を上げる）。
export const UNIT_TYPE_TOKENS: readonly UnitType[] = [
  'pusher',
  'reactor',
  'bomber',
  'magnet',
  'swapper',
  'core',
]

export const SIDE_TOKENS: readonly Side[] = ['player', 'enemy']

export const DIRECTION_TOKENS: readonly Direction[] = ['up', 'down', 'left', 'right']

// 直列化対象の中間表現。文字列直書きを避け整数トークンで短く保つ。
// u の各要素は [type, side, x, y, facing] のタプル。
export interface BoardCodec {
  w: number
  h: number
  u: Array<[t: number, s: number, x: number, y: number, f: number]>
}
