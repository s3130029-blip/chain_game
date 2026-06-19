# test-spec.md — 連鎖要塞 / CASCADE 戦闘エンジン テスト仕様

> 対象：`architecture.md` / `tasks.md` の第1フェーズ（UIなし戦闘エンジン）。
> 形式：全ケース **Given / When / Then**。各ケースは Claude Code が **Vitest テストへ直接変換できる粒度**（具体座標・具体イベントまで明記）。
> 優先度：**① PushResolver（最優先）→ ② TriggerProcessor（次点）→ ③ 支えとなる必須群 → ④ 将来用の任意群**。
>
> タスク対応：
> - **PushResolver** ＝ `src/engine/PushResolver.ts`（tasks.md **T09**）
> - **TriggerProcessor** ＝ `src/engine/TriggerProcessor.ts`（tasks.md **T10**）

---

## 0. 共通規約（テスト変換時の前提）

**座標系**：原点 `(0,0)` は左上。`x` は右、`y` は下に増加。`inBounds` は `0 <= x,y < size`。
**方向**：`up=(0,-1)`, `down=(0,+1)`, `left=(-1,0)`, `right=(+1,0)`。
**既定盤面**：特記なければ **5×5**（添字 0..4、端は 0 と 4）。一部 6×6（端は 5）。
**ユニット表記**（Given 用）：`team.type@(x,y) [id] hp=N facing=D`。`id` 省略時は `team.type` を一意IDとみなす。

### 押し出しルールの確定（本書で曖昧さを排除）
architecture §7-3 を次に確定する。**「盤外に出たユニットは撃破」「連鎖は必ず収束（恒久的な詰まりは存在しない）」** とする。

1ステップの押し（ユニット U を方向 D へ）：
1. `dest = step(U.pos, D)`
2. `dest` が盤外 → **U を撃破**（`unit_destroy{metadata.cause:'offBoard'}`）。U のいた升は空く。
3. `dest` が空 → U を `dest` へ移動（`unit_push` イベント）。
4. `dest` が他ユニット V で埋まっている → **先に V を D へ1ステップ押す（再帰）**。V は必ず「移動」か「盤外撃破」で升を空けるので、その後 U が `dest` へ移動。

`PushResolver.push()` は **常に1マス**の押しを解決する。多マス移動は呼び出し元（BattleEngine）が push() を反復する（PR-03/05/14）。U が撃破された時点で以降の反復は中止。
**解決順序**：再帰により **先頭（前方）から解決** → イベントは前方ユニットの分が先、後方が後。

### 反応（trigger）の確定
- **reactor.onPushed**：reactor R が押されて**生存**している時、押し後の `R.pos` の進行方向先 `step(R.pos, dir)` にユニットがいれば、その相手を `dir` へ距離1で押す `push` Effect を1つ生成。先が空なら何もしない。
- **bomber.onDeath**：bomber が死亡した時、`death` イベントが持つ **`lastPos`（撃破直前の盤上座標）** を中心に、直交4近傍にいるユニットを **外向きに距離1** 押す `explode` を生成（MVP は4近傍。8近傍は将来）。
- **死亡で消えたユニットの反応**：押された結果 **撃破された場合、`onPushed` は発火しない**（行動主体が消滅したため）。一方 `onDeath` は発火する。

### アサート対象のイベント形（現行 BattleEvent 準拠 / 安定フィールドのみ検証）
`PushResolver.push()` は `PushResult` を返す。`PushResult`（`events`/`moved`/`destroyed`）と最終盤面を検証する。

```ts
interface PushResult {
  moved: Array<{ unitId: string; from: Position; to: Position }>
  destroyed: string[]          // 盤外撃破されたユニットの id
  events: BattleEvent[]
}
```

**PushResolver イベント（T09 / 現行確定）**
- `unit_push`   ：`{ kind:'unit_push', unitId, from, to, dir }`
- `unit_destroy`：`{ kind:'unit_destroy', unitId, from, dir, metadata:{ cause:'offBoard' } }`
  - `from` が撃破直前の盤上座標（旧 `lastPos`）。

