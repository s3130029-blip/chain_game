import { describe, it, expect } from 'vitest'
import { InitiativeQueue } from '../../src/engine/InitiativeQueue'
import type { Unit, UnitType } from '../../src/types/unit'

function makeUnit(id: string, speed: number, x: number, y: number, type: UnitType = 'pusher'): Unit {
  return {
    id,
    type,
    hp: 3,
    maxHp: 3,
    speed,
    facing: 'right',
    position: { x, y },
    side: 'player',
    triggers: [],
    cost: 2,
  }
}

describe('InitiativeQueue', () => {
  describe('sort（決定論的行動順）', () => {
    it('SUP-01: speed 降順で並ぶ', () => {
      // swapper(speed=4), pusher(speed=3), magnet(speed=2) → 4 → 3 → 2
      const units = [
        makeUnit('pusher', 3, 0, 0, 'pusher'),
        makeUnit('swapper', 4, 1, 0, 'swapper'),
        makeUnit('magnet', 2, 2, 0, 'magnet'),
      ]
      const sorted = InitiativeQueue.sort(units)
      expect(sorted.map(u => u.id)).toEqual(['swapper', 'pusher', 'magnet'])
    })

    it('SUP-02: speed 同値は読み順（y 昇順 → x 昇順）で並ぶ', () => {
      // 同 speed の3体を (2,1),(3,1),(1,2) に配置 → (2,1) → (3,1) → (1,2)
      const units = [
        makeUnit('c', 5, 1, 2),
        makeUnit('a', 5, 2, 1),
        makeUnit('b', 5, 3, 1),
      ]
      const sorted = InitiativeQueue.sort(units)
      expect(sorted.map(u => u.id)).toEqual(['a', 'b', 'c'])
    })

    it('speed 差を y/x より優先する（speed が低くても上位にならない）', () => {
      const units = [
        makeUnit('slow_top_left', 1, 0, 0),
        makeUnit('fast_bottom_right', 9, 4, 4),
      ]
      const sorted = InitiativeQueue.sort(units)
      expect(sorted.map(u => u.id)).toEqual(['fast_bottom_right', 'slow_top_left'])
    })

    it('入力配列を破壊的に変更しない（純粋なソート）', () => {
      const units = [
        makeUnit('a', 1, 0, 0),
        makeUnit('b', 9, 0, 1),
      ]
      const before = units.map(u => u.id)
      InitiativeQueue.sort(units)
      expect(units.map(u => u.id)).toEqual(before)
    })
  })

  describe('next / hasNext（イテレーション）', () => {
    it('構築時に整列され、next() で順番に取り出せる', () => {
      const queue = new InitiativeQueue([
        makeUnit('mid', 3, 0, 0),
        makeUnit('high', 5, 0, 1),
        makeUnit('low', 1, 0, 2),
      ])
      expect(queue.next()?.id).toBe('high')
      expect(queue.next()?.id).toBe('mid')
      expect(queue.next()?.id).toBe('low')
    })

    it('全て取り出すと hasNext() が false になり next() は undefined を返す', () => {
      const queue = new InitiativeQueue([makeUnit('a', 5, 0, 0)])
      expect(queue.hasNext()).toBe(true)
      expect(queue.next()?.id).toBe('a')
      expect(queue.hasNext()).toBe(false)
      expect(queue.next()).toBeUndefined()
    })

    it('空のキューは最初から hasNext() が false', () => {
      const queue = new InitiativeQueue([])
      expect(queue.hasNext()).toBe(false)
      expect(queue.next()).toBeUndefined()
    })
  })

  describe('reset / remaining', () => {
    it('reset() でキューを再構築し index を先頭へ戻す', () => {
      const queue = new InitiativeQueue([makeUnit('a', 5, 0, 0)])
      queue.next()
      expect(queue.hasNext()).toBe(false)

      queue.reset([
        makeUnit('x', 2, 0, 0),
        makeUnit('y', 8, 0, 1),
      ])
      expect(queue.hasNext()).toBe(true)
      expect(queue.next()?.id).toBe('y')
      expect(queue.next()?.id).toBe('x')
    })

    it('remaining() は未処理ユニットのみを行動順で返す', () => {
      const queue = new InitiativeQueue([
        makeUnit('high', 5, 0, 0),
        makeUnit('mid', 3, 0, 1),
        makeUnit('low', 1, 0, 2),
      ])
      queue.next() // high を消費
      expect(queue.remaining().map(u => u.id)).toEqual(['mid', 'low'])
    })
  })
})
