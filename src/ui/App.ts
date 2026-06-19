import { Editor } from './Editor'
import { ReplayPlayer } from './ReplayPlayer'
import { ShareCode, parseBoardCodeFromQuery } from './ShareCode'
import { setupBattle } from './setupBattle'
import { Tutorial, buildTutorialBoard, hasSeenTutorial, markTutorialSeen } from './Tutorial'
import { Board } from '../engine/Board'
import { BattleEngine } from '../engine/BattleEngine'
import { DOJO_OPPONENTS } from '../dojo/opponents'
import type { DojoOpponent } from '../dojo/opponents'
import type { BattleResult } from '../types/battle'

// アプリのルート（tasks.md T20 + T21 + T22 + T23）。
// チュートリアル／エディタ ⇄ リプレイの画面遷移を担う。
//  - チュートリアル画面: 初回起動時に最小の連鎖デモを提示（T23）。あとからでも「遊び方」で開ける。
//  - エディタ画面: 盤面エディタ（T20）＋ 道場相手バー（T21/T23）＋ 共有コード/URL 連携（T22）。
//  - リプレイ画面: BattleEngine.run() の結果を ReplayPlayer（T21）で再生。
//
// 対戦相手の合成は 2 系統:
//  - 道場相手（dojo/opponents.ts）は最初から enemy 側・上段・down 向きで構築済み →
//    ミラー不要の単純合成（combineBoards）。
//  - 共有コード相手は「相手が player として作った自盤」→ setupBattle で上下ミラー＋side 反転して合成（T22）。
const PLAYER_ROWS = 3

export class App {
  private readonly root: HTMLElement
  private editor: Editor | null = null
  private replay: ReplayPlayer | null = null
  // 起動時 URL の ?b= で渡された相手コード（エディタ表示時に共有パネルへ反映する）。
  private pendingOpponentCode: string | null

  constructor(root: HTMLElement) {
    this.root = root
    this.pendingOpponentCode = parseBoardCodeFromQuery(window.location.search)
  }

  mount(): void {
    // ?b= で相手コードが渡された来訪は「対戦しに来た」ので直接エディタへ。
    // それ以外で初回（チュートリアル未読）ならコールドスタート対策の連鎖デモを先に出す（T23）。
    if (this.pendingOpponentCode === null && !hasSeenTutorial()) {
      this.showTutorial()
    } else {
      this.showEditor()
    }
  }

  // 最小チュートリアル（T23）。ゲームの本質を提示し、デモ連鎖の視聴かエディタ開始へ遷移する。
  // どちらを選んでも既読として記録し、次回からはエディタを直接開く（「遊び方」で再表示は可能）。
  private showTutorial(): void {
    this.disposeReplay()
    this.root.replaceChildren()

    const header = document.createElement('header')
    header.className = 'app__header'
    header.textContent = '連鎖要塞 / CASCADE — はじめに'

    const tutorial = new Tutorial({
      onWatch: () => {
        markTutorialSeen()
        this.runAndReplay(buildTutorialBoard(), 'チュートリアル — 2段連鎖')
      },
      onStart: () => {
        markTutorialSeen()
        this.showEditor()
      },
    })

    this.root.append(header, tutorial.el)
  }

  private showEditor(): void {
    this.disposeReplay()
    this.root.replaceChildren()

    const header = document.createElement('header')
    header.className = 'app__header'
    header.textContent = '連鎖要塞 / CASCADE — 盤面エディタ'

    this.editor = new Editor()
    const tutorialBar = this.buildTutorialBar()
    const battleBar = this.buildBattleBar()

    const share = new ShareCode({
      getMyCode: () => this.editor?.getCode() ?? '',
      onFight: oppBoard => this.startCodeBattle(oppBoard),
    })
    // 起動時 URL の相手コードがあれば入力欄へ反映（一度きり）。
    if (this.pendingOpponentCode !== null) {
      share.setOpponentCode(this.pendingOpponentCode)
      this.pendingOpponentCode = null
    }

    this.root.append(header, tutorialBar, this.editor.el, battleBar, share.el)
  }

  // 「遊び方（連鎖デモ）」をいつでも再表示できるバー（T23）。初回以外でもチュートリアルに戻れる。
  private buildTutorialBar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'code'

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'code__btn'
    btn.textContent = '❓ 遊び方（連鎖デモを観る）'
    btn.addEventListener('click', () => this.showTutorial())