**TriggerProcessor イベント（T10 / 現行 BattleEvent 確定）**
- `trigger_fire`：`{ kind:'trigger_fire', unitId, triggerKind, effectKind }`（旧 `triggerFired`。トリガー発火の記録）
- 効果は専用イベントを持たず、`PushResolver` 由来の `unit_push` / `unit_destroy`（pull/swap は `unit_move`）として現れる。
  - 旧 `explode` は爆心近傍への複数の `unit_push`（盤外なら `unit_destroy`）へ展開される。
  - 旧 `damage` は MVP に存在しない（HP 減算効果は未実装。連鎖中の撃破は盤外押し出しで生じる）。

- 上記に列挙していないフィールド（攻撃元の attribution 等）は **アサートしない**（テストの堅牢性のため）。`step` の値もアサートしない（呼び出し元が採番する装飾値）。

### 推奨テストヘルパー（各 *.test.ts にローカル定義 ／ 既存 Board.test.ts と同方針）
```ts
makeBoard(size, specs): Board   // specs: {id, type?, side?, x, y}[]（type 省略時 'pusher', side 省略時 'player'）
posOf(board, id): Position | undefined
isAlive(board, id): boolean     // board.getUnit(id) !== undefined
kindsOf(events): string[]       // ['unit_push','unit_destroy',...] 順序検証用
```
※ 当初想定した `tests/helpers.ts`（`makeState`/`BattleState`）は不採用。現行コードは
`Board` クラス＋各テストのローカルヘルパー方式で統一済み（Board.test.ts / InitiativeQueue.test.ts 参照）。

### 分類タグ
- **[必須]**：MVP（戦闘エンジン）完成判定に不可欠。これらが全緑＝エンジン期 Go の条件。
- **[任意]**：将来実装・強化・ストレス向け。MVP 判定には不要。
- **[EDGE]**：エッジケース。

---

## 1. PushResolver（最優先 / T09）

When はすべて `resolver.push(board, <unitId>, <dir>, step)`（`resolver = new PushResolver()`）。
戻り値の `PushResult`（`events` / `moved` / `destroyed`）と最終盤面を検証する。
**push() は常に1マスの押し**。多マス移動・距離指定は呼び出し元（BattleEngine）の責務でありここでは扱わない。

### PR-01 [必須] 空き升への単純な押し
- **Given**：5×5、`X@(2,2)` のみ。
- **When**：`push(board, X, right, step)`。
- **Then**：`posOf(X)===(3,2)`。`events===[unit_push{unitId:X, to:(3,2), dir:right}]`。`isAlive(X)===true`。`moved===[{X,(2,2)→(3,2)}]`、`destroyed===[]`。

### PR-02 [必須] 4方向の座標符号の正しさ（パラメタライズ）
- **Given**：5×5、`X@(2,2)`（毎回 fresh board）。
- **When**：各方向で `push(board, X, dir, step)`。
- **Then**：`up→(2,1)`, `down→(2,3)`, `left→(1,2)`, `right→(3,2)`。

### PR-03 [必須] 連続呼び出しで2マス移動 ※旧「距離2」を再構成
- **Given**：5×5、`X@(1,2)`。
- **When**：`push(board, X, right, step)` を2回。
- **Then**：1回目で `posOf(X)===(2,2)`、2回目で `posOf(X)===(3,2)`。各回 `events` に `unit_push` が1件。生存。

### PR-04 [必須][EDGE] 盤外へ押されて撃破
- **Given**：5×5、`X@(4,2)`（右端）。
- **When**：`push(board, X, right, step)`。
- **Then**：`isAlive(X)===false`。`events` に `unit_destroy{unitId:X, from:(4,2), metadata.cause:'offBoard'}`。`getUnitAt(4,2)` は undefined。`destroyed===[X]`。

### PR-05 [必須][EDGE] 端到達 → 次の push で盤外撃破 ※旧「距離2」を再構成
- **Given**：5×5、`X@(3,2)`。
- **When**：`push(board, X, right, step)` を2回。
- **Then**：1回目 `posOf(X)===(4,2)`（`unit_push`）。2回目 `isAlive(X)===false`（`unit_destroy{from:(4,2), cause:'offBoard'}`）。

