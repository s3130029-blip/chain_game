import { Board } from '../engine/Board'
import { BoardView } from './BoardView'
import type { BattleResult } from '../types/battle'
import type { BattleEvent, EventKind } from '../types/event'
import type { Unit, UnitType, TriggerEventKind, TriggerEffectKind } from '../types/unit'
import type { WinReason } from '../types/battle'

// リプレイビューア（tasks.md T21）。
// BattleEngine.run() が返す BattleResult.events を step 順に「フレーム」へ展開し、
// 再生 / 一時停止 / 早送り / スキップで観られる「面白さを売る」画面。
//
// 設計の要（CLAUDE.md §5 との関係）:
//  - ゲームロジックは一切持たない。戦闘の真実は events、初期盤面は initialBoard。
//    本クラスは events を初期盤面に当てて各フレームの盤面を再構成し、描画するだけ。
//  - タイマー（setTimeout）は UI 層のこのクラスでのみ使う（エンジン・codec には持ち込まない）。
//  - 全フレームを起動時に確定（決定論的）し、再生はそのインデックス移動に過ぎない。

const UNIT_LABEL: Record<UnitType, string> = {
  pusher: 'プッシャー',
  reactor: 'リアクター',
  bomber: 'ボマー',
  magnet: 'マグネット',
  swapper: 'スワッパー',
  core: 'コア',
}

const TRIGGER_LABEL: Record<TriggerEventKind, string> = {
  on_enter: '出現',
  on_move: '移動',
  on_push_other: '押した',
  on_pushed: '押された',
  on_destroy: '撃破された',
  on_adjacent_enemy: '隣接',
}

const EFFECT_LABEL: Record<TriggerEffectKind, string> = {
  push_target: '押し出し',
  push_self: '自走',
  pull_nearest: '引き寄せ',
  explode: '爆発',
  swap_adjacent: '位置交換',
}

const REASON_LABEL: Record<WinReason, string> = {
  core_destroyed: 'コア撃破',
  unit_count: '生存数',
  core_hp: 'コアHP',
  total_hp: '総HP',
  timeout: '時間切れ',
}

interface Speed {
  label: string
  ms: number
}

// 早送りはこの配列を循環する（既定は先頭の 1×）。
const SPEEDS: readonly Speed[] = [
  { label: '1×', ms: 700 },
  { label: '2×', ms: 350 },
  { label: '4×', ms: 150 },
]
const FALLBACK_SPEED: Speed = { label: '1×', ms: 700 }

interface Frame {
  board: Board
  label: string
  kind: EventKind | 'init'
  round: number
  // そのフレーム時点の連鎖カウント（同一手番で連続発火した trigger_fire 数。非発火フレームは 0）。
  // コンボ表示用。シーク（戻る/最後へ）しても各フレームから一意に決まるよう前計算しておく。
  combo: number
}

export interface ReplayPlayerOptions {
  // 下から数えてプレイヤー陣地とみなす行数（BoardView の色分け用）。
  playerRows?: number
  // 最後のフレームに到達した時に1回だけ呼ばれる（結果シェアの表示など。ネタバレ抑制のため終端で初出）。
  onReachEnd?: () => void
}

export class ReplayPlayer {
  readonly el: HTMLDivElement
  private readonly view: BoardView
  private readonly frames: Frame[]
  private readonly result: BattleResult

  private index = 0
  private playing = false
  private speedIndex = 0
  private timer: number | null = null
  private reachedEnd = false

  // 演出ジュース（タスク T25）。すべて UI 層のみ（決定論には一切影響しない）。
  private muted = false
  private audio: AudioContext | null = null
  private readonly onReachEnd: (() => void) | undefined

  private readonly statusEl: HTMLDivElement
  private readonly progressEl: HTMLDivElement
  private readonly comboEl: HTMLDivElement
  private readonly resultEl: HTMLDivElement
  private readonly playBtn: HTMLButtonElement
  private readonly speedBtn: HTMLButtonElement
  private readonly muteBtn: HTMLButtonElement

