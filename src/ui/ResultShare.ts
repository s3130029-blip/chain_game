import type { BattleResult, WinReason } from '../types/battle'
import type { BattleEvent } from '../types/event'
import type { Side, TriggerEffectKind } from '../types/unit'

// 結果シェア（tasks.md T25）。Wordle 方式の「ネタバレ抑制」シェアテキストを生成し、
// コピーできる小さな DOM パネルとして提供する。
//
// 設計（CLAUDE.md §6 / architecture.md フェーズ2 DAG）:
//  - 依存は types のみ（engine/Board を import しない）。整形は BattleResult から導ける情報だけで行う。
//  - 整形ロジックは純粋関数 formatResultShare に切り出し、node 環境で単体テストできるようにする
//    （勝敗・最大連鎖・決め手・絵文字グリッド・SNS に収まる長さ・決定論を固定する）。
//  - 盤面は出さない（ネタバレ抑制）。出すのは「勝敗・最大連鎖数・決め手」と連鎖の“形”を表す絵文字のみ。

const TITLE = '連鎖要塞 / CASCADE'

const OUTCOME: Record<Side | 'draw', { emoji: string; label: string }> = {
  player: { emoji: '🏆', label: '勝利' },
  enemy: { emoji: '💀', label: '敗北' },
  draw: { emoji: '🤝', label: '引き分け' },
}

const REASON_LABEL: Record<WinReason, string> = {
  core_destroyed: 'コア撃破',
  unit_count: '生存数',
  core_hp: 'コアHP',
  total_hp: '総HP',
  timeout: '時間切れ',
}

const EFFECT_LABEL: Record<TriggerEffectKind, string> = {
  push_target: '押し出し',
  push_self: '自走',
  pull_nearest: '引き寄せ',
  explode: '爆発',
  swap_adjacent: '位置交換',
}

// 連鎖の強さ → 絵文字（Wordle 風の濃淡。index = そのラウンドの連鎖深度、0=静かなラウンド〜4+=大連鎖）。
const INTENSITY = ['⬜', '🟦', '🟩', '🟨', '🟧'] as const

/**
 * BattleResult を Wordle 方式のシェアテキストへ整形する（純粋・決定論的）。
 *
 * 形式（4行）:
 *   連鎖要塞 / CASCADE
 *   🏆 勝利 ／ 🔗最大連鎖 ×4
 *   🟦⬜🟩🟧            ← ラウンドごとの連鎖の“形”（盤面ネタバレなし）
 *   決め手: 爆発
 *
 * 盤面・座標・ユニット名は一切出さない（ネタバレ抑制）。絵文字グリッドは「どのラウンドで
 * どれくらいの連鎖が起きたか」の濃淡だけを示す。
 */
export function formatResultShare(result: BattleResult): string {
  const outcome = OUTCOME[result.winner]
  const head = `${outcome.emoji} ${outcome.label} ／ 🔗最大連鎖 ×${result.maxChainDepth}`
  const grid = chainGrid(result.events).map(intensityEmoji).join('') || INTENSITY[0]
  const decisive = `決め手: ${decisiveMove(result)}`
  return [TITLE, head, grid, decisive].join('\n')
}

function intensityEmoji(depth: number): string {
  const i = Math.min(Math.max(depth, 0), INTENSITY.length - 1)
  return INTENSITY[i] ?? '⬜'
}

/**
 * ラウンドごとの最大連鎖深度を読み順（ラウンド昇順）の配列で返す。
 * 連鎖深度 = そのラウンドの各手番で発火した trigger_fire 数の最大値。
 * これは engine の maxChainDepth と同じ尺度なので、グリッドの最大値は result.maxChainDepth に一致する。
 * Map の列挙順には依存せず、キーを明示ソートする（決定論。CLAUDE.md §5）。
 */
function chainGrid(events: readonly BattleEvent[]): number[] {
  const roundMax = new Map<number, number>()
  let round = 0
  let fires = 0
  const flush = (): void => {
    if (round > 0) roundMax.set(round, Math.max(roundMax.get(round) ?? 0, fires))
  }
  for (const ev of events) {
    if (ev.kind === 'turn_start') {
      flush()
      fires = 0
      const r = ev.metadata?.['round']
      if (typeof r === 'number') round = r
    } else if (ev.kind === 'trigger_fire') {
      fires++
    }
  }
  flush()
  return [...roundMax.keys()].sort((a, b) => a - b).map(r => roundMax.get(r) ?? 0)
}

/**
 * 決め手を導く（盤面非依存・events だけで判定）。
 *  - コア撃破: 決着直前に発火した最後の効果（爆発・引き寄せ等）。トリガー無しの直撃なら「直接押し出し」。
 *  - それ以外（タイブレーク決着）: 勝因ラベルをそのまま使う。
 */
function decisiveMove(result: BattleResult): string {
  if (result.reason !== 'core_destroyed') return REASON_LABEL[result.reason]
  for (let i = result.events.length - 1; i >= 0; i--) {
    const ev = result.events[i]
    if (ev?.kind === 'trigger_fire' && ev.effectKind !== undefined) {
      return EFFECT_LABEL[ev.effectKind]
    }
  }
  return '直接押し出し'
}

export interface ResultShareOptions {
  // シェア文末に付ける案内行（例: ゲームを遊ぶ URL）。盤面を含む URL は渡さない（ネタバレ抑制）。
  invite?: string
}

/**
 * 結果シェアの DOM パネル。整形済みテキストを表示し、ワンタップでコピーできる。
 * クリップボード書き込みはベストエフォート（権限の無い環境でもテキストは選択済みで手動コピー可能）。
 */
export class ResultShare {
  readonly el: HTMLDivElement
  private readonly textArea: HTMLTextAreaElement
  private readonly hint: HTMLDivElement
  private readonly shareText: string

  constructor(result: BattleResult, options: ResultShareOptions = {}) {
    const base = formatResultShare(result)
    this.shareText =
      options.invite !== undefined && options.invite !== ''
        ? `${base}\n${options.invite}`
        : base

    this.el = document.createElement('div')
    this.el.className = 'code'

    const title = document.createElement('div')
    title.className = 'hint'
    title.textContent = '結果をシェア（盤面ネタバレなし）'

    this.textArea = document.createElement('textarea')
    this.textArea.className = 'code__out'
    this.textArea.readOnly = true
    this.textArea.rows = 5
    this.textArea.value = this.shareText

    this.hint = document.createElement('div')
    this.hint.className = 'hint'

    const copyBtn = makeButton('📋 結果をコピー', () => this.copy())
    const buttons = document.createElement('div')
    buttons.className = 'code__buttons'
    buttons.append(copyBtn)

    this.el.append(title, this.textArea, buttons, this.hint)
  }

  private copy(): void {
    this.textArea.select()
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(this.shareText).catch(() => undefined)
    }
    this.hint.textContent = 'コピーしました。SNS に貼ってシェアできます。'
    this.hint.classList.remove('hint--warn')
  }
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'code__btn'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}