### PR-06 [必須] 連鎖押し（前方に空きあり）
- **Given**：5×5、`X@(1,2)`, `Y@(2,2)`、`(3,2)` 空。
- **When**：`push(board, X, right, step)`。
- **Then**：`posOf(Y)===(3,2)`, `posOf(X)===(2,2)`、両者生存。`events` は **Y の unit_push が先**、X の unit_push が後（前方先行）。`moved===[Y, X]` の順。

### PR-07 [必須][EDGE] 連鎖押しの先頭が盤外撃破
- **Given**：5×5、`X@(3,2)`, `Y@(4,2)`（Y 右端）。
- **When**：`push(board, X, right, step)`。
- **Then**：`isAlive(Y)===false`（offBoard）、`posOf(X)===(4,2)`、X 生存。`events` 順 `unit_destroy{Y}` → `unit_push{X, to:(4,2)}`。`destroyed===[Y]`。

### PR-08 [必須][EDGE] 3体連鎖、先頭が盤外撃破
- **Given**：6×6、`X@(3,2)`, `Y@(4,2)`, `Z@(5,2)`（Z 右端）。
- **When**：`push(board, X, right, step)`。
- **Then**：`Z` 撃破、`posOf(Y)===(5,2)`, `posOf(X)===(4,2)`。`events` 順 `unit_destroy{Z}` → `unit_push{Y}` → `unit_push{X}`。

### PR-09 [必須][EDGE] 盤上に存在しないユニットへの push は no-op ※旧「距離0」を再構成
- **Given**：5×5、id `ghost` は盤上に存在しない（未配置 or 撃破済み）。
- **When**：`push(board, ghost, right, step)`。
- **Then**：`events===[]`、`moved===[]`、`destroyed===[]`。盤面不変。例外を投げない。
  （理由：1マスAPIに「距離0」概念は無い。代わりに「消滅済みユニットへの押しは安全に無視」という実装不変条件を固定する。）

### PR-10 [必須][EDGE] 敵コアを盤外へ押す（勝利の起点）
- **Given**：5×5、`enemy.core@(4,2)`（type=core）。
- **When**：`push(board, core, right, step)`。
- **Then**：`isAlive(core)===false`（offBoard）。盤上に enemy のコアが存在しない。`destroyed===[core]`。

### PR-11 [必須] 列外のユニットに影響しない
- **Given**：5×5、`X@(1,2)`, `Y@(2,2)`, `W@(2,0)`。
- **When**：`push(board, X, right, step)`。
- **Then**：`posOf(X)===(2,2)`, `posOf(Y)===(3,2)`, `posOf(W)===(2,0)`（不変）。

### PR-12 [任意][EDGE] 満員列の押し出し（全シフト＋先頭撃破）
- **Given**：6×6、`(1,2)(2,2)(3,2)(4,2)(5,2)` に5体（右端 x=5）。
- **When**：先頭 `(1,2)` のユニットを `push(board, ..., right, step)`。
- **Then**：`(5,2)` のユニット撃破、残り4体が `(2,2)(3,2)(4,2)(5,2)` へシフト。生存4・死亡1。`events` 順は先頭撃破が最初。

### PR-13 [任意][EDGE] 縦方向の端（上）でのチェーン撃破
- **Given**：5×5、`X@(2,1)`, `Y@(2,0)`（Y 上端）。
- **When**：`push(board, X, up, step)`。
- **Then**：`Y` 撃破（offBoard）、`posOf(X)===(2,0)`。`events` 順 `unit_destroy{Y}` → `unit_push{X}`。

### PR-14 [任意][EDGE] 端まで反復 push してもハングしない ※旧「距離10」を再構成
- **Given**：5×5、`X@(0,2)`。
- **When**：`push(board, X, right, step)` を X が撃破されるまで繰り返す（最大 size+1 回）。
- **Then**：`(1,2)..(4,2)` へ順に移動後、最終 push で `unit_destroy{offBoard}`。`isAlive(X)===false`。各 push() 呼び出しは有限再帰で必ず返る（ハングしない）。
  （理由：多マス到達は BattleEngine ループの責務。push() 単体は1マス・有界再帰で終端する。）

