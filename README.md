# 連鎖要塞 / CASCADE

**移動による連鎖コンボを設計し、その結果を観戦する**非同期対戦ゲーム。

プレイヤーはユニットを配置するだけ。戦闘は**自動・決定論的**に進む。勝負は操作技術ではなく
**構築力と連鎖設計**で決まる。盤面を**共有コード（文字列）**にして相手に渡し、ぶつけ合う
——**サーバー不要・ログイン不要・インストール不要**。

## ▶ 遊ぶ（公開URL）

**https://s3130029-blip.github.io/chain_game/**

ブラウザで開くだけで遊べます（スマホ対応）。相手の共有コードや `?b=` 付きURLを開くと、
その相手とすぐ対戦できます。

## 遊び方

1. **構築する** — 自陣（盤面の下半分）をタップして 6 種のユニットを配置する。配置にはコストがかかり、
   上限（12）内でやりくりする。**コアは必須**（守る対象。撃破されると負け）。
2. **対戦する** — 次のどちらかで戦闘を実行する。
   - **道場**：プリセットの相手（Lv1〜5）を選んで対戦。相手がいなくても遊べる。
   - **共有コード**：相手の共有コードを貼り付けて対戦。
3. **観る** — 戦闘は自動で進む。リプレイで連鎖（プッシャーが押す → リアクターが伝播 →
   ボマーで爆発 → コア撃破…）を再生して観戦する。
4. **共有する** — 「共有コードを生成」で自分の構築をコード化。相手に渡す（または `?b=<コード>` のURLにして送る）と、
   相手はブラウザで開くだけで非同期対戦できる。負けたら相手の盤面を編集して**カウンター構築**で再挑戦。

### ユニット 6 種

| ユニット | コスト | 動き | 連鎖での役割 |
|---|---|---|---|
| プッシャー (P) | 3 | 前進1 | 連鎖の起点。前方を押す |
| リアクター (R) | 2 | 不動 | 押されると押し返す＝連鎖の伝播 |
| ボマー (B) | 3 | 不動 | 撃破されると周囲1マスを吹き飛ばす＝拡散 |
| マグネット (M) | 2 | 不動 | 隣に敵が来ると最寄り敵を引き寄せる |
| スワッパー (S) | 2 | 不動 | 隣の敵と位置を入れ替える＝陣形崩し |
| コア (◎) | 0 | 不動 | 守る対象。盤外へ押し出されると敗北 |

## 作例コード

下のコードを公開ページの相手コード欄に貼り付ける（または `?b=` のURLを開く）と、その構築と対戦できます。

| 構築 | コスト | 共有コード | `?b=` URL |
|---|---|---|---|
| 入門・直進プッシャー | 3 | `v1:N4Ig7iBcDsA0IAspxAVygbQwBlrgzLACx4C6sGArHrIQGxmkC+QA` | [開く](https://s3130029-blip.github.io/chain_game/?b=v1%3AN4Ig7iBcDsA0IAspxAVygbQwBlrgzLACx4C6sGArHrIQGxmkC%2BQA) |
| 伝播コンボ（リアクター） | 7 | `v1:N4Ig7iBcDsA0IAspxAVygbQwBlrgzLACx4C6sGAjHrAEywCsZF1uJT25GHshAbGVIBfIA` | [開く](https://s3130029-blip.github.io/chain_game/?b=v1%3AN4Ig7iBcDsA0IAspxAVygbQwBlrgzLACx4C6sGAjHrAEywCsZF1uJT25GHshAbGVIBfIA) |
| 爆発トラップ（ボマー） | 9 | `v1:N4Ig7iBcDsA0IAspxAVygbQwBlrgzLACx4C6sGATHrNQKxkXW4kPbkZuyEBsZpAXyA` | [開く](https://s3130029-blip.github.io/chain_game/?b=v1%3AN4Ig7iBcDsA0IAspxAVygbQwBlrgzLACx4C6sGATHrNQKxkXW4kPbkZuyEBsZpAXyA) |

## 開発

```bash
npm install      # 依存をインストール
npm run dev      # ローカル開発サーバ（http://localhost:5173）
npm test         # Vitest（全テスト）
npm run typecheck# 型チェック（tsc --noEmit）
npm run build    # 本番ビルド → dist/
npm run balance  # バランス検証レポート（解析ツール）
```

技術スタックと設計の詳細は [docs/architecture.md](docs/architecture.md)、運用ルールは
[CLAUDE.md](CLAUDE.md) を参照。

## デプロイ（GitHub Pages）

`main` への push で [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) が
`vite build` を実行し、`dist/` を GitHub Pages へ公開する。

**初回のみ手動設定が必要**：GitHub のリポジトリ →
**Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** に変更する。
以降は `main` への push で自動公開される。
