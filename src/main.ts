import { App } from './ui/App'

// フェーズ2 UI ブートストラップ（tasks.md T20）。
// index.html の #app に盤面エディタをマウントする。
// （フェーズ1 のシナリオ実行は debug/scenarios.ts + tests/scenarios/ で検証する。）
const root = document.getElementById('app')
if (root === null) {
  throw new Error('#app element not found in index.html')
}
new App(root).mount()