### PR-15 [任意][EDGE] 角からの即時盤外撃破
- **Given**：5×5、`X@(0,0)`。
- **When**：`push(board, X, up, step)`。
- **Then**：`isAlive(X)===false`、`events===[unit_destroy{unitId:X, from:(0,0), cause:'offBoard'}]` のみ。`moved===[]`。

---

## 2. TriggerProcessor（次点 / T10）

トリガーを `enqueue(item: TriggerQueueItem)`（architecture.md のシグネチャ。`item = { unit, triggerDef, context }`）で積み、`drainCascade(board, pushResolver, step)` を呼んで、返却される `BattleEvent[]`（および最終盤面）を検証する。`triggerDef` は対象ユニットの該当トリガー定義（各テストのローカルヘルパー `trig(unit, on)` 等で取得）。スパーク（盤面に既に起きた押し/撃破）は、その結果として誘発されるトリガーを `enqueue` してから `drainCascade` を呼ぶ形で表現する。効果は専用イベントを持たず、`PushResolver` 由来の `unit_push` / `unit_destroy`（pull/swap は `unit_move`）と `trigger_fire` として現れる。TP-01〜TP-06 は「`drainCascade` の返却イベント列に対象の反応が含まれるか」で検証する（反応トリガーを持たないユニットは `enqueue` 対象が無いため `findResponders` で検証する）。

### TP-01 [必須] reactor の on_pushed が前方を押す
- **Given**：5×5、`A.reactor@(2,2)` [R]、`B.dummy@(3,2)` [T]。R は右へ押されて (2,2) で生存した直後とする。
- **When**：`enqueue({ unit:R, triggerDef:trig(R,'on_pushed'), context:{ dir:'right' } })` の後 `drainCascade(board, pushResolver, step)`。
- **Then**：返却イベント列に `unit_push{ unitId:T, dir:'right' }`（T:(3,2)→(4,2)）を含む。`posOf(T)===(4,2)`、`posOf(R)===(2,2)`。

### TP-02 [必須][EDGE] 前方が空なら反応なし
- **Given**：5×5、`A.reactor@(2,2)` [R]、`(3,2)` 空。
- **When**：`enqueue({ unit:R, triggerDef:trig(R,'on_pushed'), context:{ dir:'right' } })` の後 `drainCascade(board, pushResolver, step)`。
- **Then**：返却イベント列に `unit_push` を含まない（`trigger_fire` のみ）。`posOf(R)===(2,2)`。

### TP-03 [必須] 非 reactor は on_pushed で反応しない
- **Given**：5×5、`A.pusher@(2,2)` [P]。
- **When**：`findResponders([P], 'on_pushed')`（pusher は `on_pushed` トリガーを持たないため、`enqueue` 対象の `triggerDef` が存在しない）。
- **Then**：`[]`（空配列）。reactor を1体含む集合では当該 reactor のみ返る。

### TP-04 [必須] bomber の on_destroy が4近傍を吹き飛ばす
- **Given**：5×5、`A.bomber@(2,2)` [Bm]、`D1@(1,2) D2@(3,2) D3@(2,1) D4@(2,3)`。Bm は撃破され盤上から除去済みとする。
- **When**：`enqueue({ unit:Bm, triggerDef:trig(Bm,'on_destroy'), context:{ sourcePos:(2,2) } })` の後 `drainCascade(board, pushResolver, step)`。
- **Then**：返却イベント列に `trigger_fire{ unitId:Bm, triggerKind:'on_destroy', effectKind:'explode' }` と、4近傍を外向きに押す `unit_push` を含む：`D1→(0,2)`(left), `D2→(4,2)`(right), `D3→(2,0)`(up), `D4→(2,4)`(down)。