    bar.append(btn)
    return bar
  }

  // 道場相手の選択と「対戦」起動を担うバー（Editor 本体には手を入れず App 側で持つ）。
  private buildBattleBar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'code'

    const title = document.createElement('div')
    title.className = 'hint'
    title.textContent = '道場 — 相手を選んで対戦し、リプレイを観る（相手がいなくても遊べる）'

    const select = document.createElement('select')
    select.className = 'code__btn'
    for (const opp of DOJO_OPPONENTS) {
      const option = document.createElement('option')
      option.value = opp.id
      option.textContent = `Lv${opp.difficulty} ${opp.name}`
      select.appendChild(option)
    }

    const hint = document.createElement('div')
    hint.className = 'hint'

    const fight = document.createElement('button')
    fight.type = 'button'
    fight.className = 'code__btn'
    fight.textContent = 'この相手と対戦'
    fight.addEventListener('click', () => {
      const opp = DOJO_OPPONENTS.find(o => o.id === select.value)
      if (opp === undefined) return
      this.startDojoBattle(opp, hint)
    })

    const desc = document.createElement('div')
    desc.className = 'hint'
    const syncDesc = (): void => {
      const opp = DOJO_OPPONENTS.find(o => o.id === select.value)
      desc.textContent = opp?.description ?? ''
    }
    select.addEventListener('change', syncDesc)
    syncDesc()

    const row = document.createElement('div')
    row.className = 'code__buttons'
    row.append(select, fight)

    bar.append(title, row, desc, hint)
    return bar
  }

  private startDojoBattle(opp: DojoOpponent, hint: HTMLElement): void {
    const editor = this.editor
    if (editor === null) return

    let initial: Board
    try {
      initial = combineBoards(editor.getBoard(), opp.buildBoard())
    } catch (err) {
      hint.textContent = `対戦を開始できません: ${err instanceof Error ? err.message : String(err)}`
      hint.classList.add('hint--warn')
      return
    }

    this.runAndReplay(initial, `Lv${opp.difficulty} ${opp.name}`)
  }

  // 共有コード由来の相手と対戦（T22）。相手盤を上下ミラー＋side 反転して合成する。
  // setupBattle の例外（盤面サイズ不一致・マス重複）は呼び出し元（ShareCode.fight）が捕捉・表示する。
  private startCodeBattle(oppBoard: Board): void {
    const editor = this.editor
    if (editor === null) return

    const initial = setupBattle(editor.getBoard(), oppBoard)
    this.runAndReplay(initial, '共有コード対戦')
  }

  // 初期盤面を決定論的に走らせてリプレイ画面へ遷移する。
  // run() は盤面を破壊的に進めるため、初期状態を保つクローンで実行する。
  private runAndReplay(initial: Board, title: string): void {
    const result = new BattleEngine().run(initial.clone())
    this.showReplay(initial, result, title)
  }

  private showReplay(initial: Board, result: BattleResult, title: string): void {
    this.disposeReplay()
    this.root.replaceChildren()

    const header = document.createElement('header')
    header.className = 'app__header'
    header.textContent = `リプレイ — ${title}`

    this.replay = new ReplayPlayer(initial, result, { playerRows: PLAYER_ROWS })

    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'code__btn'
    back.textContent = '← 編集に戻る'
    back.addEventListener('click', () => this.showEditor())

    this.root.append(header, this.replay.el, back)
  }

  private disposeReplay(): void {
    if (this.replay !== null) {
      this.replay.dispose()
      this.replay = null
    }
  }
}

/**
 * 自陣（player）盤と道場相手（enemy・上段・down 向きで構築済み）を1つの Board に合成する。
 * 道場相手はミラー不要のため両者のユニットをそのまま同一盤へ置く
 * （共有コード相手の上下ミラー＋side 反転は setupBattle の責務）。
 */
function combineBoards(playerBoard: Board, oppBoard: Board): Board {
  const merged = playerBoard.clone()
  for (const u of oppBoard.getAllUnits()) {
    merged.placeUnit({ ...u, position: { ...u.position } })
  }
  return merged
}
