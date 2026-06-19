import { describe, it, expect } from 'vitest'
import { Board } from '../../src/engine/Board'
import { createUnit } from '../../src/data/unitTemplates'
import { setupBattle } from '../../src/ui/setupBattle'
import type { UnitType, Side } from '../../src/types/unit'
import type { Direction } from '../../src/types/direction'

/** specs から盤面を組み立てる（createUnit でテンプレ既定値を使う）。 */
function makeBoard(
  width: number,
  height: number,
  specs: Array<{ type: UnitType; side?: Side; x: number; y: number; facing?: Direction }>,
): Board {
  const board = new Board(width, height)
  specs.forEach((s, i) => {
    board.placeUnit(createUnit(s.type, s.side ?? 'player', { x: s.x, y: s.y }, s.facing ?? 'up', String(i)))
  })
  return board
}

/** 盤面を「型・陣営・座標・facing」に要約し読み順で安定ソート（id は比較対象外）。 */
function summarize(board: Board): Array<{ type: UnitType; side: Side; x: number; y: number; facing: Direction }> {
  return board
    .getAllUnits()
    .map(u => ({ type: u.type, side: u.side, x: u.position.x, y: u.position.y, facing: u.facing }))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.type.localeCompare(b.type))
}

describe('setupBattle (T22)', () => {
  it('相手盤を上下ミラーし enemy 側へ反転して合成する（自盤はそのまま）', () => {
    // 自盤: player を下段（h=7 なので y=6）に置く。
    const myBoard = makeBoard(7, 7, [
      { type: 'core', x: 3, y: 6, facing: 'up' },
      { type: 'pusher', x: 3, y: 5, facing: 'up' },
    ])
    // 相手盤: 相手が「自分の構築」として player・下段・up 向きで作ったもの。
    const oppBoard = makeBoard(7, 7, [
      { type: 'core', x: 1, y: 6, facing: 'up' },
      { type: 'pusher', x: 1, y: 5, facing: 'up' },
    ])

    const merged = setupBattle(myBoard, oppBoard)

    // summarize は読み順（y 昇順）でソートする。相手は上下ミラー（y'=6-y）＋ side=enemy
    // ＋ facing 上下反転（up→down）。自盤はそのまま。
    expect(summarize(merged)).toEqual([
      { type: 'core', side: 'enemy', x: 1, y: 0, facing: 'down' },
      { type: 'pusher', side: 'enemy', x: 1, y: 1, facing: 'down' },
      { type: 'pusher', side: 'player', x: 3, y: 5, facing: 'up' },
      { type: 'core', side: 'player', x: 3, y: 6, facing: 'up' },
    ])
  })

  it('左右向き（left/right）は上下ミラーで変わらない', () => {
    const myBoard = makeBoard(5, 5, [{ type: 'core', x: 0, y: 4, facing: 'up' }])
    const oppBoard = makeBoard(5, 5, [
      { type: 'core', x: 0, y: 4, facing: 'up' },
      { type: 'pusher', x: 1, y: 4, facing: 'right' },
      { type: 'pusher', x: 2, y: 4, facing: 'left' },
    ])

    const merged = setupBattle(myBoard, oppBoard)
    const enemies = merged.getUnitsBySide('enemy')

    const right = enemies.find(u => u.position.x === 1)
    const left = enemies.find(u => u.position.x === 2)
    expect(right?.facing).toBe('right')
    expect(left?.facing).toBe('left')
  })

  it('合成盤は元と同じサイズで、両陣営のコアが存在する', () => {
    const myBoard = makeBoard(7, 7, [{ type: 'core', x: 3, y: 6, facing: 'up' }])
    const oppBoard = makeBoard(7, 7, [{ type: 'core', x: 3, y: 6, facing: 'up' }])

    const merged = setupBattle(myBoard, oppBoard)

    expect(merged.width).toBe(7)
    expect(merged.height).toBe(7)
    expect(merged.getUnitsBySide('player').some(u => u.type === 'core')).toBe(true)
    expect(merged.getUnitsBySide('enemy').some(u => u.type === 'core')).toBe(true)
  })

  it('盤面サイズが一致しなければ例外', () => {
    const myBoard = makeBoard(7, 7, [{ type: 'core', x: 3, y: 6, facing: 'up' }])
    const oppBoard = makeBoard(5, 5, [{ type: 'core', x: 2, y: 4, facing: 'up' }])
    expect(() => setupBattle(myBoard, oppBoard)).toThrow()
  })

  it('合成で同一升が重なると例外（placeUnit が throw）', () => {
    // 相手のコアが y=0 にミラーされる位置に、自盤も同じ升を占める配置。
    const myBoard = makeBoard(5, 5, [{ type: 'core', x: 2, y: 0, facing: 'up' }])
    const oppBoard = makeBoard(5, 5, [{ type: 'core', x: 2, y: 4, facing: 'up' }])
    expect(() => setupBattle(myBoard, oppBoard)).toThrow()
  })

  it('決定論: 同入力なら合成結果（型/陣営/座標/facing）が完全一致', () => {
    const build = (): Board =>
      makeBoard(7, 7, [
        { type: 'core', x: 3, y: 6, facing: 'up' },
        { type: 'reactor', x: 2, y: 5, facing: 'up' },
        { type: 'bomber', x: 4, y: 5, facing: 'up' },
      ])
    const opp = (): Board =>
      makeBoard(7, 7, [
        { type: 'core', x: 3, y: 6, facing: 'up' },
        { type: 'pusher', x: 3, y: 5, facing: 'up' },
      ])

    expect(summarize(setupBattle(build(), opp()))).toEqual(summarize(setupBattle(build(), opp())))
  })
})
