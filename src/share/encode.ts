import { compressToEncodedURIComponent } from 'lz-string'
import type { Board } from '../engine/Board'
import {
  SCHEMA_VERSION,
  UNIT_TYPE_TOKENS,
  SIDE_TOKENS,
  DIRECTION_TOKENS,
  type BoardCodec,
} from './format'

// 盤面 → 共有コード文字列（"v1:<lz-string圧縮>"）。
// 同一盤面は常に同一コードへ直列化する（§5 決定論／結果シェアの一貫性に必要）。
// そのためユニットは読み順（y 昇順 → x 昇順）で安定ソートしてから書き出す。
export function encodeBoard(board: Board): string {
  const sorted = [...board.getAllUnits()].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  )

  const u: BoardCodec['u'] = sorted.map(unit => [
    UNIT_TYPE_TOKENS.indexOf(unit.type),
    SIDE_TOKENS.indexOf(unit.side),
    unit.position.x,
    unit.position.y,
    DIRECTION_TOKENS.indexOf(unit.facing),
  ])

  const codec: BoardCodec = { w: board.width, h: board.height, u }
  const compressed = compressToEncodedURIComponent(JSON.stringify(codec))
  return `${SCHEMA_VERSION}:${compressed}`
}