### TP-05 [必須][EDGE] 盤外撃破された bomber も lastPos を中心に爆発
- **Given**：5×5、`A.bomber@(4,2)` [Bm]、`D@(4,1)`（爆心の上隣）。Bm は右へ押されて盤外撃破済み（`unit_destroy` の `from=(4,2)` が lastPos）。
- **When**：`enqueue({ unit:Bm, triggerDef:trig(Bm,'on_destroy'), context:{ sourcePos:(4,2) } })` の後 `drainCascade(board, pushResolver, step)`。
- **Then**：返却イベント列に `D@(4,1)` を `up` へ押す `unit_push`（D→(4,0)）を含む。爆心は lastPos=(4,2)。

### TP-06 [必須] 非 bomber の死亡では爆発しない
- **Given**：5×5、`A.pusher@(2,2)` [P] が死亡。
- **When**：`findResponders([P], 'on_destroy')`（pusher は `on_destroy` トリガーを持たないため、`enqueue` 対象の `triggerDef` が存在しない）。
- **Then**：`[]`（空配列）。

### TP-07 [必須] スパーク1発・連鎖なしで収束
- **Given**：5×5、`X@(2,2)` のみ（反応トリガーを持たない素のユニット）。
- **When**：`pushResolver.push(board, X, 'right', step)`（スパーク）の後 `drainCascade(board, pushResolver, step)`。
- **Then**：`posOf(X)===(3,2)`。スパークの `unit_push` 1件のみで、`drainCascade` は追加反応なく空配列を返す（ループ終了）。

### TP-08 [必須][SHOWCASE] 多段ドミノ：押し→reactor 伝播→前方ユニット移動
- **Given**：6×6、`A.reactor@(2,2)` [R]、`B.dummy@(4,2)` [D]、`(3,2)` 空。
- **When**：`pushResolver.push(board, R, 'right', step)`（R:(2,2)→(3,2)）の後、`enqueue({ unit:R, triggerDef:trig(R,'on_pushed'), context:{ dir:'right' } })` し `drainCascade(board, pushResolver, step)`。
- **Then**：`posOf(R)===(3,2)`, `posOf(D)===(5,2)`。`drainCascade` の返却は `trigger_fire{R, on_pushed}` → `unit_push{D, dir:'right'}` の順。スパークの `unit_push{R}` を含めると **最大連鎖段数 ≥ 2**。

### TP-09 [必須][EDGE] 無限ループ防止（上限ガード）
- **Given**：循環する反応を作る（実装ヒント：テスト専用ユニット `looper` を1体定義し、`on_pushed → push_self`（同方向へ自分を再 push）とする。盤端より長い盤に置けば自己 push が再帰的に続く）。
- **When**：`enqueue({ unit:looper, triggerDef:trig(looper,'on_pushed'), context:{ dir:'right' } })` の後 `drainCascade(board, pushResolver, step)`。
- **Then**：処理は `MAX_CASCADE_STEPS` で打ち切られ、**関数は必ず返る（ハング/スタックオーバーフローしない）**。返却イベント長は `MAX_CASCADE_STEPS` に比例する有限値（`<= MAX_CASCADE_STEPS * 2 + 余裕`）。

### TP-10 [必須] 連鎖中の死亡が on_destroy を発火（同一カスケード内）
- **Given**：5×5、`A.reactor@(3,2)` [R]、`B.bomber@(4,2)` [Bm]（右端）、`D@(4,1)`（Bm の上隣）。R は右へ押されて (3,2) で生存した直後とする。
  - 注：MVP にダメージ効果は無いため、旧 `damage` スパークは「連鎖中に押し出しで盤外撃破される」形へ置換した。
- **When**：`enqueue({ unit:R, triggerDef:trig(R,'on_pushed'), context:{ dir:'right' } })` の後 `drainCascade(board, pushResolver, step)`。
- **Then**：返却イベント列は `trigger_fire{R, on_pushed}` → `unit_destroy{Bm}`（R が Bm を盤外へ押す）→ `trigger_fire{Bm, on_destroy}` → `unit_push`（爆風で D→(4,0)）の順。`unit_destroy{Bm}` より後に `Bm` の `on_destroy` の `trigger_fire` が現れる。

