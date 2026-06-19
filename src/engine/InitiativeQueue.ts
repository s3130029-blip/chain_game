import type { Unit } from '../types/unit'

/**
 * 決定論的な行動順を管理するキュー。
 * 1ターン内で speed 降順（同値は読み順 y→x 昇順）にユニットを取り出す。
 */
export class InitiativeQueue {
  private queue: Unit[]
  private index: number

  constructor(units: Unit[]) {
    this.queue = InitiativeQueue.sort(units)
    this.index = 0
  }

  /**
   * 行動順にソートした新しい配列を返す（入力は変更しない）。
   * なぜ明示ソートか: Map/Set の列挙順に依存すると環境差で行動順が変わり、
   * 決定論（同一盤面→同一イベント列）が崩れるため（CLAUDE.md §5）。
   * 1. speed 降順
   * 2. 同値なら position.y 昇順
   * 3. さらに同値なら position.x 昇順
   * 盤上で同一座標に2体は存在しないため、(speed,y,x) の比較で全順序が一意に定まる。
   */
  static sort(units: Unit[]): Unit[] {
    return [...units].sort(
      (a, b) =>
        b.speed - a.speed ||
        a.position.y - b.position.y ||
        a.position.x - b.position.x,
    )
  }

  /** 次の行動ユニットを返す。残りがなければ undefined。 */
  next(): Unit | undefined {
    if (this.index >= this.queue.length) return undefined
    const unit = this.queue[this.index]
    this.index++
    return unit
  }

  hasNext(): boolean {
    return this.index < this.queue.length
  }

  /** ターン開始時に行動順を再構築し、先頭へ戻す。 */
  reset(units: Unit[]): void {
    this.queue = InitiativeQueue.sort(units)
    this.index = 0
  }

  /** 未処理（これから行動する）ユニットを行動順で返す。デバッグ用。 */
  remaining(): Unit[] {
    return this.queue.slice(this.index)
  }
}
