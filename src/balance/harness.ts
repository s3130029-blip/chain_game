import { Board } from '../engine/Board'
import { BattleEngine } from '../engine/BattleEngine'
import { createUnit } from '../data/unitTemplates'
import { setupBattle } from '../ui/setupBattle'
import { DOJO_OPPONENTS } from '../dojo/opponents'
import type { Side } from '../types/unit'
import type { WinReason } from '../types/battle'
import {
  type Build,
  type BuildUnit,
  BALANCE_BOARD_W,
  BALANCE_BOARD_H,
  REPRESENTATIVE_BUILDS,
} from './builds'

/**
 * 決定論バランス検証ハーネス（tasks.md T24 / 要件定義書 §215-218）。
 *
 * 戦闘は完全決定論（CLAUDE.md §5）なので、代表構築どうしを総当たりさせれば
 * 「全数テストに近い」検証で支配的コンボ（壊れ）を機械的に検出できる。
 *
 * このモジュールは解析ツール（src/debug 同様、出荷ランタイムの依存グラフ外）であり、
 * 反転・合成は ui/setupBattle の純粋関数を再利用する（DOM 非依存。architecture.md 参照）。
 * 乱数・時刻・反復順依存は持たない。
 */

/** 1 試合の結果（me=player 視点）。 */
export interface MatchOutcome {
  /** player 役の構築 id。 */
  meId: string
  /** enemy 役（相手）の構築 id。 */
  oppId: string
  winner: Side | 'draw'
  reason: WinReason
  totalTurns: number
  maxChainDepth: number
}

/** 構築 1 件の総当たり集計。 */
export interface BuildStanding {
  id: string
  name: string
  cost: number
  unitCount: number
  /** pusher を 1 体も含まない＝自走しない防御寄り構築か。 */
  immobile: boolean
  wins: number
  losses: number
  draws: number
  games: number
  /** wins / games（0..1）。 */
  winRate: number
  /** draws / games（0..1）。 */
  drawRate: number
  /** 勝った試合の平均最大連鎖深度（連鎖で勝てているかの指標）。 */
  avgChainOnWin: number
}

/** 構築の合計コスト上限（Editor の COST_BUDGET と一致させる。§218 の枠上限）。 */
export const COST_BUDGET = 12

export interface BalanceReport {
  standings: BuildStanding[]
  totalGames: number
  drawRate: number
  /** winRate 降順の先頭（最も支配的な構築）。 */
  topWinRate: number
  /** winRate の最大−最小（偏りの広さ）。 */
  winRateSpread: number
  /** コスト上限超過で「投入不可」と判定され、総当たりから除外した構築。 */
  excludedIllegal: Array<{ id: string; name: string; cost: number }>
}

/** construction frame の Build を player 側の Board に展開する（決定論 id）。 */
export function buildToBoard(build: Build, w = BALANCE_BOARD_W, h = BALANCE_BOARD_H): Board {
  const board = new Board(w, h)
  build.units.forEach((u: BuildUnit, i: number) => {
    board.placeUnit(createUnit(u.type, 'player', { x: u.x, y: u.y }, u.facing ?? 'up', `${u.type}${i}`))
  })
  return board
}

/** 構築の合計コスト（テンプレ既定コストの総和）。 */
export function buildCost(build: Build): number {
  return buildToBoard(build)
    .getAllUnits()
    .reduce((sum, u) => sum + u.cost, 0)
}

/**
 * dojo 相手（enemy・上段・down 向き）を construction frame（player・下段・up 向き）へ変換する。
 * setupBattle と同じ上下ミラー（y' = h-1-y、down⇄up）で対称に揃える。
 */
