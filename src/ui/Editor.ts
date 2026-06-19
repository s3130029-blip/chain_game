import { Board } from '../engine/Board'
import { createUnit } from '../data/unitTemplates'
import { encodeBoard } from '../share/encode'
import { BoardView } from './BoardView'
import type { Position } from '../types/board'
import type { UnitType } from '../types/unit'
import type { Direction } from '../types/direction'

// 盤面エディタ（tasks.md T20）。クリック/タップで 6 種ユニットを配置・撤去・向き変更し、
// コスト上限内で構築して encodeBoard で共有コードへ変換する。
//
// 盤面サイズとプレイヤー陣地行数は道場相手（dojo/opponents.ts）に合わせた仮値で、
// 相手構築（上半分の enemy 布陣）と対称に自陣を下半分へ置く。
// コスト上限はバランス値であり、CLAUDE.md §8 によりフェーズ3 / T24 まで据え置く。

const BOARD_W = 7
const BOARD_H = 7
// 下 PLAYER_ROWS 行がプレイヤー陣地（道場相手は上 3 行に布陣するため対称に下 3 行）。
const PLAYER_ROWS = 3
// 配置コストの上限（仮値。T24 のバランス調整まで凍結）。
const COST_BUDGET = 12

const UNIT_TYPES: readonly UnitType[] = ['pusher', 'reactor', 'bomber', 'magnet', 'swapper', 'core']

const UNIT_LABEL: Record<UnitType, string> = {
  pusher: 'プッシャー',
  reactor: 'リアクター',
  bomber: 'ボマー',
  magnet: 'マグネット',
  swapper: 'スワッパー',
  core: 'コア',
}

const GLYPH: Record<UnitType, string> = {
  pusher: 'P',
  reactor: 'R',
  bomber: 'B',
  magnet: 'M',
  swapper: 'S',
  core: '◎',
}

// コストは unitTemplates を唯一の真実とし、テンプレ生成から読み取る（UI 側で二重定義しない）。
const UNIT_COST: Record<UnitType, number> = (() => {
  const out = {} as Record<UnitType, number>
  for (const t of UNIT_TYPES) {
    out[t] = createUnit(t, 'player', { x: 0, y: 0 }, 'up', `tpl_${t}`).cost
  }
  return out
})()

// 既存ユニットの向き回転順（タップのたびに次へ送る）。
const ROTATION: readonly Direction[] = ['up', 'right', 'down', 'left']

type Brush = UnitType | 'erase'

export class Editor {
  readonly el: HTMLDivElement
  private readonly board: Board
  private readonly view: BoardView
  private brush: Brush = 'pusher'
  private idSeq = 0

  private readonly paletteButtons = new Map<Brush, HTMLButtonElement>()
  private readonly costEl: HTMLSpanElement
  private readonly hintEl: HTMLSpanElement
  private readonly codeEl: HTMLTextAreaElement

  constructor() {
    this.board = new Board(BOARD_W, BOARD_H)
    this.view = new BoardView(BOARD_W, BOARD_H, {
      onCellClick: pos => this.handleCellClick(pos),
      playerRows: PLAYER_ROWS,
    })

    this.costEl = document.createElement('span')
    this.costEl.className = 'cost'

    this.hintEl = document.createElement('span')
    this.hintEl.className = 'hint'

    this.codeEl = document.createElement('textarea')
    this.codeEl.className = 'code__out'
    this.codeEl.readOnly = true
    this.codeEl.rows = 3
    this.codeEl.placeholder = '「共有コードを生成」を押すとここにコードが出ます'

    const el = document.createElement('div')
    el.className = 'editor'
    el.appendChild(this.buildPalette())
    el.appendChild(this.view.el)
    el.appendChild(this.buildFooter())
    el.appendChild(this.buildCodeArea())

    this.el = el
    this.refresh()
  }

  // 構築中の盤面（共有・対戦実行は後続タスクが getBoard を使って合成する）。
  getBoard(): Board {
    return this.board
  }

  getCode(): string {
    return encodeBoard(this.board)
  }

  private buildPalette(): HTMLElement {
    const palette = document.createElement('div')
    palette.className = 'palette'
    for (const t of UNIT_TYPES) {
      palette.appendChild(this.makeBrushButton(t, `${GLYPH[t]} ${UNIT_LABEL[t]}（${UNIT_COST[t]}）`))
    }
    palette.appendChild(this.makeBrushButton('erase', '🧹 撤去'))
    return palette
  }

