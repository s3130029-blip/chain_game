import type { Board } from '../engine/Board'
import type { Position } from '../types/board'
import type { Unit, UnitType } from '../types/unit'
import type { Direction } from '../types/direction'

// 盤面（Board）を CSS Grid の DOM へ描画する純粋な表示コンポーネント（tasks.md T20）。
// エンジン本体（BattleEngine 等）は import せず、データ構造としての Board だけを
// type-only で参照して読む。エディタ（T20）とリプレイ（T21）で共用する。

const GLYPH: Record<UnitType, string> = {
  pusher: 'P',
  reactor: 'R',
  bomber: 'B',
  magnet: 'M',
  swapper: 'S',
  core: '◎',
}

const ARROW: Record<Direction, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

export interface BoardViewOptions {
  // セルクリック時に押された盤面座標を受け取るハンドラ（エディタ用）。
  onCellClick?: (pos: Position) => void
  // 下から数えてプレイヤー陣地とみなす行数（陣地の色分け用。0 で色分けなし）。
  playerRows?: number
}

export class BoardView {
  readonly el: HTMLDivElement
  private readonly cells: ReadonlyArray<{ x: number; y: number; el: HTMLDivElement }>
  private readonly onCellClick: ((pos: Position) => void) | undefined

  constructor(width: number, height: number, options: BoardViewOptions = {}) {
    this.onCellClick = options.onCellClick
    const playerRows = options.playerRows ?? 0

    const el = document.createElement('div')
    el.className = 'board'
    el.style.gridTemplateColumns = `repeat(${width}, 1fr)`

    const cells: Array<{ x: number; y: number; el: HTMLDivElement }> = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = document.createElement('div')
        cell.className = 'board__cell'
        if (playerRows > 0) {
          cell.classList.add(
            y >= height - playerRows ? 'board__cell--player-zone' : 'board__cell--enemy-zone',
          )
        }
        const pos: Position = { x, y }
        cell.addEventListener('click', () => {
          this.onCellClick?.(pos)
        })
        el.appendChild(cell)
        cells.push({ x, y, el: cell })
      }
    }

    this.cells = cells
    this.el = el
  }

  // 現在の盤面状態を全セルへ反映する（差分描画はせず単純に再構築）。
  render(board: Board): void {
    for (const cell of this.cells) {
      cell.el.replaceChildren()
      const unit = board.getUnitAt({ x: cell.x, y: cell.y })
      if (unit !== undefined) {
        cell.el.appendChild(renderUnit(unit))
      }
    }
  }
}

function renderUnit(unit: Unit): HTMLElement {
  const node = document.createElement('div')
  node.className = `unit unit--${unit.side}`

  const glyph = document.createElement('span')
  glyph.className = 'unit__glyph'
  glyph.textContent = GLYPH[unit.type]
  node.appendChild(glyph)

  // コアは行動しないため向き矢印を出さない。
  if (unit.type !== 'core') {
    const arrow = document.createElement('span')
    arrow.className = 'unit__arrow'
    arrow.textContent = ARROW[unit.facing]
    node.appendChild(arrow)
  }

  return node
}
