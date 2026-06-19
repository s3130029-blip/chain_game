import { Board } from '../engine/Board'
import { createUnit } from '../data/unitTemplates'
import { OPPOSITE } from '../types/direction'
import type { Direction } from '../types/direction'

// 対戦セットアップ（tasks.md T22）。
// 共有コード由来の相手盤は「相手が自分の構築として player・下段・上向きで作ったもの」。
// それを対戦相手として反転し、自盤と1つの Board に合成する。
//
// codec（src/share）は Board ⇄ string の往復のみを担い、この反転・合成は battle セットアップの
// 責務（architecture.md フェーズ2 / SUP のスコープ外）。エンジン層は不変に保つため、
// 反転ロジックは engine ではなく ui 配下に純粋関数（DOM 非依存）として置く。
//
// 反転の定義 = 上下ミラー（y' = h-1-y）＋ facing の上下反転（up⇄down、left/right は不変）
//             ＋ side を enemy へ。これで相手は上段・down 向きの敵として、
//             自陣（下段・player・up 向き）と正対する。

/**
 * 自盤（player）と相手盤（player として構築された共有コード由来）を合成して対戦盤を返す。
 * 相手は上下ミラー＋ side 反転で敵陣（上段）へ移す。盤面サイズは両者一致が前提。
 *
 * @throws 盤面サイズ不一致、または合成時のマス重複（placeUnit が throw）。
 */
export function setupBattle(myBoard: Board, oppBoard: Board): Board {
  if (myBoard.width !== oppBoard.width || myBoard.height !== oppBoard.height) {
    throw new Error(
      `盤面サイズが一致しません（自分 ${myBoard.width}x${myBoard.height} / 相手 ${oppBoard.width}x${oppBoard.height}）`,
    )
  }

  const merged = myBoard.clone()
  for (const enemy of mirrorToEnemy(oppBoard)) {
    // 重複升があれば placeUnit が throw する（呼び出し元がメッセージを表示）。
    merged.placeUnit(enemy)
  }
  return merged
}

/**
 * 相手盤の全ユニットを「上下ミラー＋ side 反転」した敵ユニット配列にして返す。
 * ユニットは createUnit でテンプレ既定値から再生成する（共有するのは型と配置のみ＝HP 等はリセット）。
 * id は enemy 側で振り直すため、自盤（player 側 id）と衝突しない。
 * 読み順（y 昇順 → x 昇順）で安定生成し、id サフィックスを決定論的に振る。
 */
function mirrorToEnemy(oppBoard: Board) {
  const h = oppBoard.height
  const units = [...oppBoard.getAllUnits()].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  )
  return units.map((u, i) =>
    createUnit(
      u.type,
      'enemy',
      { x: u.position.x, y: h - 1 - u.position.y },
      mirrorFacing(u.facing),
      `opp${i}`,
    ),
  )
}

// 上下ミラーなので上下方向（up/down）だけ反転し、左右は変えない。
function mirrorFacing(dir: Direction): Direction {
  return dir === 'up' || dir === 'down' ? OPPOSITE[dir] : dir
}
