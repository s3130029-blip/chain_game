import { analyzeBalance, formatReport } from './harness'

// バランス検証レポートの実行エントリ（tasks.md T24）。
// `npm run balance`（tsx）でコンソールに代表構築＋道場の総当たり順位表を出力する。
// 出荷物ではなく開発時の解析ツール（決定論なので毎回同一出力）。
const report = analyzeBalance()
console.log(formatReport(report))
