import { describe, it, expect } from 'vitest'
import {
  analyzeBalance,
  buildCost,
  isLegal,
  legalParticipants,
  dojoToBuild,
  COST_BUDGET,
} from '../../src/balance/harness'
import { createUnit } from '../../src/data/unitTemplates'

/**
 * T24 バランス回帰ガード。
 *
 * 戦闘は完全決定論なので、代表構築＋道場の総当たりは毎回同一結果になる。
 * ここでは「偏りが許容範囲に収まっている」ことを実行可能な不変条件として固定し、
 * 将来 cost / engine を変更して壊れコンボが再発したら検出できるようにする。
 *
 * しきい値は調整後の実測値（relay=92%, 最安支配なし, 引分7%）に余裕を持たせて設定する。
 * テストを甘くして緑にしているのではなく、是正後に保つべき上限を符号化したもの。
 */
describe('T24: balance regression guard', () => {
  const report = analyzeBalance()
  const legal = legalParticipants()

  // 「安価かつ支配的＝壊れ」の定義。cost <= 4 でこの勝率を超える構築は壊れとみなす。
  const BARGAIN_COST = 4
  const DOMINANT_WR = 0.85

  it('T24-01: 決定論 — 総当たりは同入力で完全一致（SUP-07 のビルド版）', () => {
    expect(analyzeBalance()).toEqual(report)
  })

  it('T24-02: 総当たりが期待数の対戦を回している（順序付き相異ペア）', () => {
    const n = legal.length
    expect(n).toBeGreaterThanOrEqual(10)
    expect(report.totalGames).toBe(n * (n - 1))
    expect(report.standings).toHaveLength(n)
  })

  it('T24-03: 安価かつ支配的なコンボ（壊れ）が存在しない', () => {
    const broken = report.standings.filter(
      s => s.cost <= BARGAIN_COST && s.winRate >= DOMINANT_WR,
    )
    expect(broken.map(s => s.id)).toEqual([])
  })

  it('T24-04: 単一構築が全体を制圧していない（最高勝率に上限）', () => {
    expect(report.topWinRate).toBeLessThanOrEqual(0.95)
  })

  it('T24-05: 千日手（引き分け量産）になっていない', () => {
    // §174「守り切れば勝ち」だけにすると引き分けが量産される懸念への回帰ガード。
    expect(report.drawRate).toBeLessThanOrEqual(0.25)
  })

  it('T24-06: コスト上限が効き、過剰スタック構築は投入不可に除外される（§218）', () => {
    // reactor 安価スパムと pusher×reactor の積み増しは上限超過で編成できないこと。
    const excludedIds = report.excludedIllegal.map(e => e.id)
    expect(excludedIds).toContain('reactor_swarm')
    expect(excludedIds).toContain('combo_aggro')
    for (const e of report.excludedIllegal) {
      expect(e.cost).toBeGreaterThan(COST_BUDGET)
    }
  })

  it('T24-07: 道場相手は全員コスト上限内で編成可能（実プレイで投入できる）', () => {
    for (const dojo of dojoToBuild()) {
      expect(isLegal(dojo), `${dojo.id} はコスト超過`).toBe(true)
      expect(buildCost(dojo)).toBeLessThanOrEqual(COST_BUDGET)
    }
  })

  it('T24-08: 是正の核 — pusher/reactor がコスト化され、relay コンボが安価支配でない', () => {
    // 直接的な是正内容のガード。これより安くすると壊れコンボ（T24-03）が再発する。
    const pusher = createUnit('pusher', 'player', { x: 0, y: 0 })
    const reactor = createUnit('reactor', 'player', { x: 0, y: 0 })
    expect(pusher.cost).toBeGreaterThanOrEqual(3)
    expect(reactor.cost).toBeGreaterThanOrEqual(2)
    // relay（pusher+reactor）の合計コストは BARGAIN 帯を超える＝強コンボには相応の投資が要る。
    expect(pusher.cost + reactor.cost).toBeGreaterThan(BARGAIN_COST)
  })
})
