import { describe, it, expect } from 'vitest'
import { Board } from '../../src/engine/Board'
import { createUnit } from '../../src/data/unitTemplates'
import { encodeBoard } from '../../src/share/encode'
import {
  BOARD_QUERY_PARAM,
  parseBoardCodeFromQuery,
  buildShareUrl,
} from '../../src/ui/ShareCode'

// ShareCode の純粋な URL ヘルパーのみを検証する（DOM クラスは目視確認 / node 環境では非対象）。

describe('ShareCode URL helpers (T22)', () => {
  it('parseBoardCodeFromQuery: ?b= の値を取り出す', () => {
    expect(parseBoardCodeFromQuery('?b=v1%3Aabc')).toBe('v1:abc')
    expect(parseBoardCodeFromQuery('b=v1%3Aabc')).toBe('v1:abc') // 先頭 '?' なしでも可
  })

  it('parseBoardCodeFromQuery: コードが無ければ null', () => {
    expect(parseBoardCodeFromQuery('')).toBeNull()
    expect(parseBoardCodeFromQuery('?x=1')).toBeNull()
    expect(parseBoardCodeFromQuery(`?${BOARD_QUERY_PARAM}=`)).toBeNull() // 空値も null
  })

  it('buildShareUrl: origin+pathname に ?b= を付け、既存クエリは捨てる', () => {
    const url = buildShareUrl({ origin: 'https://example.com', pathname: '/cascade/' }, 'v1:abc')
    expect(url.startsWith('https://example.com/cascade/?')).toBe(true)
    expect(parseBoardCodeFromQuery(new URL(url).search)).toBe('v1:abc')
  })

  it('往復一致: 実際の共有コードでも buildShareUrl → parse で元コードに戻る', () => {
    const board = new Board(7, 7)
    board.placeUnit(createUnit('core', 'player', { x: 3, y: 6 }, 'up', 'c'))
    board.placeUnit(createUnit('pusher', 'player', { x: 3, y: 5 }, 'up', 'p'))
    const code = encodeBoard(board)

    const url = buildShareUrl({ origin: 'https://example.com', pathname: '/' }, code)
    expect(parseBoardCodeFromQuery(new URL(url).search)).toBe(code)
  })
})