### TP-11 [必須][EDGE] 盤外撃破された reactor は on_pushed を発火しない
- **Given**：5×5、`B.reactor@(4,2)` [R]（右端）。R は右へ押されて盤外撃破済み（盤上から消えている）。
- **When**：`enqueue({ unit:R, triggerDef:trig(R,'on_pushed'), context:{ dir:'right' } })` の後 `drainCascade(board, pushResolver, step)`。
- **Then**：`isAlive(R)===false`（offBoard）。`drainCascade` は R 由来の `trigger_fire` も伝播 `unit_push` も返さない（盤面を離れた生存中トリガーはスキップ）。

### TP-12 [必須][EDGE] pull は on_pushed を発火しない
- **Given**：5×5、`A.magnet@(2,2)` [M]、`B.reactor@(2,0)` [R]（M が引き寄せる対象）。
- **When**：`enqueue({ unit:M, triggerDef:trig(M,'on_adjacent_enemy'), context:{} })` の後 `drainCascade(board, pushResolver, step)`（隣接条件の判定は BattleEngine の責務のため、ここでは当該トリガーを直接 enqueue する）。
- **Then**：R は `unit_move`（pull、(2,0)→(2,1)）で動くのみ。返却イベント列に `unit_push` を含まず、R の `on_pushed` 伝播は発火しない（`on_pushed` は `unit_push` 限定）。

### TP-13 [任意] trigger 発火時に triggerFired を記録
- **Given**：TP-01 と同配置で reactor が反応する spark。
- **When**：`resolveCascade(...)`。
- **Then**：`log` に `triggerFired{unitId:R, on:'onPushed'}` を含む。

### TP-14 [任意][EDGE] 連鎖爆発：bomber 撃破→爆風で別 bomber 撃破→再爆発
- **Given**：6×6、`A.bomber1@(2,2)` [B1] `hp=1`、`A.bomber2@(3,2)` [B2]、B2 が爆風で盤外へ出る配置（例：B2 の右に空き無し＝端寄せ）。spark = `[damage{targetId:B1, amount:1}]`。
- **When**：`resolveCascade(...)`。
- **Then**：`death{B1}` → `explode` → B2 が押されて `death{B2}` → 再び `explode`。連鎖が再帰的に処理され、上限内で収束。

---

## 3. 支えとなる必須テスト（Initiative / WinCondition / Simulator / Codec）

MVP 完成判定（エンジンの正しさ＋決定論＋入出力）に必要な最小群。

> **【フェーズ分類の確定（不整合修正）】**
> - **SUP-01〜SUP-08**：エンジン期の必須（フェーズ1）。
> - **SUP-09〜SUP-12（共有コード codec）**：**フェーズ2 / T19 の必須**。codec はエンジン期には実装されず（architecture.md・tasks.md と整合）、T18 の Go 判定はこれらを含まない。旧記載（§5 で「エンジン期 Go」に含めていた）を本注記で訂正する。
> - **【旧シグネチャ注記】** SUP-01〜SUP-08 の When 列は旧名（`runBattle`/`computeTurnOrder`/`checkWin`/`judgeTimeout`）で書かれているが、現行実装は `BattleEngine.run(board)` / `InitiativeQueue.sort` / `VictoryChecker.checkCoreDestroyed` / `checkEndOfGame`。**検証する振る舞いは同一**。テスト変換時は現行名に読み替える（PR/TP セクションは更新済み）。
> - SUP-09〜12 の `encodeBoard`/`decodeBoard`/`SCHEMA_VERSION` は現行確定名（CLAUDE.md §6）。

### SUP-01 [必須] 行動順は speed 降順
- **Given**：speed が `pusher=3, swapper=4, magnet=2` の3体を配置。
- **When**：`computeTurnOrder(state)`。
- **Then**：順序は `swapper(4) → pusher(3) → magnet(2)`。

