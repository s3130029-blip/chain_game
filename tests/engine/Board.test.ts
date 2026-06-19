import { describe, it, expect, beforeEach } from 'vitest'
import { Board } from '../../src/engine/Board'
import type { Unit } from '../../src/types/unit'

function makeUnit(id: string, x: number, y: number, side: 'player' | 'enemy' = 'player'): Unit {
  return {
    id,
    type: 'pusher',
    hp: 3,
    maxHp: 3,
    speed: 5,
    facing: 'right',
    position: { x, y },
    side,
    triggers: [],
    cost: 2,
  }
}

describe('Board', () => {
  let board: Board

  beforeEach(() => {
    board = new Board(5, 5)
  })

  describe('isInBounds', () => {
    it('盤内座標は true を返す', () => {
      expect(board.isInBounds({ x: 0, y: 0 })).toBe(true)
      expect(board.isInBounds({ x: 4, y: 4 })).toBe(true)
      expect(board.isInBounds({ x: 2, y: 2 })).toBe(true)
    })

    it('盤外座標は false を返す', () => {
      expect(board.isInBounds({ x: -1, y: 0 })).toBe(false)
      expect(board.isInBounds({ x: 5, y: 0 })).toBe(false)
      expect(board.isInBounds({ x: 0, y: -1 })).toBe(false)
      expect(board.isInBounds({ x: 0, y: 5 })).toBe(false)
    })
  })

  describe('placeUnit / getUnit / getUnitAt', () => {
    it('placeUnit でユニットを配置し getUnit / getUnitAt で取得できる', () => {
      const unit = makeUnit('p1', 2, 3)
      board.placeUnit(unit)
      expect(board.getUnit('p1')).toEqual(unit)
      expect(board.getUnitAt({ x: 2, y: 3 })).toEqual(unit)
    })

    it('同じ座標に2体置こうとしたらエラーをスロー', () => {
      board.placeUnit(makeUnit('p1', 2, 2))
      expect(() => board.placeUnit(makeUnit('p2', 2, 2))).toThrow()
    })

    it('盤外座標への placeUnit はエラーをスロー', () => {
      expect(() => board.placeUnit(makeUnit('p1', 5, 0))).toThrow()
    })

    it('存在しない id の getUnit は undefined を返す', () => {
      expect(board.getUnit('nonexistent')).toBeUndefined()
    })

    it('空の座標の getUnitAt は undefined を返す', () => {
      expect(board.getUnitAt({ x: 0, y: 0 })).toBeUndefined()
    })
  })

  describe('removeUnit', () => {
    it('removeUnit 後に getUnitAt で undefined が返る', () => {
      const unit = makeUnit('p1', 2, 2)
      board.placeUnit(unit)
      board.removeUnit('p1')
      expect(board.getUnitAt({ x: 2, y: 2 })).toBeUndefined()
      expect(board.getUnit('p1')).toBeUndefined()
    })

    it('存在しない id の removeUnit は何もしない（エラーなし）', () => {
      expect(() => board.removeUnit('nonexistent')).not.toThrow()
    })
  })

  describe('moveUnit', () => {
    it('moveUnit で元の位置が空になり新しい位置に移動する', () => {
      const unit = makeUnit('p1', 1, 1)
      board.placeUnit(unit)
      board.moveUnit('p1', { x: 3, y: 3 })
      expect(board.getUnitAt({ x: 1, y: 1 })).toBeUndefined()
      expect(board.getUnitAt({ x: 3, y: 3 })).toBeDefined()
      expect(board.getUnit('p1')?.position).toEqual({ x: 3, y: 3 })
    })

    it('moveUnit で盤外へ移動しようとするとエラー', () => {
      board.placeUnit(makeUnit('p1', 2, 2))
      expect(() => board.moveUnit('p1', { x: 5, y: 2 })).toThrow()
    })
  })

  describe('getAdjacentUnits', () => {
    it('getAdjacentUnits が正しく4方向のユニットを返す', () => {
      const center = makeUnit('c', 2, 2)
      const up    = makeUnit('u', 2, 1)
      const down  = makeUnit('d', 2, 3)
      const left  = makeUnit('l', 1, 2)
      const right = makeUnit('r', 3, 2)
      const diag  = makeUnit('x', 3, 3) // 対角は含まない

      board.placeUnit(center)
      board.placeUnit(up)
      board.placeUnit(down)
      board.placeUnit(left)
      board.placeUnit(right)
      board.placeUnit(diag)

      const adj = board.getAdjacentUnits({ x: 2, y: 2 })
      const adjIds = adj.map(u => u.id).sort()
      expect(adjIds).toEqual(['d', 'l', 'r', 'u'])
      expect(adj).not.toContain(expect.objectContaining({ id: 'x' }))
    })

    it('隣にユニットがいない場合は空配列を返す', () => {
      board.placeUnit(makeUnit('p1', 2, 2))
      expect(board.getAdjacentUnits({ x: 2, y: 2 })).toHaveLength(0)
    })

    it('盤端のユニットの隣接は盤外を無視する', () => {
      board.placeUnit(makeUnit('p1', 0, 0))
      board.placeUnit(makeUnit('p2', 1, 0))
      const adj = board.getAdjacentUnits({ x: 0, y: 0 })
      expect(adj).toHaveLength(1)
      expect(adj[0]?.id).toBe('p2')
    })
  })

  describe('getUnitsInLine', () => {
    it('指定方向にいる全ユニットを近い順に返す', () => {
      board.placeUnit(makeUnit('a', 0, 2))
      board.placeUnit(makeUnit('b', 2, 2))
      board.placeUnit(makeUnit('c', 4, 2))
      const line = board.getUnitsInLine({ x: 0, y: 2 }, 'right')
      expect(line.map(u => u.id)).toEqual(['b', 'c'])
    })

    it('方向にユニットがいない場合は空配列', () => {
      board.placeUnit(makeUnit('p1', 2, 2))
      expect(board.getUnitsInLine({ x: 2, y: 2 }, 'up')).toHaveLength(0)
    })
  })

  describe('getAllUnits / getUnitsBySide', () => {
    it('getAllUnits が全ユニットを返す', () => {
      board.placeUnit(makeUnit('p1', 0, 0, 'player'))
      board.placeUnit(makeUnit('e1', 4, 4, 'enemy'))
      expect(board.getAllUnits()).toHaveLength(2)
    })

    it('getUnitsBySide で陣営別にフィルタリングできる', () => {
      board.placeUnit(makeUnit('p1', 0, 0, 'player'))
      board.placeUnit(makeUnit('p2', 1, 0, 'player'))
      board.placeUnit(makeUnit('e1', 4, 4, 'enemy'))
      expect(board.getUnitsBySide('player')).toHaveLength(2)
      expect(board.getUnitsBySide('enemy')).toHaveLength(1)
    })
  })

  describe('isEmpty', () => {
    it('空のマスに true を返す', () => {
      expect(board.isEmpty({ x: 2, y: 2 })).toBe(true)
    })

    it('ユニットがいるマスに false を返す', () => {
      board.placeUnit(makeUnit('p1', 2, 2))
      expect(board.isEmpty({ x: 2, y: 2 })).toBe(false)
    })
  })

  describe('updateUnit', () => {
    it('updateUnit で HP を更新できる', () => {
      board.placeUnit(makeUnit('p1', 2, 2))
      board.updateUnit('p1', { hp: 1 })
      expect(board.getUnit('p1')?.hp).toBe(1)
    })
  })

  describe('clone', () => {
    it('clone が深いコピーを返し、元の Board と独立している', () => {
      board.placeUnit(makeUnit('p1', 2, 2))
      const cloned = board.clone()
      cloned.removeUnit('p1')
      expect(board.getUnit('p1')).toBeDefined()
      expect(cloned.getUnit('p1')).toBeUndefined()
    })
  })
})