  constructor(initialBoard: Board, result: BattleResult, options: ReplayPlayerOptions = {}) {
    this.result = result
    this.onReachEnd = options.onReachEnd
    this.frames = buildFrames(initialBoard, result)
    this.view = new BoardView(initialBoard.width, initialBoard.height, {
      playerRows: options.playerRows ?? Math.floor(initialBoard.height / 2),
    })

    this.statusEl = document.createElement('div')
    this.statusEl.className = 'hint'

    this.progressEl = document.createElement('div')
    this.progressEl.className = 'hint'

    this.comboEl = document.createElement('div')
    this.comboEl.className = 'replay__combo'

    this.resultEl = document.createElement('div')
    this.resultEl.className = 'replay__result'
    this.resultEl.style.fontWeight = '700'
    this.resultEl.style.minHeight = '1.2em'

    this.playBtn = makeButton('▶ 再生', () => this.togglePlay())
    this.speedBtn = makeButton(`⏩ ${this.currentSpeed().label}`, () => this.cycleSpeed())
    this.muteBtn = makeButton('🔊 音あり', () => this.toggleMute())

    const controls = document.createElement('div')
    controls.style.display = 'flex'
    controls.style.flexWrap = 'wrap'
    controls.style.gap = '8px'
    controls.append(
      makeButton('⏮ 先頭', () => this.restart()),
      makeButton('◀ 戻る', () => this.stepBack()),
      this.playBtn,
      makeButton('進む ▶', () => this.stepForward()),
      makeButton('⏭ 最後', () => this.skipToEnd()),
      this.speedBtn,
      this.muteBtn,
    )

    const status = document.createElement('div')
    status.style.display = 'flex'
    status.style.flexWrap = 'wrap'
    status.style.justifyContent = 'space-between'
    status.style.gap = '8px'
    status.append(this.statusEl, this.progressEl)

    const el = document.createElement('div')
    el.className = 'replay'
    el.style.display = 'flex'
    el.style.flexDirection = 'column'
    el.style.gap = '12px'
    el.append(this.view.el, this.comboEl, status, this.resultEl, controls)

    this.el = el
    this.renderCurrent()
  }

  // 画面遷移などで破棄する際に必ず呼ぶ（走行中タイマーを止め、AudioContext を閉じる）。
  dispose(): void {
    this.clearTimer()
    if (this.audio !== null) {
      void this.audio.close().catch(() => undefined)
      this.audio = null
    }
  }

  private currentSpeed(): Speed {
    return SPEEDS[this.speedIndex] ?? FALLBACK_SPEED
  }

  private lastIndex(): number {
    return this.frames.length - 1
  }

