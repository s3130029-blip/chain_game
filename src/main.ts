import { scenarios } from './debug/scenarios'
import { printBattleLog, printBoard } from './debug/consolePrinter'
import { BattleEngine } from './engine/BattleEngine'

/**
 * フェーズ1のデバッグ実行エントリ（tasks.md T16）。
 * 各シナリオを BattleEngine で走らせ、初期盤面・連鎖ログ・PASS/FAIL を
 * コンソールへ出力する。Go/No-Go 判定（連鎖を読んで"ニヤッとするか"）の手動検証用。
 *
 * BattleEngine.run() は board を破壊的に進めるため、scenario を不変に保つよう
 * 必ず clone() を渡す（scenarios.ts のコメント参照）。
 */
for (const scenario of scenarios) {
  console.log(`\n${'='.repeat(50)}`)
  console.log(`シナリオ: ${scenario.name}`)
  console.log(scenario.description)
  console.log('初期盤面:')
  printBoard(scenario.board)

  const engine = new BattleEngine()
  const result = engine.run(scenario.board.clone())

  printBattleLog(result.events, result)

  const pass =
    result.winner === scenario.expectedWinner &&
    result.reason === scenario.expectedReason
  console.log(pass ? '✅ PASS' : '❌ FAIL')
}