### SUP-02 [必須][EDGE] speed 同値は読み順（y昇順→x昇順）
- **Given**：同 speed の3体を `(2,1),(3,1),(1,2)` に配置。
- **When**：`computeTurnOrder(state)`。
- **Then**：`(2,1) → (3,1) → (1,2)`。

### SUP-03 [必須] 敵コア消滅で勝利
- **Given**：`A.core` 生存、`B.core` は盤上に存在しない。
- **When**：`checkWin(state)`。
- **Then**：`{ winner:'A', reason:含む "core" }`。

### SUP-04 [必須][EDGE] 両コア同時消滅は引き分け
- **Given**：`A.core` も `B.core` も盤上に存在しない。
- **When**：`checkWin(state)`。
- **Then**：`{ winner:'draw' }`。

### SUP-05 [必須][EDGE] 片方の全ユニット消滅で勝利
- **Given**：B 側のユニットが0、A 側が1体以上。
- **When**：`checkWin(state)`。
- **Then**：`{ winner:'A' }`。

### SUP-06 [必須][EDGE] タイムアウト判定のタイブレーク（生存数→コアHP→総HP）
- **Given**：規定ラウンド到達。A・B とも生存3体だが `A.core.hp=5 > B.core.hp=3`。
- **When**：`judgeTimeout(state)`。
- **Then**：`{ winner:'A' }`（生存数同 → コアHP で A）。
- **追加**：生存数もコアHPも同・総HP で決まるサブケース、すべて同値で `draw` も検証。

### SUP-07 [必須][CRITICAL] シミュレータの決定論（同入力→同イベント列）
- **Given**：固定の `boardA`, `boardB`。
- **When**：`runBattle(boardA, boardB)` を2回実行。
- **Then**：両結果の `events` が **完全一致**（deep equal）、`winner`・`rounds` も一致。

### SUP-08 [必須] コアを盤外へ押して勝利（結合）
- **Given**：A の `pusher` 連鎖が数ラウンド以内に `B.core` を盤外へ出せる固定配置。
- **When**：`runBattle(boardA, boardB)`。
- **Then**：`winner==='A'`、`reason` に "core"、`events` 末尾に `battleEnd`。

### SUP-09 [必須] 共有コードの往復一致
- **Given**：任意の有効 `board`。
- **When**：`decodeBoard(encodeBoard(board))`。
- **Then**：size・全ユニットの type/team/座標/facing が元と一致。

### SUP-10 [必須][EDGE] 不正コード拒否：バージョン不一致
- **Given**：`v` が `SCHEMA_VERSION` と異なるコード。
- **When**：`decodeBoard(code)`。
- **Then**：例外を投げる。

### SUP-11 [必須][EDGE] 不正コード拒否：盤外座標
- **Given**：5×5 盤に `(99,99)` のユニットを含むコード。
- **When**：`decodeBoard(code)`。
- **Then**：例外を投げる。

### SUP-12 [必須][EDGE] 不正コード拒否：未知 typeId / 座標重複 / コア不在
- **Given**：(a) 未知 `t:'dragon'`、(b) 同座標2体、(c) コア0体 のコード各種。
- **When**：`decodeBoard(code)`。
- **Then**：いずれも例外を投げる。

### SUP-13 [任意] 盤面空間索引の整合（多操作後）
- **Given**：`board` に add→move→remove を多数適用。
- **When**：各操作後に `unitAt` と `getUnit` を照合。
- **Then**：常に整合。撃破済み升は空。

---

## 4. 将来実装向けの任意テスト（OPT）

MVP の6ユニットでは未使用のトリガー・拡張・性能。**新ユニット追加時に必須へ昇格**する想定で雛形を用意。

### OPT-01 [任意] onSpawn：開戦時の自動効果
- **Given**：`onSpawn` を持つ将来ユニットを配置。
- **When**：`runBattle` 開始直後（round 1 の手番前にスパーク注入する設計なら）。
- **Then**：開幕の `onSpawn` 効果が `log` 冒頭に現れる。

### OPT-02 [任意][EDGE] onEnemyAdjacent：連鎖中に隣接が成立して発火
- **Given**：移動の結果、味方ユニットの隣升に敵が来る配置。
- **When**：`resolveCascade` 中に隣接が発生。
- **Then**：その時点で `onEnemyAdjacent` が1回だけ発火（同一隣接で多重発火しない）。

