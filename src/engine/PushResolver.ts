import type { Position } from '../types/board'
import type { Direction } from '../types/direction'
import { DIR_DELTA } from '../types/direction'
import type { BattleEvent } from '../types/event'
import type { Board } from './Board'

export interface PushResult {
  moved: Array<{ unitId: string; from: Position; to: Position }>
  destroyed: string[]
  events: BattleEvent[]
}

/**
 * 押し出しの再帰的解決。連鎖押しと盤外撃破を担う。
 *
 * 仕様（architecture §7-3 / test-spec §0 で確定）:
 *  1. dest = pos + DIR_DELTA[dir]
 *  2. dest が盤外      → そのユニットを撃破（unit_destroy / cause:'offBoard'）。升は空く。
 *  3. dest にユニット  → 先にそのユニットを同方向へ再帰 push（連鎖押し）。
 *  4. dest が空        → 元のユニットを移動（unit_push）。
 *
 * なぜ「先に前方を解決」か: 前方ユニットは必ず「移動」か「盤外撃破」で升を空けるため、
 * 再帰で前方から解決すれば後方が押し込める。これにより
 *  - 恒久的な詰まりが存在しない（盤外で必ず収束）
 *  - イベント順が「前方ユニット → 後方ユニット」で決定論的になる（test-spec PR-06〜08）。
 */
export class PushResolver {
  /**
   * unitId を dir 方向へ1マス押す。押し先にユニットがいれば連鎖押し。
   * board を直接更新し、発生イベント・移動・撃破を PushResult で返す。
   */
  push(board: Board, unitId: string, dir: Direction, step: number): PushResult {
    const result: PushResult = { moved: [], destroyed: [], events: [] }
    this.pushOne(board, unitId, dir, step, result)
    return result
  }

  /** 1ユニットの押しを再帰的に解決し、result を破壊的に積み上げる。 */
  private pushOne(
    board: Board,
    unitId: string,
    dir: Direction,
    step: number,
    result: PushResult,
  ): void {
    const unit = board.getUnit(unitId)
    // 連鎖の途中で既に撃破済み等で盤上にいなければ何もしない。
    if (unit === undefined) return

    const from: Position = { ...unit.position }
    const { dx, dy } = DIR_DELTA[dir]
    const dest: Position = { x: from.x + dx, y: from.y + dy }

    // 2. 盤外 → 撃破。lastPos は撃破直前の盤上座標（from）。
    if (!board.isInBounds(dest)) {
      board.removeUnit(unitId)
      result.destroyed.push(unitId)
      result.events.push({
        step,
        kind: 'unit_destroy',
        unitId,
        from,
        dir,
        metadata: { cause: 'offBoard' },
      })
      return
    }

    // 3. 押し先にユニットがいれば、先にそれを同方向へ押す（連鎖押し）。
    const occupant = board.getUnitAt(dest)
    if (occupant !== undefined) {
      this.pushOne(board, occupant.id, dir, step, result)
    }

    // 前方解決後も dest が埋まっているケースは盤外撃破ルール上発生しない（恒久的詰まりなし）。
    // 不変条件の防御として、空いていなければ移動しない。
    if (!board.isEmpty(dest)) return

    // 4. 移動。
    board.moveUnit(unitId, dest)
    result.moved.push({ unitId, from, to: { ...dest } })
    result.events.push({
      step,
      kind: 'unit_push',
      unitId,
      from,
      to: { ...dest },
      dir,
    })
  }
}