  private togglePlay(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  private play(): void {
    // 末尾で再生を押したら先頭から再生し直す（観直しやすさ）。
    if (this.index >= this.lastIndex()) this.index = 0
    this.playing = true
    this.ensureAudio() // 再生ボタンはユーザー操作なので、ここで AudioContext を起こす（自動再生規制対策）。
    this.renderCurrent()
    this.scheduleNext()
  }

  private pause(): void {
    this.playing = false
    this.clearTimer()
    this.updatePlayBtn()
  }

  private scheduleNext(): void {
    this.clearTimer()
    this.timer = window.setTimeout(() => {
      this.timer = null
      if (this.index < this.lastIndex()) {
        this.index++
        this.renderCurrent(true) // 前進フレームなので演出（音・シェイク・コンボ）を出す。
      }
      if (this.index < this.lastIndex()) this.scheduleNext()
      else this.pause()
    }, this.currentSpeed().ms)
  }

  private stepForward(): void {
    this.pause()
    this.ensureAudio()
    if (this.index < this.lastIndex()) {
      this.index++
      this.renderCurrent(true)
    }
  }

  private stepBack(): void {
    this.pause()
    if (this.index > 0) {
      this.index--
      this.renderCurrent()
    }
  }

  private skipToEnd(): void {
    this.pause()
    this.index = this.lastIndex()
    this.renderCurrent()
  }

  private restart(): void {
    this.pause()
    this.index = 0
    this.renderCurrent()
  }

  private cycleSpeed(): void {
    this.speedIndex = (this.speedIndex + 1) % SPEEDS.length
    this.speedBtn.textContent = `⏩ ${this.currentSpeed().label}`
    // 再生中なら新しい間隔で次フレームを取り直す。
    if (this.playing) this.scheduleNext()
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
  }

  // juice=true（前進フレーム）のときだけ音・シェイク・コンボのポップ演出を出す。
  // 戻る/最後へ/初期描画では演出を出さない（連発・耳障りを避ける）。
  private renderCurrent(juice = false): void {
    const frame = this.frames[this.index]
    if (frame === undefined) return

    this.view.render(frame.board)
    const roundTag = frame.round > 0 ? `R${frame.round}` : '—'
    this.statusEl.textContent = `[${roundTag}] ${frame.label}`
    this.progressEl.textContent = `${this.index} / ${this.lastIndex()}`

    // コンボ（連鎖）表示: 2 連鎖以上で点灯。各フレームの combo から一意に決まる（シーク安全）。
    this.comboEl.textContent = frame.combo >= 2 ? `🔥 ${frame.combo} 連鎖!` : ''

    if (juice) this.emitJuice(frame)

    // 結果は最後まで再生して初めて見せる（ネタバレ防止）。
    const atEnd = this.index === this.lastIndex()
    this.resultEl.textContent = atEnd ? resultText(this.result) : ''
    if (atEnd && !this.reachedEnd) {
      this.reachedEnd = true
      this.onReachEnd?.()
    }

    this.updatePlayBtn()
  }

  // フレーム種別に応じた手応え演出。撃破は強く（低音＋盤面シェイク）、連鎖発火は連鎖数に応じた高音＋ポップ。
  private emitJuice(frame: Frame): void {
    switch (frame.kind) {
      case 'unit_destroy':
        this.shake()
        this.beep(150, 180)
        break
      case 'trigger_fire':
        this.beep(320 + frame.combo * 70, 110)
        if (frame.combo >= 2) {
          this.popCombo()
          this.shake()
        }
        break
      default:
        break
    }
  }

  private toggleMute(): void {
    this.muted = !this.muted
    this.muteBtn.textContent = this.muted ? '🔇 ミュート' : '🔊 音あり'
  }

  // 盤面を一瞬だけ揺らす（CSS アニメを remove→reflow→add で都度リスタート）。
  private shake(): void {
    const el = this.view.el
    el.classList.remove('board--shake')
    void el.offsetWidth // reflow を強制してアニメを必ず再生させる。
    el.classList.add('board--shake')
  }

  private popCombo(): void {
    const el = this.comboEl
    el.classList.remove('replay__combo--pop')
    void el.offsetWidth
    el.classList.add('replay__combo--pop')
  }

  // 再生ボタン等のユーザー操作時に AudioContext を遅延生成・再開する（自動再生規制対策）。
  private ensureAudio(): void {
    if (this.muted) return
    if (this.audio === null) {
      const w = window as Window & { webkitAudioContext?: typeof AudioContext }
      const Ctor = window.AudioContext ?? w.webkitAudioContext
      if (Ctor === undefined) return
      try {
        this.audio = new Ctor()
      } catch {
        this.audio = null
      }
    }
    if (this.audio !== null && this.audio.state === 'suspended') {
      void this.audio.resume().catch(() => undefined)
    }
  }

  // 短い減衰音を鳴らす（ベストエフォート。AudioContext が無い/失敗する環境では黙って何もしない）。
  private beep(freq: number, durMs: number): void {
    if (this.muted) return
    const ctx = this.audio
    if (ctx === null) return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      const t = ctx.currentTime
      const dur = durMs / 1000
      gain.gain.setValueAtTime(0.06, t)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + dur)
    } catch {
      // 演出はベストエフォート。失敗しても再生体験を壊さない。
    }
  }

  private updatePlayBtn(): void {
    this.playBtn.textContent = this.playing ? '⏸ 一時停止' : '▶ 再生'
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

// --- フレーム生成（events を初期盤面へ当てて各時点の盤面を再構成する） ---

/**
 * 初期盤面と events から、描画可能なフレーム列を確定する。
 *
 * 位置を変えるイベント（unit_move / unit_push / unit_destroy）を id 単位で live マップへ
 * 当てていき、各イベント後の盤面をスナップショットする。turn_start / trigger_fire /
 * battle_end は盤面を変えないが、何が起きたかを示すフレームとして残す（連鎖が目で追える）。
 *
 * swap_adjacent は「actor を相手升へ」「相手を actor 旧升へ」の2つの unit_move として現れ、
 * 1つ目だけ当てた瞬間は2体が同じ升に重なる過渡状態になる。重なりを検出したフレームは
 * 描画せず（次のイベントで解消される）、確定した盤面だけをフレーム化する。
 */
function buildFrames(initial: Board, result: BattleResult): Frame[] {
  const { width, height } = initial
  // roster: 撃破後も名前を引けるよう全ユニットを保持（MVP では戦闘中の新規生成はない）。
  const roster = new Map<string, Unit>()
  const live = new Map<string, Unit>()
  for (const u of initial.getAllUnits()) {
    roster.set(u.id, u)
    live.set(u.id, cloneUnit(u))
  }

  const frames: Frame[] = [
    { board: snapshot(width, height, live), label: '開始 — 初期配置', kind: 'init', round: 0, combo: 0 },
  ]

  let round = 0
  // combo は手番（turn_start）開始でリセットし、trigger_fire ごとに増やす連鎖カウント。
  let combo = 0
  for (const ev of result.events) {
    if (ev.kind === 'turn_start') {
      const r = ev.metadata?.['round']
      if (typeof r === 'number') round = r
      combo = 0
    }

    let frameCombo = 0
    if (ev.kind === 'trigger_fire') {
      combo++
      frameCombo = combo
    }

    // ラベルは適用前に作る（unit_destroy で消える前のユニット名を引くため）。
    const label = describe(ev, roster)
    applyEvent(live, ev)

    // 過渡的な重なり（swap の片側だけ適用した瞬間）はフレーム化しない。
    if (hasCollision(live)) continue

    frames.push({ board: snapshot(width, height, live), label, kind: ev.kind, round, combo: frameCombo })
  }

  return frames
}

function applyEvent(live: Map<string, Unit>, ev: BattleEvent): void {
  switch (ev.kind) {
    case 'unit_move':
    case 'unit_push': {
      if (ev.unitId === undefined || ev.to === undefined) return
      const u = live.get(ev.unitId)
      if (u !== undefined) u.position = { ...ev.to }
      return
    }
    case 'unit_destroy': {
      if (ev.unitId !== undefined) live.delete(ev.unitId)
      return
    }
    // 盤面を変えないイベントはフレームのラベル表示のみ。
    case 'trigger_fire':
    case 'turn_start':
    case 'battle_end':
    case 'cascade_start':
    case 'cascade_end':
      return
    default: {
      const _exhaustive: never = ev.kind
      return _exhaustive
    }
  }
}

function hasCollision(live: Map<string, Unit>): boolean {
  const seen = new Set<string>()
  for (const u of live.values()) {
    const key = `${u.position.x},${u.position.y}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

function snapshot(width: number, height: number, live: Map<string, Unit>): Board {
  const board = new Board(width, height)
  // 読み順で配置（決定論的・重複は呼び出し側で除外済み）。
  const units = [...live.values()].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  )
  for (const u of units) board.placeUnit(cloneUnit(u))
  return board
}

function cloneUnit(u: Unit): Unit {
  return { ...u, position: { ...u.position } }
}

function describe(ev: BattleEvent, roster: Map<string, Unit>): string {
  switch (ev.kind) {
    case 'turn_start':
      return `${name(ev.unitId, roster)} の手番`
    case 'unit_move':
      return `${name(ev.unitId, roster)} が移動`
    case 'unit_push':
      return `${name(ev.unitId, roster)} が押し出された`
    case 'unit_destroy': {
      const offBoard = ev.metadata?.['cause'] === 'offBoard'
      return `${name(ev.unitId, roster)} を${offBoard ? '盤外へ撃破' : '撃破'}`
    }
    case 'trigger_fire': {
      const trig = ev.triggerKind !== undefined ? TRIGGER_LABEL[ev.triggerKind] : '?'
      const eff = ev.effectKind !== undefined ? EFFECT_LABEL[ev.effectKind] : '?'
      return `${name(ev.unitId, roster)} 発火: ${trig} → ${eff}`
    }
    case 'battle_end':
      return '決着'
    case 'cascade_start':
    case 'cascade_end':
      return ev.kind
    default: {
      const _exhaustive: never = ev.kind
      return _exhaustive
    }
  }
}

function name(id: string | undefined, roster: Map<string, Unit>): string {
  if (id === undefined) return ''
  const u = roster.get(id)
  if (u === undefined) return id
  const owner = u.side === 'player' ? '自' : '敵'
  return `${UNIT_LABEL[u.type]}(${owner})`
}

function resultText(result: BattleResult): string {
  const who =
    result.winner === 'player'
      ? 'あなたの勝ち'
      : result.winner === 'enemy'
        ? '相手の勝ち'
        : '引き分け'
  return `結果: ${who}（${REASON_LABEL[result.reason]}）／ 最大連鎖 ${result.maxChainDepth} ／ ${result.totalTurns} ラウンド`
}
