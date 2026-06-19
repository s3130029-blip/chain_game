import { describe, it, expect } from 'vitest'
import { scenarios, type Scenario } from '../../src/debug/scenarios'
import { BattleEngine } from '../../src/engine/BattleEngine'
import type { BattleResult } from '../../src/types/battle'

// run() は board を破壊的に進めるため clone を渡す（scenario.board は不変に保つ）。
function run(scenario: Scenario): BattleResult {
  return new BattleEngine().run(scenario.board.clone())
}

function getScenario(name: string): Scenario {
  const s = scenarios.find(sc => sc.name === name)
  if (s === undefined) throw new Error(`scenario not found: ${name}`)
  return s
}

describe('chainScenarios (T15)', () => {
  // 汎用: 全シナリオが宣言通りの勝者・理由で決着し、宣言した最小連鎖深度を満たす。
  // （シナリオを追加すれば自動でこの検証対象に入る。）
  it.each(scenarios)(
    'T15: $name は expectedWinner / expectedReason 通りに決着する',
    scenario => {
      const result = run(scenario)
      expect(result.winner).toBe(scenario.expectedWinner)
      expect(result.reason).toBe(scenario.expectedReason)
      if (scenario.minChainDepth !== undefined) {
        expect(result.maxChainDepth).toBeGreaterThanOrEqual(scenario.minChainDepth)
      }
    },
  )

  it('T15-1「基本押し出し」: 連鎖なしで敵コアを直接盤外撃破する', () => {
    const result = run(getScenario('基本押し出し'))

    expect(result.winner).toBe('player')
    expect(result.reason).toBe('core_destroyed')
    expect(
      result.events.some(e => e.kind === 'unit_destroy' && e.unitId === 'e_core_EC'),
    ).toBe(true)
  })

  it('T15-2「2段連鎖」: reactor の on_pushed が伝播して敵コアを撃破（chainDepth>=2）', () => {
    const result = run(getScenario('2段連鎖'))

    expect(result.winner).toBe('player')
    expect(result.reason).toBe('core_destroyed')
    expect(result.maxChainDepth).toBeGreaterThanOrEqual(2)
    // reactor の伝播（on_pushed）が連鎖ログに現れること。
    expect(
      result.events.some(e => e.kind === 'trigger_fire' && e.triggerKind === 'on_pushed'),
    ).toBe(true)
    expect(
      result.events.some(e => e.kind === 'unit_destroy' && e.unitId === 'e_core_EC'),
    ).toBe(true)
  })

  it('T15-3「ボマー爆発連鎖」: bomber 撃破→explode→爆風で敵コアを撃破する', () => {
    const result = run(getScenario('ボマー爆発連鎖'))

    expect(result.winner).toBe('player')
    expect(result.reason).toBe('core_destroyed')

    // bomber が盤外撃破され、その on_destroy で explode が発火すること（T18 の検証項目）。
    expect(
      result.events.some(e => e.kind === 'unit_destroy' && e.unitId === 'e_bomber_EB'),
    ).toBe(true)
    const explodeIdx = result.events.findIndex(
      e =>
        e.kind === 'trigger_fire' &&
        e.triggerKind === 'on_destroy' &&
        e.effectKind === 'explode',
    )
    expect(explodeIdx).toBeGreaterThanOrEqual(0)

    // 敵コアは爆風（explode）の結果として撃破される＝explode の発火より後に消える。
    const coreDestroyIdx = result.events.findIndex(
      e => e.kind === 'unit_destroy' && e.unitId === 'e_core_EC',
    )
    expect(coreDestroyIdx).toBeGreaterThan(explodeIdx)
  })
})
