import { describe, it, expect } from 'vitest'
import { formatResultShare } from '../../src/ui/ResultShare'
import { BattleEngine } from '../../src/engine/BattleEngine'
import { buildTutorialBoard } from '../../src/ui/Tutorial'
import type { BattleResult, WinReason } from '../../src/types/battle'
import type { BattleEvent } from '../../src/types/event'
import type { Side, TriggerEffectKind } from '../../src/types/unit'

// 結果シェア（tasks.md T25）の純粋部分 formatResultShare を検証する（DOM の ResultShare クラスは目視確認）。
// 完了条件「結果テキストがコピーでき、SNS に貼れる長さ」と、ネタバレ抑制（盤面・座標を出さない）、
// 勝敗・最大連鎖数・決め手・絵文字グリッド・決定論を実行可能な形で固定する。

// --- ローカルヘルパー: events を手組みして BattleResult を作る（盤面非依存に整形だけを検証する） ---

let stepCounter = 0
function ev(partial: Omit<BattleEvent, 'step'>): BattleEvent {
  return { step: stepCounter++, ...partial }
}
function turnStart(round: number): BattleEvent {
  return ev({ kind: 'turn_start', metadata: { round } })
}
function fire(effectKind: TriggerEffectKind): BattleEvent {
  return ev({ kind: 'trigger_fire', triggerKind: 'on_pushed', effectKind })
}

function makeResult(opts: {
  winner: Side | 'draw'
  reason: WinReason
  maxChainDepth: number
  events: BattleEvent[]
}): BattleResult {
  return {
    winner: opts.winner,
    reason: opts.reason,
    totalTurns: 1,
    maxChainDepth: opts.maxChainDepth,
    events: opts.events,
  }
}

describe('formatResultShare (T25)', () => {
  it('勝敗ラベル: player=🏆勝利 / enemy=💀敗北 / draw=🤝引き分け', () => {
    const base = { reason: 'core_destroyed' as WinReason, maxChainDepth: 1, events: [turnStart(1), fire('push_target')] }
    expect(formatResultShare(makeResult({ winner: 'player', ...base }))).toContain('🏆 勝利')
    expect(formatResultShare(makeResult({ winner: 'enemy', ...base }))).toContain('💀 敗北')
    expect(formatResultShare(makeResult({ winner: 'draw', ...base, reason: 'timeout' }))).toContain('🤝 引き分け')
  })

  it('見出しに最大連鎖数が出る', () => {
    const text = formatResultShare(
      makeResult({ winner: 'player', reason: 'core_destroyed', maxChainDepth: 4, events: [turnStart(1), fire('explode')] }),
    )
    expect(text).toContain('🔗最大連鎖 ×4')
  })

  it('絵文字グリッド: ラウンドごとの連鎖の濃淡（最大強度は maxChainDepth に対応）', () => {
    const result = makeResult({
      winner: 'player',
      reason: 'core_destroyed',
      maxChainDepth: 4,
      events: [
        turnStart(1), // 連鎖なし → ⬜
        turnStart(2),
        fire('push_target'),
        fire('push_target'), // 2連鎖 → 🟩
        turnStart(3),
        fire('push_target'),
        fire('push_target'),
        fire('push_target'),
        fire('explode'), // 4連鎖 → 🟧（決め手 = 爆発）
      ],
    })
    const grid = formatResultShare(result).split('\n')[2]
    expect(grid).toBe('⬜🟩🟧')
  })

  it('同一ラウンド内の複数手番はラウンド最大の連鎖を採る', () => {
    const result = makeResult({
      winner: 'player',
      reason: 'core_destroyed',
      maxChainDepth: 2,
      events: [
        turnStart(1),
        fire('push_target'), // 手番A: 1連鎖
        turnStart(1),
        fire('push_target'),
        fire('push_target'), // 手番B: 2連鎖 → ラウンド最大は 2
      ],
    })
    const grid = formatResultShare(result).split('\n')[2]
    expect(grid).toBe('🟩')
  })

  it('決め手: コア撃破は決着直前に発火した効果（爆発）', () => {
    const text = formatResultShare(
      makeResult({
        winner: 'player',
        reason: 'core_destroyed',
        maxChainDepth: 2,
        events: [turnStart(1), fire('push_target'), fire('explode'), ev({ kind: 'unit_destroy', unitId: 'e_core' })],
      }),
    )
    expect(text).toContain('決め手: 爆発')
  })

  it('決め手: トリガー無しのコア撃破は「直接押し出し」', () => {
    const text = formatResultShare(
      makeResult({
        winner: 'player',
        reason: 'core_destroyed',
        maxChainDepth: 0,
        events: [turnStart(1), ev({ kind: 'unit_destroy', unitId: 'e_core' })],
      }),
    )
    expect(text).toContain('決め手: 直接押し出し')
  })

  it('決め手: タイブレーク決着は勝因ラベル（時間切れ）', () => {
    const text = formatResultShare(
      makeResult({ winner: 'draw', reason: 'timeout', maxChainDepth: 0, events: [turnStart(1)] }),
    )
    expect(text).toContain('決め手: 時間切れ')
  })

  it('ネタバレ抑制: 盤面の座標・ユニット名・コード（v1:）を含まない', () => {
    const text = formatResultShare(
      makeResult({
        winner: 'player',
        reason: 'core_destroyed',
        maxChainDepth: 2,
        events: [turnStart(1), fire('push_target'), ev({ kind: 'unit_destroy', unitId: 'e_core_EC', from: { x: 3, y: 4 } })],
      }),
    )
    expect(text).not.toContain('e_core_EC')
    expect(text).not.toMatch(/\d+,\d+/) // "x,y" 形式の座標を出さない
    expect(text).not.toContain('v1:')
  })

  it('SNS に貼れる長さ（30ラウンドの最悪ケースでも 280 文字以内）', () => {
    const events: BattleEvent[] = []
    for (let r = 1; r <= 30; r++) {
      events.push(turnStart(r))
      events.push(fire('explode'), fire('explode'), fire('explode'), fire('explode'))
    }
    const text = formatResultShare(
      makeResult({ winner: 'player', reason: 'core_destroyed', maxChainDepth: 4, events }),
    )
    expect(text.length).toBeLessThanOrEqual(280)
  })

  it('決定論: 同じ result から常に同じテキスト', () => {
    const mk = (): BattleResult =>
      makeResult({
        winner: 'player',
        reason: 'core_destroyed',
        maxChainDepth: 3,
        events: [turnStart(1), fire('push_target'), turnStart(2), fire('push_target'), fire('explode'), fire('push_self')],
      })
    expect(formatResultShare(mk())).toBe(formatResultShare(mk()))
  })

  it('統合: 実エンジンの結果（チュートリアル盤面）でも整形できる', () => {
    const result = new BattleEngine().run(buildTutorialBoard())
    const text = formatResultShare(result)
    expect(text.startsWith('連鎖要塞 / CASCADE')).toBe(true)
    expect(text).toContain('🏆 勝利')
    expect(text).toContain('🔗最大連鎖 ×')
    expect(text).toContain('決め手:')
  })
})
