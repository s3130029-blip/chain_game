import { decompressFromEncodedURIComponent } from 'lz-string'
import { Board } from '../engine/Board'
import { createUnit } from '../data/unitTemplates'
import {
  SCHEMA_VERSION,
  UNIT_TYPE_TOKENS,
  SIDE_TOKENS,
  DIRECTION_TOKENS,
  type BoardCodec,
} from './format'

// 共有コード → 盤面（検証付き）。不正入力は必ず throw（握り潰さない／CLAUDE.md §6）。
// 復元するのは「型と配置」のみ：ユニットは createUnit でテンプレ既定値から再生成する。
export function decodeBoard(code: string): Board {
  // 1. バージョンプレフィックス（"<ver>:..."）。最初の ':' までを取り出して照合（SUP-10）。
  const sep = code.indexOf(':')
  if (sep === -1) {
    throw new Error('Invalid share code: missing version prefix')
  }
  const version = code.slice(0, sep)
  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `Invalid share code: unsupported schema version "${version}" (expected "${SCHEMA_VERSION}")`,
    )
  }

  // 2. 解凍（破損 payload は throw）。
  const payload = code.slice(sep + 1)
  let json: string | null
  try {
    json = decompressFromEncodedURIComponent(payload)
  } catch {
    json = null
  }
  if (json === null || json === '') {
    throw new Error('Invalid share code: failed to decompress payload')
  }

  // 3. JSON パース（壊れていれば throw）。
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid share code: corrupt JSON payload')
  }

  // 4. 構造検証 → 5. 盤面構築（座標・トークンの妥当性は placeUnit と下記で検証）。
  const codec = parseCodec(parsed)
  return buildBoard(codec)
}

function parseCodec(parsed: unknown): BoardCodec {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid share code: payload is not an object')
  }
  const obj = parsed as Record<string, unknown>

  const w = obj['w']
  const h = obj['h']
  if (!isPositiveInt(w) || !isPositiveInt(h)) {
    throw new Error('Invalid share code: invalid board dimensions')
  }

  const rawU = obj['u']
  if (!Array.isArray(rawU)) {
    throw new Error('Invalid share code: missing unit list')
  }

  const u: BoardCodec['u'] = rawU.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 5) {
      throw new Error(`Invalid share code: malformed unit entry at index ${i}`)
    }
    for (const v of entry) {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        throw new Error(`Invalid share code: non-integer field in unit entry at index ${i}`)
      }
    }
    return entry as [number, number, number, number, number]
  })

  return { w, h, u }
}

function buildBoard(codec: BoardCodec): Board {
  const board = new Board(codec.w, codec.h)

  codec.u.forEach((tuple, i) => {
    const [t, s, x, y, f] = tuple
    const type = UNIT_TYPE_TOKENS[t]
    if (type === undefined) {
      throw new Error(`Invalid share code: unknown unit type token ${t}`)
    }
    const side = SIDE_TOKENS[s]
    if (side === undefined) {
      throw new Error(`Invalid share code: unknown side token ${s}`)
    }
    const facing = DIRECTION_TOKENS[f]
    if (facing === undefined) {
      throw new Error(`Invalid share code: unknown facing token ${f}`)
    }
    // placeUnit が盤外座標（SUP-11）・座標重複（SUP-12b）を throw する。
    board.placeUnit(createUnit(type, side, { x, y }, facing, String(i)))
  })

  // 守る対象が無い構築は不正（SUP-12c）。
  const hasCore = board.getAllUnits().some(u => u.type === 'core')
  if (!hasCore) {
    throw new Error('Invalid share code: board must contain at least one core')
  }

  return board
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}
