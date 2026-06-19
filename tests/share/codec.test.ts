import { describe, it, expect } from 'vitest'
import { compressToEncodedURIComponent } from 'lz-string'
import { Board } from '../../src/engine/Board'
import { createUnit } from '../../src/data/unitTemplates'
import { encodeBoard } from '../../src/share/encode'
import { decodeBoard } from '../../src/share/decode'
import { SCHEMA_VERSION } from '../../src/share/format'
import type { UnitType, Side } from '../../src/types/unit'
import type { Direction } from '../../src/types/direction'

/** specs から盤面を組み立てる（createUnit でテンプレ既定値を使う）。 */
function makeBoard(
  width: number,
  height: number,
  specs: Array<{ type: UnitType; side: Side; x: number; y: number; facing?: Direction }>,
): Board {
  const board = new Board(width, height)
  specs.forEach((s, i) => {
    board.placeUnit(createUnit(s.type, s.side, { x: s.x, y: s.y }, s.facing ?? 'right', String(i)))
  })
  return board
}

/** 盤面を「型・陣営・座標・facing」だけに要約し、読み順で安定ソートする（id は比較対象外）。 */
function summarize(board: Board): Array<{ type: UnitType; side: Side; x: number; y: number; facing: Direction }> {
  return board
    .getAllUnits()
    .map(u => ({ type: u.type, side: u.side, x: u.position.x, y: u.position.y, facing: u.facing }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.type.localeCompare(b.type))
}

/** 任意の中間表現を任意バージョンで共有コードへ詰める（不正コード生成用ヘルパー）。 */
function makeRawCode(codec: unknown, version: string = SCHEMA_VERSION): string {
  return `${version}:${compressToEncodedURIComponent(JSON.stringify(codec))}`
}

// トークン参照: type[pusher=0,reactor=1,bomber=2,magnet=3,swapper=4,core=5]
//             side[player=0,enemy=1] / facing[up=0,down=1,left=2,right=3]

describe('share codec (T19)', () => {
  describe('SUP-09: 共有コードの往復一致', () => {
    it('SUP-09: decodeBoard(encodeBoard(board)) で size・type/side/座標/facing が一致', () => {
      const board = makeBoard(6, 5, [
        { type: 'core', side: 'player', x: 0, y: 4, facing: 'up' },
        { type: 'pusher', side: 'player', x: 1, y: 3, facing: 'right' },
        { type: 'reactor', side: 'player', x: 2, y: 2, facing: 'left' },
        { type: 'bomber', side: 'enemy', x: 3, y: 1, facing: 'down' },
        { type: 'magnet', side: 'enemy', x: 4, y: 0, facing: 'up' },
        { type: 'core', side: 'enemy', x: 5, y: 0, facing: 'right' },
      ])

      const decoded = decodeBoard(encodeBoard(board))

      expect(decoded.width).toBe(board.width)
      expect(decoded.height).toBe(board.height)
      expect(summarize(decoded)).toEqual(summarize(board))
    })

    it('SUP-09: swapper を含む別構成でも往復一致', () => {
      const board = makeBoard(5, 5, [
        { type: 'swapper', side: 'player', x: 2, y: 2, facing: 'left' },
        { type: 'core', side: 'player', x: 0, y: 0 },
        { type: 'core', side: 'enemy', x: 4, y: 4 },
      ])

      const decoded = decodeBoard(encodeBoard(board))
      expect(summarize(decoded)).toEqual(summarize(board))
    })
  })

  describe('決定論: 同一盤面 → 同一コード', () => {
    it('同一盤面を2回 encode すると同一文字列', () => {
      const board = makeBoard(5, 5, [
        { type: 'core', side: 'player', x: 0, y: 0 },
        { type: 'pusher', side: 'player', x: 1, y: 1 },
        { type: 'core', side: 'enemy', x: 4, y: 4 },
      ])
      expect(encodeBoard(board)).toBe(encodeBoard(board))
    })

    it('配置順が違っても同一盤面なら同一コード（読み順安定ソート）', () => {
      const a = new Board(5, 5)
      a.placeUnit(createUnit('core', 'player', { x: 0, y: 0 }, 'right', 'a'))
      a.placeUnit(createUnit('pusher', 'player', { x: 2, y: 1 }, 'right', 'b'))
      a.placeUnit(createUnit('core', 'enemy', { x: 4, y: 4 }, 'right', 'c'))

      // 逆順に配置（unitMap の挿入順が変わる）
      const b = new Board(5, 5)
      b.placeUnit(createUnit('core', 'enemy', { x: 4, y: 4 }, 'right', 'z'))
      b.placeUnit(createUnit('pusher', 'player', { x: 2, y: 1 }, 'right', 'y'))
      b.placeUnit(createUnit('core', 'player', { x: 0, y: 0 }, 'right', 'x'))

      expect(encodeBoard(a)).toBe(encodeBoard(b))
    })
  })

  describe('コード形式', () => {
    it('先頭に SCHEMA_VERSION とコロンが付く', () => {
      const board = makeBoard(5, 5, [{ type: 'core', side: 'player', x: 0, y: 0 }])
      const code = encodeBoard(board)
      expect(code.startsWith(`${SCHEMA_VERSION}:`)).toBe(true)
    })
  })

  describe('SUP-10: 不正コード拒否 — バージョン不一致', () => {
    it('SUP-10: SCHEMA_VERSION と異なるバージョンで例外', () => {
      const code = makeRawCode({ w: 5, h: 5, u: [[5, 0, 0, 0, 3]] }, 'v0')
      expect(() => decodeBoard(code)).toThrow()
    })

    it('SUP-10: バージョンプレフィックスが無いコードで例外', () => {
      expect(() => decodeBoard('not-a-code')).toThrow()
    })
  })

  describe('SUP-11: 不正コード拒否 — 盤外座標', () => {
    it('SUP-11: 5×5 盤に (99,99) のユニットを含むコードで例外', () => {
      const code = makeRawCode({ w: 5, h: 5, u: [[5, 0, 99, 99, 3]] })
      expect(() => decodeBoard(code)).toThrow()
    })

    it('SUP-11: 負座標でも例外', () => {
      const code = makeRawCode({ w: 5, h: 5, u: [[5, 0, -1, 0, 3]] })
      expect(() => decodeBoard(code)).toThrow()
    })
  })

  describe('SUP-12: 不正コード拒否 — 未知type / 座標重複 / コア不在', () => {
    it('SUP-12(a): 未知 type トークンで例外', () => {
      const code = makeRawCode({ w: 5, h: 5, u: [[99, 0, 0, 0, 3]] })
      expect(() => decodeBoard(code)).toThrow()
    })

    it('SUP-12(b): 同一座標に2体で例外', () => {
      const code = makeRawCode({
        w: 5,
        h: 5,
        u: [
          [5, 0, 1, 1, 3],
          [0, 0, 1, 1, 3],
        ],
      })
      expect(() => decodeBoard(code)).toThrow()
    })

    it('SUP-12(c): コア0体で例外', () => {
      const code = makeRawCode({ w: 5, h: 5, u: [[0, 0, 0, 0, 3]] })
      expect(() => decodeBoard(code)).toThrow()
    })
  })

  describe('堅牢性: 圧縮文字列破損 / JSON 不正', () => {
    it('壊れた payload で例外（復号失敗）', () => {
      expect(() => decodeBoard('v1:')).toThrow()
      expect(() => decodeBoard('v1:@@@@@')).toThrow()
    })

    it('JSON にならない payload で例外', () => {
      const code = `${SCHEMA_VERSION}:${compressToEncodedURIComponent('this is not json {{{')}`
      expect(() => decodeBoard(code)).toThrow()
    })

    it('未知のトークン位置（facing 範囲外）で例外', () => {
      const code = makeRawCode({ w: 5, h: 5, u: [[5, 0, 0, 0, 99]] })
      expect(() => decodeBoard(code)).toThrow()
    })
  })
})