### OPT-03 [任意] onAllyDeath：味方撃破で発火
- **Given**：`onAllyDeath` 持ちと、同チームの撃破対象。
- **When**：味方が死亡。
- **Then**：対応 Effect が生成。自分自身の死亡では発火しない（onDeath との切り分け）。

### OPT-04 [任意] onMove：自分の移動で発火
- **Given**：`onMove` 持ちが `advance` で移動。
- **When**：移動イベント発生。
- **Then**：移動1回につき1回発火。押されての移動でも発火するか（onPushed との関係）を仕様化して検証。

### OPT-05 [任意][EDGE] onCollide：押せない衝突（壁/不動）で発火
- **Given**：`onCollide` 持ちが移動先で衝突。
- **When**：`blocked` となる衝突が発生。
- **Then**：`onCollide` 発火。push 成功時の挙動との差を検証。

### OPT-06 [任意][EDGE] explode の8近傍バリアント
- **Given**：8近傍版 explode を持つ設定。
- **When**：bomber 死亡。
- **Then**：斜めを含む8マスのユニットが外向きに押される。

### OPT-07 [任意] 性能：大盤・多数ユニットでも完走
- **Given**：12×12、各陣営20体程度の固定配置。
- **When**：`runBattle`。
- **Then**：規定ラウンド内に終了し、実行が一定時間内（例：100ms）に収まる。決定論も保持。

### OPT-08 [任意] シード付き RNG の決定論（RNG 導入時）
- **Given**：同一シードで RNG を使う将来ロジック。
- **When**：同条件で2回実行。
- **Then**：結果が一致。シード違いで分岐。

---

## 5. 分類サマリー（MVP 完成判定）

**[必須・エンジン期]（全緑＝エンジン期 Go ＝ T18）**
PR-01〜PR-11 / TP-01〜TP-12 / SUP-01〜SUP-08（計31ケース）。
これらは「押し出しの正しさ・連鎖の正しさ・死亡と反応の相互作用・決定論・勝敗判定」を網羅し、UI フェーズへ進む前提条件。

**[必須・フェーズ2]（codec / T19）**
SUP-09〜SUP-12（計4ケース）＝共有コードの往復一致と不正コード拒否。非同期対戦ループの前提。T19 着手時に緑にする。

**特に死守すべき3つ**
1. **SUP-07（決定論）** — 非同期対戦の根幹。落ちたら設計に乱数/順序依存が混入。
2. **TP-08（多段ドミノ）** — ゲームの“面白さ”の核がコードで成立する証拠。
3. **TP-11（撃破された reactor は onPushed しない）** と **PR-07/PR-10（盤外撃破・コア押し出し）** — 連鎖と勝利条件が破綻しない境界。

**[任意]（将来・強化・ストレス）**
PR-12〜PR-15 / TP-13〜TP-14 / SUP-13 / OPT-01〜OPT-08。
MVP 判定には不要。新ユニット追加・8近傍爆発・性能・RNG 導入の各タイミングで該当 OPT を必須へ昇格させる。

---

## 6. 実装順（Claude Code への推奨）

1. `tests/helpers.ts`（§0 のヘルパー）を作る。
2. **PR-01〜PR-15**（PushResolver / T09）を上から実装。PR-01〜PR-11 を緑にする。
3. **TP-01〜TP-14**（TriggerProcessor / T10）。TP-01〜TP-12 を緑にする。TP-08 と TP-11 は重点。
4. **SUP-01〜SUP-08**。SUP-07（決定論）は必ず含める。← ここまででエンジン期 Go（T18）。
5. **SUP-09〜SUP-12** は **フェーズ2 / T19（codec）** で実装する（`tests/share/codec.test.ts`）。
6. 残りの **[任意]** は MVP 判定後に着手。

各ステップ後に `npm test` と `npm run typecheck` を緑にし、`tasks.md` の対応タスクにチェックを入れる。
