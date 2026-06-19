import { describe, it, expect } from 'vitest'
import { buildTutorialBoard } from '../../src/ui/Tutorial'
import { BattleEngine } from '../../src/engine/BattleEngine'

// チュートリアル（tasks.md T23）の純粋部分のみを検証する（DOM の Tutorial クラスは目視確認）。
// 完了条件「初回に最小の連鎖体験を提示できる」を実行可能な形で固定する:
// デモ盤面を engine に通すと、必ず連鎖で敵コアを盤外撃破して player が勝つ。

describe('Tutorial demo board (T23)', () => {
  it('buildTutorialBoard: 両陣営のコアを含む 7x7 盤面を返す', () => {
    const board = buildTutorialBoard()
    expect(board.width).toBe(7)
    expect(board.height).toBe(7)
    expect(board.getUnitsBySide('player').some(u => u.type === 'core')).toBe(true)
    expect(board.getUnitsBySide('enemy').some(u => u.type === 'core')).toBe(true)
  })

  it('デモを走らせると pusher→reactor の連鎖で敵コアを盤外撃破し player が勝つ', () => {
    const result = new BattleEngine().run(buildTutorialBoard())

    expect(result.winner).toBe('player')
    expect(result.reason).toBe('core_destroyed')
    // 「最初の連鎖体験」: 押し → 反応で最低 2 発火の連鎖が起きる。
    expect(result.maxChainDepth).toBeGreaterThanOrEqual(2)
    // reactor の伝播（on_pushed）が連鎖ログに現れること。
    expect(
      result.events.some(e => e.kind === 'trigger_fire' && e.triggerKind === 'on_pushed'),
    ).toBe(true)
    expect(
      result.events.some(e => e.kind === 'unit_destroy' && e.unitId === 'e_core_EC'),
    ).toBe(true)
  })

  it('決定論: 同じデモ盤面から常に同じ結果（winner/reason/連鎖深度）になる', () => {
    const a = new BattleEngine().run(buildTutorialBoard())
    const b = new BattleEngine().run(buildTutorialBoard())
    expect(a.winner).toBe(b.winner)
    expect(a.reason).toBe(b.reason)
    expect(a.maxChainDepth).toBe(b.maxChainDepth)
  })
})
