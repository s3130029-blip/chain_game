import type { Unit, Side } from '../types/unit'
import type { Position, BoardState } from '../types/board'
import type { Direction } from '../types/direction'
import { DIR_DELTA } from '../types/direction'

export class Board {
  readonly width: number
  readonly height: number
  private unitMap: Map<string, Unit>
  private posMap: Map<string, Unit>

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.unitMap = new Map()
    this.posMap = new Map()
  }

  posKey(pos: Position): string {
    return `${pos.x},${pos.y}`
  }

  isInBounds(pos: Position): boolean {
    return pos.x >= 0 && pos.x < this.width && pos.y >= 0 && pos.y < this.height
  }

  isEmpty(pos: Position): boolean {
    return !this.posMap.has(this.posKey(pos))
  }

  getUnit(id: string): Unit | undefined {
    return this.unitMap.get(id)
  }

  getUnitAt(pos: Position): Unit | undefined {
    return this.posMap.get(this.posKey(pos))
  }

  // 上下左右4マスのユニットを読み順（y昇順→x昇順）で返す
  getAdjacentUnits(pos: Position): Unit[] {
    const dirs: Direction[] = ['up', 'down', 'left', 'right']
    const result: Unit[] = []
    for (const dir of dirs) {
      const { dx, dy } = DIR_DELTA[dir]
      const adj = { x: pos.x + dx, y: pos.y + dy }
      const unit = this.getUnitAt(adj)
      if (unit !== undefined) {
        result.push(unit)
      }
    }
    // 決定論のため読み順（y昇順→x昇順）でソート
    result.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    return result
  }

  // dir 方向にいる全ユニットを近い順に返す（起点自身を除く）
  getUnitsInLine(pos: Position, dir: Direction): Unit[] {
    const { dx, dy } = DIR_DELTA[dir]
    const result: Unit[] = []
    let cur = { x: pos.x + dx, y: pos.y + dy }
    while (this.isInBounds(cur)) {
      const unit = this.getUnitAt(cur)
      if (unit !== undefined) {
        result.push(unit)
      }
      cur = { x: cur.x + dx, y: cur.y + dy }
    }
    return result
  }

  getAllUnits(): Unit[] {
    return Array.from(this.unitMap.values())
  }

  getUnitsBySide(side: Side): Unit[] {
    return this.getAllUnits().filter(u => u.side === side)
  }

  placeUnit(unit: Unit): void {
    if (!this.isInBounds(unit.position)) {
      throw new Error(
        `Position (${unit.position.x},${unit.position.y}) is out of bounds for board ${this.width}x${this.height}`
      )
    }
    const key = this.posKey(unit.position)
    if (this.posMap.has(key)) {
      throw new Error(
        `Position (${unit.position.x},${unit.position.y}) is already occupied`
      )
    }
    if (this.unitMap.has(unit.id)) {
      throw new Error(`Unit with id "${unit.id}" already exists on this board`)
    }
    this.unitMap.set(unit.id, unit)
    this.posMap.set(key, unit)
  }

  removeUnit(id: string): void {
    const unit = this.unitMap.get(id)
    if (unit === undefined) return
    this.unitMap.delete(id)
    this.posMap.delete(this.posKey(unit.position))
  }

  moveUnit(id: string, to: Position): void {
    const unit = this.unitMap.get(id)
    if (unit === undefined) {
      throw new Error(`Unit "${id}" not found`)
    }
    if (!this.isInBounds(to)) {
      throw new Error(
        `Target position (${to.x},${to.y}) is out of bounds for board ${this.width}x${this.height}`
      )
    }
    this.posMap.delete(this.posKey(unit.position))
    const updated: Unit = { ...unit, position: { ...to } }
    this.unitMap.set(id, updated)
    this.posMap.set(this.posKey(to), updated)
  }

  updateUnit(id: string, partial: Partial<Unit>): void {
    const unit = this.unitMap.get(id)
    if (unit === undefined) {
      throw new Error(`Unit "${id}" not found`)
    }
    const updated: Unit = { ...unit, ...partial }
    // position 変更を伴う場合は posMap も更新
    if (partial.position !== undefined) {
      this.posMap.delete(this.posKey(unit.position))
      this.posMap.set(this.posKey(updated.position), updated)
    } else {
      this.posMap.set(this.posKey(unit.position), updated)
    }
    this.unitMap.set(id, updated)
  }

  clone(): Board {
    const b = new Board(this.width, this.height)
    for (const unit of this.unitMap.values()) {
      const copy: Unit = {
        ...unit,
        position: { ...unit.position },
        triggers: unit.triggers.map(t => ({
          on: t.on,
          effect: { ...t.effect },
        })),
      }
      b.placeUnit(copy)
    }
    return b
  }

  toSnapshot(): BoardState {
    return {
      width: this.width,
      height: this.height,
      units: new Map(this.unitMap),
      turn: 0,
      stepCount: 0,
      phase: 'battle',
    }
  }
}
