import { Board } from '../engine/Board'
import { createUnit } from '../data/unitTemplates'

// 最小チュートリアル（tasks.md T23）。コールドスタート対策として、
// 「ユニットを置くだけ／戦闘は自動・決定論／プレイヤーが設計するのは“連鎖”」という
// ゲームの本質（CLAUDE.md §1）を、固定の 2 段連鎖デモを実際に再生して体験させる。
//
// 設計（フェーズ2 の依存規律）:
//  - 盤面構築（buildTutorialBoard）は純粋・決定論的でテスト可能にし、デモの「連鎖が起きる」
//    ことを engine を走らせて固定する（tests/ui/tutorial.test.ts）。
//  - リプレイ再生は App の既存遷移（runAndReplay → ReplayPlayer）に委ね、Tutorial 自身は
//    エンジンや ReplayPlayer を import しない。ここは「説明文の表示＋遷移コールバック」に徹する。
//  - 初回判定の localStorage は UI 層のみ・例外/未対応環境では「未読」に倒して安全に続行する
//    （エンジンはブラウザ API を一切触らない＝CLAUDE.md §10）。

// 道場・エディタと同じ盤面サイズ（自陣は下 PLAYER_ROWS 行）。
const BOARD_W = 7
const BOARD_H = 7

// 初回起動時に一度だけ自動表示するためのフラグ保存キー（UI 層のみ）。
const SEEN_KEY = 'cascade.tutorial.seen.v1'

/**
 * チュートリアル用の固定デモ盤面（両陣営配置済み）を生成する。
 * debug/scenarios の「2 段連鎖」を縦向き（自陣=下段・up 向き）へ置き直したもの:
 *  pusher が reactor を押す → reactor の on_pushed が伝播して敵コアを盤外へ撃破する。
 * 呼ぶたびに新しい Board を返す（BattleEngine.run は破壊的に進めるため）。
 */
export function buildTutorialBoard(): Board {
  const board = new Board(BOARD_W, BOARD_H)
  // 自陣（下段・up 向き）。
  board.placeUnit(createUnit('core', 'player', { x: 3, y: 6 }, 'up', 'PC'))
  board.placeUnit(createUnit('pusher', 'player', { x: 3, y: 5 }, 'up', 'PP'))
  // 敵陣（上段・down 向き）。reactor を挟んで奥にコアを置き、押しの伝播でコアを盤外へ出す。
  board.placeUnit(createUnit('reactor', 'enemy', { x: 3, y: 3 }, 'down', 'ER'))
  board.placeUnit(createUnit('core', 'enemy', { x: 3, y: 0 }, 'down', 'EC'))
  return board
}

/** 初回起動かどうか（localStorage 未対応・例外時は「未読」扱い＝チュートリアルを出す）。 */
export function hasSeenTutorial(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** チュートリアルを見たことを記録する（保存できなくても表示自体は済むのでベストエフォート）。 */
export function markTutorialSeen(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // privacy モード等で localStorage が使えなくても続行する。
  }
}

export interface TutorialOptions {
  // 「連鎖を観る」: デモの 2 段連鎖をリプレイ画面で再生する。
  onWatch: () => void
  // 「盤面エディタへ」: チュートリアルを終えて構築を始める。
  onStart: () => void
}

/**
 * チュートリアル導入画面（DOM）。ゲームの本質を 3 点で示し、デモ連鎖の視聴か
 * エディタ開始へ遷移させる。スタイルは既存クラス（.code/.hint/.code__btn）を流用する。
 */
export class Tutorial {
  readonly el: HTMLDivElement

  constructor(options: TutorialOptions) {
    const el = document.createElement('div')
    el.className = 'code'

    const lead = makeHint('ユニットを置くだけ。戦闘は自動で進む。あなたが設計するのは “連鎖”。')
    lead.style.fontWeight = '700'
    lead.style.opacity = '1'

    const points = document.createElement('ol')
    points.className = 'hint'
    points.style.opacity = '1'
    points.style.margin = '0'
    points.style.paddingLeft = '1.2em'
    points.style.lineHeight = '1.6'
    for (const text of [
      '盤面に 6 種のユニットを配置して構築する。',
      '対戦は決定論的に自動進行。操作はせず “観戦” する。',
      '押し → 反応 → 爆発…の連鎖を設計し、相手のコアを盤外へ。',
    ]) {
      const li = document.createElement('li')
      li.textContent = text
      points.appendChild(li)
    }

    const demoNote = makeHint(
      'まずは観てみよう: プッシャーが押す → リアクターが反応して伝播 → 敵コアが盤外へ。',
    )

    const watchBtn = makeButton('▶ 連鎖を観る', options.onWatch)
    const startBtn = makeButton('盤面エディタへ →', options.onStart)
    const buttons = document.createElement('div')
    buttons.className = 'code__buttons'
    buttons.append(watchBtn, startBtn)

    el.append(lead, points, demoNote, buttons)
    this.el = el
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

function makeHint(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'hint'
  el.textContent = text
  return el
}
