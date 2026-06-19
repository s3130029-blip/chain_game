import type { Side } from '../types/unit'
import type { WinReason } from '../types/battle'
import type { Board } from './Board'

/** 勝敗判定の結果。winner は勝者サイド、または draw（引き分け）。 */
export interface VictoryOutcome {
  winner: Side | 'draw'
  reason: WinReason
}

export class VictoryChecker {
  /**
   * コアの消失をチェックする（毎連鎖ステップ後に呼ぶ）。
   * - 両コア存命 → null（戦闘継続）。
   * - 片方のコアのみ消失 → 残存側の勝ち（reason='core_destroyed'）。
   * - 両コア消失 → draw（同一カスケード内で同時に消えた扱い。reason='core_destroyed'）。
   *
   * 「先に消えた方の負け」は、本メソッドを毎ステップ呼ぶ呼び出し元（BattleEngine）が
   * 最初の消失を捕捉することで成立する。盤面状態のみを見る本メソッド単体では、
   * 観測時点で両方消えていれば draw とする。
   */
  static checkCoreDestroyed(board: Board): VictoryOutcome | null {
    const playerHasCore = VictoryChecker.hasCore(board, 'player')
    const enemyHasCore = VictoryChecker.hasCore(board, 'enemy')

    if (playerHasCore && enemyHasCore) return null
    if (!playerHasCore && !enemyHasCore) {
      return { winner: 'draw', reason: 'core_destroyed' }
    }
    return {
      winner: playerHasCore ? 'player' : 'enemy',
      reason: 'core_destroyed',
    }
  }

  /**
   * ターン上限到達時の最終判定。
   * 判定順（タイブレーク）: 生存ユニット数 → コアHP → 合計残HP → draw。
   * どの段でも数値が大きい側が勝者。全段同値なら引き分け（reason='timeout'）。
   */
  static checkEndOfGame(board: Board): VictoryOutcome {
    // 1. 生存ユニット数
    const playerCount = board.getUnitsBySide('player').length
    const enemyCount = board.getUnitsBySide('enemy').length
    if (playerCount !== enemyCount) {
      return { winner: playerCount > enemyCount ? 'player' : 'enemy', reason: 'unit_count' }
    }

    // 2. コアHP
    const playerCoreHp = VictoryChecker.coreHp(board, 'player')
    const enemyCoreHp = VictoryChecker.coreHp(board, 'enemy')
    if (playerCoreHp !== enemyCoreHp) {
      return { winner: playerCoreHp > enemyCoreHp ? 'player' : 'enemy', reason: 'core_hp' }
    }

    // 3. 合計残HP
    const playerTotalHp = VictoryChecker.totalHp(board, 'player')
    const enemyTotalHp = VictoryChecker.totalHp(board, 'enemy')
    if (playerTotalHp !== enemyTotalHp) {
      return { winner: playerTotalHp > enemyTotalHp ? 'player' : 'enemy', reason: 'total_hp' }
    }

    // 4. 完全同点 → 引き分け
    return { winner: 'draw', reason: 'timeout' }
  }

  private static hasCore(board: Board, side: Side): boolean {
    return board.getUnitsBySide(side).some(u => u.type === 'core')
  }

  // コアは各サイド1体想定。不在時は HP 0 として扱う（決定論: 数値はイテレーション順に非依存）。
  private static coreHp(board: Board, side: Side): number {
    const core = board.getUnitsBySide(side).find(u => u.type === 'core')
    return core?.hp ?? 0
  }

  private static totalHp(board: Board, side: Side): number {
    return board.getUnitsBySide(side).reduce((sum, u) => sum + u.hp, 0)
  }
}
