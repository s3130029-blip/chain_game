import { decodeBoard } from '../share/decode'
import type { Board } from '../engine/Board'

// 共有コード／URL 連携（tasks.md T22）。
//  - 自分の構築コードを `?b=<code>` の URL にして配布（コピー）。
//  - 相手の共有コードを貼り付けて読み込み、対戦を起動。
//  - 起動時に URL の `?b=` をパースして相手盤として取り込む。
//
// DOM を扱うのは ShareCode クラスのみ。URL の組立/解析は純粋関数として切り出し、
// node 環境でも単体テストできるようにする（決定論・往復一致をテストで固定）。

// 共有コードを載せる URL クエリパラメータ名。
export const BOARD_QUERY_PARAM = 'b'

/**
 * URL クエリ文字列（`location.search` 相当、先頭 '?' 有無どちらでも可）から共有コードを取り出す。
 * 値が無ければ null。URLSearchParams を使うため、buildShareUrl とエンコードが対称になる。
 */
export function parseBoardCodeFromQuery(search: string): string | null {
  const params = new URLSearchParams(search)
  const code = params.get(BOARD_QUERY_PARAM)
  return code !== null && code !== '' ? code : null
}

/**
 * 自分の構築コードを `?b=<code>` 付き URL にする。
 * origin + pathname を基底にし、既存クエリは捨てる（共有 URL は構築のみを表す）。
 * URLSearchParams で組み立てるので parseBoardCodeFromQuery と往復一致する。
 */
export function buildShareUrl(base: { origin: string; pathname: string }, code: string): string {
  const params = new URLSearchParams()
  params.set(BOARD_QUERY_PARAM, code)
  return `${base.origin}${base.pathname}?${params.toString()}`
}

export interface ShareCodeOptions {
  // 自分の現在の構築コードを返す（URL 生成用。Editor.getCode = encodeBoard）。
  getMyCode: () => string
  // 相手コードを decode できたら、その盤面で対戦を開始する。
  // setupBattle/run 中の例外はここから throw してよい（本クラスが捕捉して表示する）。
  onFight: (oppBoard: Board) => void
}

export class ShareCode {
  readonly el: HTMLDivElement
  private readonly options: ShareCodeOptions
  private readonly input: HTMLTextAreaElement
  private readonly urlOut: HTMLTextAreaElement
  private readonly shareHint: HTMLDivElement
  private readonly fightHint: HTMLDivElement

  constructor(options: ShareCodeOptions) {
    this.options = options

    this.shareHint = makeHint()
    this.urlOut = makeCodeArea('「共有URLを作成」を押すと、ここに貼って渡せる URL が出ます')
    this.fightHint = makeHint()
    this.input = makeCodeArea('相手の共有コード（または ?b= 付き URL）をここに貼り付け')

    this.el = document.createElement('div')
    this.el.className = 'code'
    this.el.append(this.buildShareSection(), this.buildFightSection())
  }

  /**
   * 起動時に URL の `?b=` で渡された相手コードを入力欄へ反映する。
   * 即時対戦にはせず、ユーザーが盤面を確認・編集してから「コードで対戦」を押せるようにする。
   */
  setOpponentCode(code: string): void {
    this.input.value = code
    this.note(this.fightHint, '相手の盤面コードを読み込みました。「コードで対戦」で開始します。')
  }

  // --- 自分の構築を共有（URL） ---

  private buildShareSection(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'code'

    const title = makeHint('自分の構築を共有URLにして渡す')

    const makeUrlBtn = makeButton('共有URLを作成', () => this.makeShareUrl())

    const buttons = document.createElement('div')
    buttons.className = 'code__buttons'
    buttons.append(makeUrlBtn)

    wrap.append(title, buttons, this.urlOut, this.shareHint)
    return wrap
  }

  private makeShareUrl(): void {
    const code = this.options.getMyCode()

    // 渡す前に往復検証する。decode が通らない構築（例：コア未配置）は共有させない。
    try {
      decodeBoard(code)
    } catch (err) {
      this.urlOut.value = ''
      this.warn(this.shareHint, `共有できません: ${messageOf(err)}`)
      return
    }

    const url = buildShareUrl(window.location, code)
    this.urlOut.value = url
    this.urlOut.select()
    // クリップボードへのコピーはベストエフォート（権限の無い環境でも URL は表示済み）。
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url).catch(() => undefined)
    }
    this.note(this.shareHint, 'URL を作成しました（クリップボードにコピー）。相手に渡してください。')
  }

  // --- 相手コードで対戦 ---

  private buildFightSection(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'code'

    const title = makeHint('相手の共有コードを読み込んで対戦する')

    const fightBtn = makeButton('コードで対戦', () => this.fight())

    const buttons = document.createElement('div')
    buttons.className = 'code__buttons'
    buttons.append(fightBtn)

    wrap.append(title, this.input, buttons, this.fightHint)
    return wrap
  }

  private fight(): void {
    const raw = this.input.value.trim()
    if (raw === '') {
      this.warn(this.fightHint, '相手の共有コードを貼り付けてください。')
      return
    }

    // 貼り付けが ?b= 付き URL でも受け付ける（コード部分を取り出す）。
    const code = extractCode(raw)

    let oppBoard: Board
    try {
      oppBoard = decodeBoard(code)
    } catch (err) {
      this.warn(this.fightHint, `相手コードを読み込めません: ${messageOf(err)}`)
      return
    }

    // 成功時は onFight が画面遷移する。setupBattle/run の例外はここで捕捉して表示する。
    try {
      this.options.onFight(oppBoard)
    } catch (err) {
      this.warn(this.fightHint, `対戦を開始できません: ${messageOf(err)}`)
    }
  }

  private note(el: HTMLDivElement, text: string): void {
    el.textContent = text
    el.classList.remove('hint--warn')
  }

  private warn(el: HTMLDivElement, text: string): void {
    el.textContent = text
    el.classList.add('hint--warn')
  }
}

// 貼り付け値が `?b=` 付き URL ならコード部分を取り出す。素のコードならそのまま返す。
function extractCode(raw: string): string {
  const q = raw.indexOf('?')
  if (q !== -1) {
    const fromQuery = parseBoardCodeFromQuery(raw.slice(q))
    if (fromQuery !== null) return fromQuery
  }
  return raw
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'code__btn'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}

function makeHint(text = ''): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'hint'
  el.textContent = text
  return el
}

function makeCodeArea(placeholder: string): HTMLTextAreaElement {
  const ta = document.createElement('textarea')
  ta.className = 'code__out'
  ta.rows = 3
  ta.placeholder = placeholder
  return ta
}