export function dojoToBuild(): Build[] {
  const h = BALANCE_BOARD_H
  return DOJO_OPPONENTS.map(opp => {
    const units = opp
      .buildBoard()
      .getAllUnits()
      .map<BuildUnit>(u => ({
        type: u.type,
        x: u.position.x,
        y: h - 1 - u.position.y,
        facing: u.facing === 'up' || u.facing === 'down'
          ? (u.facing === 'up' ? 'down' : 'up')
          : u.facing,
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x)
    return { id: opp.id, name: opp.name, units }
  })
}

/** 代表構築 ＋ dojo 5 体を construction frame に揃えた全参加構築（投入可否は問わない）。 */
export function allParticipants(): Build[] {
  return [...REPRESENTATIVE_BUILDS, ...dojoToBuild()]
}

/** 合計コストが上限以内＝実際に編成・投入できる構築か。 */
export function isLegal(build: Build): boolean {
  return buildCost(build) <= COST_BUDGET
}

/** コスト上限以内で実際に投入できる構築のみ（総当たりの対象＝実プレイのメタ）。 */
export function legalParticipants(): Build[] {
  return allParticipants().filter(isLegal)
}

/** me（player 役）vs opp（enemy 役）を 1 試合実行する。 */
export function runMatchup(me: Build, opp: Build): MatchOutcome {
  const merged = setupBattle(buildToBoard(me), buildToBoard(opp))
  const result = new BattleEngine().run(merged)
  return {
    meId: me.id,
    oppId: opp.id,
    winner: result.winner,
    reason: result.reason,
    totalTurns: result.totalTurns,
    maxChainDepth: result.maxChainDepth,
  }
}

/**
 * 全構築の総当たり（順序付き相異ペア）を実行する。
 * (i,j) と (j,i) を両方走らせることで、攻守入替の 2 戦（要件定義書 §173）を網羅する。
 */
export function roundRobin(builds: Build[]): MatchOutcome[] {
  const outcomes: MatchOutcome[] = []
  for (const me of builds) {
    for (const opp of builds) {
      if (me.id === opp.id) continue
      outcomes.push(runMatchup(me, opp))
    }
  }
  return outcomes
}

/** 総当たり結果を構築ごとに集計し、winRate 降順（同率は id 昇順）の順位表にする。 */
export function computeReport(builds: Build[], outcomes: MatchOutcome[]): BalanceReport {
  const byId = new Map<string, BuildStanding>()
  for (const b of builds) {
    const board = buildToBoard(b)
    const units = board.getAllUnits()
    byId.set(b.id, {
      id: b.id,
      name: b.name,
      cost: units.reduce((s, u) => s + u.cost, 0),
      unitCount: units.length,
      immobile: !units.some(u => u.type === 'pusher'),
      wins: 0,
      losses: 0,
      draws: 0,
      games: 0,
      winRate: 0,
      drawRate: 0,
      avgChainOnWin: 0,
    })
  }

  const chainOnWinTotal = new Map<string, number>()
  let draws = 0
  for (const o of outcomes) {
    const me = byId.get(o.meId)
    if (me === undefined) continue
    me.games++
    if (o.winner === 'player') {
      me.wins++
      chainOnWinTotal.set(o.meId, (chainOnWinTotal.get(o.meId) ?? 0) + o.maxChainDepth)
    } else if (o.winner === 'enemy') {
      me.losses++
    } else {
      me.draws++
      draws++
    }
  }

  for (const s of byId.values()) {
    s.winRate = s.games === 0 ? 0 : s.wins / s.games
    s.drawRate = s.games === 0 ? 0 : s.draws / s.games
    s.avgChainOnWin = s.wins === 0 ? 0 : (chainOnWinTotal.get(s.id) ?? 0) / s.wins
  }

  const standings = [...byId.values()].sort(
    (a, b) => b.winRate - a.winRate || a.id.localeCompare(b.id),
  )
  const winRates = standings.map(s => s.winRate)
  return {
    standings,
    totalGames: outcomes.length,
    drawRate: outcomes.length === 0 ? 0 : draws / outcomes.length,
    topWinRate: winRates.length === 0 ? 0 : Math.max(...winRates),
    winRateSpread:
      winRates.length === 0 ? 0 : Math.max(...winRates) - Math.min(...winRates),
    excludedIllegal: [],
  }
}

/**
 * 投入可能な構築（コスト上限以内）だけで総当たりを実行してレポートを返す高水準 API。
 * 上限超過の構築は「実プレイで編成できない」ため対象から外し、除外一覧として記録する。
 */
export function analyzeBalance(): BalanceReport {
  const all = allParticipants()
  const legal = all.filter(isLegal)
  const report = computeReport(legal, roundRobin(legal))
  report.excludedIllegal = all
    .filter(b => !isLegal(b))
    .map(b => ({ id: b.id, name: b.name, cost: buildCost(b) }))
    .sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id))
  return report
}

/** レポートを人間が読める順位表テキストへ整形する（run.ts / 目視確認用）。 */
export function formatReport(report: BalanceReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(4)
  const lines: string[] = []
  lines.push(
    `総当たり ${report.totalGames} 戦 / 全体引き分け率 ${pct(report.drawRate)} / ` +
      `最高勝率 ${pct(report.topWinRate)} / 勝率レンジ ${pct(report.winRateSpread)}`,
  )
  lines.push('')
  lines.push('  # 構築                cost 体数 不動  W  L  D   勝率  分率  連鎖')
  report.standings.forEach((s, i) => {
    const rank = String(i + 1).padStart(3)
    const name = s.name.padEnd(10)
    const id = s.id.padEnd(16)
    lines.push(
      `${rank} ${id}${name} ${String(s.cost).padStart(3)} ` +
        `${String(s.unitCount).padStart(3)} ${s.immobile ? '不動' : '  動'} ` +
        `${String(s.wins).padStart(2)} ${String(s.losses).padStart(2)} ${String(s.draws).padStart(2)} ` +
        `${pct(s.winRate)} ${pct(s.drawRate)} ${s.avgChainOnWin.toFixed(1)}`,
    )
  })
  if (report.excludedIllegal.length > 0) {
    lines.push('')
    lines.push(`コスト上限 ${COST_BUDGET} 超過で除外（投入不可）:`)
    for (const e of report.excludedIllegal) {
      lines.push(`  - ${e.id}（${e.name}）cost ${e.cost}`)
    }
  }
  return lines.join('\n')
}