  private makeBrushButton(brush: Brush, label: string): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'palette__btn'
    btn.textContent = label
    btn.addEventListener('click', () => {
      this.brush = brush
      this.updatePaletteActive()
    })
    this.paletteButtons.set(brush, btn)
    return btn
  }

  private buildFooter(): HTMLElement {
    const footer = document.createElement('div')
    footer.className = 'editor__footer'
    footer.append(this.costEl, this.hintEl)
    return footer
  }

  private buildCodeArea(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'code'

    const genBtn = document.createElement('button')
    genBtn.type = 'button'
    genBtn.className = 'code__btn'
    genBtn.textContent = '共有コードを生成'
    genBtn.addEventListener('click', () => this.generateCode())

    const clearBtn = document.createElement('button')
    clearBtn.type = 'button'
    clearBtn.className = 'code__btn'
    clearBtn.textContent = 'クリア'
    clearBtn.addEventListener('click', () => this.clearBoard())

    const buttons = document.createElement('div')
    buttons.className = 'code__buttons'
    buttons.append(genBtn, clearBtn)

    wrap.append(buttons, this.codeEl)
    return wrap
  }

  private handleCellClick(pos: Position): void {
    const brush = this.brush

    // 自陣（下半分）以外には配置・操作させない。
    if (pos.y < BOARD_H - PLAYER_ROWS) {
      this.warn('自陣（下半分）にのみ配置できます')
      return
    }

    const existing = this.board.getUnitAt(pos)

    if (brush === 'erase') {
      if (existing !== undefined) {
        this.board.removeUnit(existing.id)
        this.refresh()
      }
      return
    }

    if (existing !== undefined) {
      // 既存ユニットは向きを回転（up→right→down→left）。
      const next = ROTATION[(ROTATION.indexOf(existing.facing) + 1) % ROTATION.length] ?? 'up'
      this.board.updateUnit(existing.id, { facing: next })
      this.refresh()
      return
    }

    // 空きマスへ配置（コスト上限チェック）。プレイヤー側は敵（上）へ向かう 'up' を既定とする。
    if (this.currentCost() + UNIT_COST[brush] > COST_BUDGET) {
      this.warn(`コスト上限 ${COST_BUDGET} を超えます`)
      return
    }
    this.board.placeUnit(createUnit(brush, 'player', pos, 'up', String(this.idSeq++)))
    this.refresh()
  }

  private clearBoard(): void {
    for (const u of this.board.getAllUnits()) {
      this.board.removeUnit(u.id)
    }
    this.codeEl.value = ''
    this.refresh()
  }

  private generateCode(): void {
    const code = this.getCode()
    this.codeEl.value = code
    this.codeEl.select()
    // クリップボードへのコピーはベストエフォート（権限のない環境でも編集は継続できる）。
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(code).catch(() => undefined)
    }
  }

  private currentCost(): number {
    return this.board.getAllUnits().reduce((sum, u) => sum + u.cost, 0)
  }

  private refresh(): void {
    this.view.render(this.board)
    this.updatePaletteActive()

    const cost = this.currentCost()
    this.costEl.textContent = `コスト: ${cost} / ${COST_BUDGET}`
    this.costEl.classList.toggle('cost--over', cost > COST_BUDGET)

    this.updateValidityHint()
  }

  private updatePaletteActive(): void {
    for (const [brush, btn] of this.paletteButtons) {
      btn.classList.toggle('palette__btn--active', brush === this.brush)
    }
  }

  private updateValidityHint(): void {
    const units = this.board.getAllUnits()
    this.hintEl.classList.remove('hint--warn')
    if (units.length === 0) {
      this.hintEl.textContent = 'パレットで種類を選び、自陣をタップして配置'
    } else if (!units.some(u => u.type === 'core')) {
      this.hintEl.textContent = '⚠ コア未配置（対戦コードにはコアが必須）'
      this.hintEl.classList.add('hint--warn')
    } else {
      this.hintEl.textContent = `ユニット ${units.length} 体・コア配置済み`
    }
  }

  // 即時の警告表示。次の refresh() で妥当性ヒントへ戻る。
  private warn(message: string): void {
    this.hintEl.textContent = message
    this.hintEl.classList.add('hint--warn')
  }
}
