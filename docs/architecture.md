# 連鎖要塞 / CASCADE — アーキテクチャ設計書

> 本書はフェーズ1（戦闘エンジン）の設計を主とし、末尾の「**フェーズ2 設計（UI・共有コード）**」章でフェーズ2の追加設計を定義する。
> フェーズ1の本文は完成済みエンジンの記録として保持する。フェーズ2の新規モジュール（`src/share/`・`src/ui/`）は末尾章を参照。

---

## 技術スタック

| 項目 | 選択 | 理由 |
|---|---|---|
| 言語 | TypeScript | ユニット・イベントの型が複雑になるため型安全が必須 |
| ビルド | Vite | `vite build` → `dist/` → GitHub Pages へそのまま配置 |
| ホスティング | GitHub Pages | サーバーレス静的サイト |
| テスト | Vitest | Vite との親和性、TypeScript ネイティブ |
| 圧縮 | lz-string | 共有コード用（フェーズ2 / T19 で実装。末尾章参照） |

---

## ディレクトリ構成

```
Chain/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html                    # エントリポイント（フェーズ1はコンソール確認用）
├── src/
│   ├── main.ts                   # エントリポイント（フェーズ1はデバッグ実行）
│   │
│   ├── types/                    # 型定義（他モジュールに依存しない）
│   │   ├── direction.ts          # Direction 型
│   │   ├── unit.ts               # Unit, UnitType, TriggerDef など
│   │   ├── board.ts              # BoardState, Position
│   │   ├── event.ts              # BattleEvent, EventKind
│   │   └── battle.ts             # BattleResult, BattleConfig
│   │
│   ├── data/                     # 静的データ（型定義に依存）
│   │   └── unitTemplates.ts      # 6種のユニット定義（ファクトリ）
│   │
│   ├── engine/                   # 戦闘エンジン本体（フェーズ1のコア）
│   │   ├── Board.ts              # 盤面状態管理クラス
│   │   ├── InitiativeQueue.ts    # 行動順管理（決定論的）
│   │   ├── PushResolver.ts       # 押し出し・衝突の再帰解決
│   │   ├── TriggerProcessor.ts   # トリガー誘発・カスケード解決
│   │   ├── VictoryChecker.ts     # 勝敗条件判定
│   │   └── BattleEngine.ts       # メインループ（全モジュールを統合）
│   │
│   ├── share/                    # 共有コード（フェーズ2 / T19。末尾章で詳細設計）
│   │   ├── format.ts             # SCHEMA_VERSION・中間表現・type/side/facing のトークン化
│   │   ├── encode.ts             # encodeBoard(board): string（盤面 → "v1:..." 文字列）
│   │   └── decode.ts             # decodeBoard(code): Board（検証付き復号）
│   │
│   ├── ui/                        # 画面層（フェーズ2 / T20〜。末尾章で詳細設計）
│   │   ├── App.ts                # アプリのルート・画面遷移（エディタ ⇄ リプレイ）
│   │   ├── BoardView.ts          # 盤面の DOM 描画（エディタ／リプレイ共用）
│   │   ├── Editor.ts             # 盤面エディタ（配置・コスト管理）
│   │   ├── ReplayPlayer.ts       # BattleEvent[] の時間軸再生
│   │   ├── ShareCode.ts          # コードのコピー／読込・URL `?b=` 連携
│   │   └── ResultShare.ts        # Wordle 風の結果テキスト生成
│   │
│   ├── dojo/                     # 道場相手プリセット（フェーズ1末尾）
│   │   └── opponents.ts          # 5〜10体の相手構成定義
│   │
│   ├── balance/                  # フェーズ3 / T24 バランス検証ツール（出荷ランタイム外の解析）
│   │   ├── builds.ts             # 代表構築データ（construction frame）
│   │   ├── harness.ts            # 決定論総当たり・勝率集計・支配検出・コスト上限判定
│   │   └── run.ts                # `npm run balance` レポート出力エントリ（tsx）
│   │
│   └── debug/                    # フェーズ1用デバッグツール（UIなし）
│       ├── consolePrinter.ts     # イベントログをコンソール整形出力
│       └── scenarios.ts          # 手作りテストシナリオ（盤面定義）
│
└── tests/
    ├── engine/
    │   ├── Board.test.ts
    │   ├── PushResolver.test.ts
    │   ├── TriggerProcessor.test.ts
    │   ├── VictoryChecker.test.ts
    │   └── BattleEngine.test.ts
    └── scenarios/
        └── chainScenarios.test.ts  # 「この盤面ならこの連鎖になる」統合テスト
```

---

## クラス構成

### 型定義層 `src/types/`

```typescript
// direction.ts
type Direction = 'up' | 'down' | 'left' | 'right'

// unit.ts
type UnitType = 'pusher' | 'reactor' | 'bomber' | 'magnet' | 'swapper' | 'core'
type Side = 'player' | 'enemy'

type TriggerEventKind =
  | 'on_enter'           // 盤面に出現した時
  | 'on_move'            // 移動した時
  | 'on_push_other'      // 何かを押した時
  | 'on_pushed'          // 押された時
  | 'on_destroy'         // 倒された時（盤外 or HP0）
  | 'on_adjacent_enemy'  // 自ターン開始時、隣に敵がいる時

type TriggerEffectKind =
  | 'push_target'        // 対象を1マス押す
  | 'push_self'          // 自身を1マス移動
  | 'pull_nearest'       // 最寄り敵を1マス引き寄せる
  | 'explode'            // 周囲Nマスを吹き飛ばす
  | 'swap_adjacent'      // 隣の敵と位置を入れ替える

interface TriggerEffect {
  kind: TriggerEffectKind
  dir?: Direction | 'facing' | 'away_from_self'
  radius?: number        // explode 用
  damage?: number        // 将来拡張用
}

interface TriggerDef {
  on: TriggerEventKind
  effect: TriggerEffect
}

interface Unit {
  id: string             // ユニーク ID（例: "p_0", "e_2"）
  type: UnitType
  hp: number
  maxHp: number
  speed: number          // 行動順決定（降順、同値は座標順）
  facing: Direction
  position: Position
  side: Side
  triggers: TriggerDef[]
  cost: number           // 配置コスト（バランス調整用）
}

// board.ts
interface Position { x: number; y: number }

interface BoardState {
  width: number
  height: number
  units: Map<string, Unit>   // key: unit.id
  turn: number
  stepCount: number          // 連鎖ステップ数（無限ループ防止用）
  phase: 'battle' | 'ended'
}

// event.ts
type EventKind =
  | 'unit_move'
  | 'unit_push'
  | 'unit_destroy'
  | 'trigger_fire'
  | 'cascade_start'
  | 'cascade_end'
  | 'turn_start'
  | 'battle_end'

interface BattleEvent {
  step: number
  kind: EventKind
  unitId?: string
  targetId?: string
  from?: Position
  to?: Position
  dir?: Direction
  triggerKind?: TriggerEventKind
  effectKind?: TriggerEffectKind
  metadata?: Record<string, unknown>
}

// battle.ts
type WinReason =
  | 'core_destroyed'     // 相手コアを撃破
  | 'unit_count'         // ターン終了時、生存ユニット数が多い
  | 'core_hp'            // 同数ならコアHPが高い方
  | 'total_hp'           // さらに同数なら総HPが高い方
  | 'timeout'            // 完全同点 → 引き分け

interface BattleResult {
  winner: Side | 'draw'
  reason: WinReason
  totalTurns: number
  maxChainDepth: number  // 最大連鎖深度（記録用）
  events: BattleEvent[]
}

interface BattleConfig {
  maxTurns: number       // デフォルト 30
  maxStepsPerTurn: number // 無限ループ防止 デフォルト 200
}
```

---

### `Board` クラス (`src/engine/Board.ts`)

盤面状態の読み書きを担う。副作用はこのクラス経由でのみ行う。

```typescript
class Board {
  readonly width: number
  readonly height: number
  private unitMap: Map<string, Unit>           // id → Unit
  private posMap: Map<string, Unit>            // "x,y" → Unit

  // 読み取り
  getUnit(id: string): Unit | undefined
  getUnitAt(pos: Position): Unit | undefined
  getAdjacentUnits(pos: Position): Unit[]
  getUnitsInLine(pos: Position, dir: Direction): Unit[]
  getAllUnits(): Unit[]
  getUnitsBySide(side: Side): Unit[]
  isInBounds(pos: Position): boolean
  isEmpty(pos: Position): boolean

  // 書き込み（イベントを返す）
  placeUnit(unit: Unit): void
  removeUnit(id: string): void
  moveUnit(id: string, to: Position): void
  updateUnit(id: string, partial: Partial<Unit>): void

  // ユーティリティ
  posKey(pos: Position): string    // "x,y"
  clone(): Board                   // テスト・リプレイ用
  toSnapshot(): BoardState
}
```

---

### `InitiativeQueue` クラス (`src/engine/InitiativeQueue.ts`)

決定論的な行動順を管理する。

```typescript
class InitiativeQueue {
  // 1ターン内のイテレーション用
  private queue: Unit[]
  private index: number

  // speed 降順、同値は y 昇順 → x 昇順（盤面読み順）で並べた新配列を返す（入力は不変）
  static sort(units: Unit[]): Unit[]

  constructor(units: Unit[])
  next(): Unit | undefined
  hasNext(): boolean
  reset(units: Unit[]): void  // ターン開始時に再構築
  remaining(): Unit[]         // デバッグ用
}
```

---

### `PushResolver` クラス (`src/engine/PushResolver.ts`)

押し出しの再帰的解決。連鎖押しと盤外撃破を担う。

```typescript
interface PushResult {
  moved: Array<{ unitId: string; from: Position; to: Position }>
  destroyed: string[]   // 盤外に出たユニットの id
  events: BattleEvent[]
}

class PushResolver {
  // unit を dir 方向へ1マス押す。押し先にユニットがいれば連鎖押し。
  // board を直接更新し、発生したイベントを返す。
  push(board: Board, unitId: string, dir: Direction, step: number): PushResult
}
```

---

### `TriggerProcessor` クラス (`src/engine/TriggerProcessor.ts`)

FIFO キューでトリガーを処理し、カスケードを解決する。

```typescript
interface TriggerQueueItem {
  unit: Unit
  triggerDef: TriggerDef
  context: { pushedBy?: string; dir?: Direction; sourcePos?: Position }
}

class TriggerProcessor {
  private queue: TriggerQueueItem[]

  // 誘発できるトリガーをキューに積む
  enqueue(item: TriggerQueueItem): void

  // キューが空になるまで全トリガーを処理（カスケード）
  // board を直接更新し、全発生イベントを返す
  drainCascade(board: Board, pushResolver: PushResolver, step: number): BattleEvent[]

  // ヘルパー：特定イベントに反応するトリガーを持つユニット全員を列挙
  static findResponders(units: Unit[], eventKind: TriggerEventKind): Unit[]
}
```

---

### `VictoryChecker` クラス (`src/engine/VictoryChecker.ts`)

```typescript
class VictoryChecker {
  // コアが存在するかチェック（毎連鎖ステップ後に呼ぶ）
  // どちらかのコアが盤上から消えていれば勝敗を返す。両コア存命なら null（継続）。
  // 両コア同時消失は draw（test-spec SUP-03/SUP-04 準拠）。
  static checkCoreDestroyed(board: Board): { winner: Side | 'draw'; reason: WinReason } | null

  // ターン終了後の判定（maxTurns 到達時）
  static checkEndOfGame(board: Board): { winner: Side | 'draw'; reason: WinReason }
}
```

---

### `BattleEngine` クラス (`src/engine/BattleEngine.ts`)

全モジュールを統合するメインループ。

```typescript
class BattleEngine {
  constructor(config?: BattleConfig)

  // 両陣営のユニットを配置済みの単一 Board を受け取り、決着まで走らせる。
  // （呼び出し元が player/enemy を1つの Board に合成する。tasks.md T12 の設計判断に準拠）
  run(board: Board): BattleResult

  // 内部: 1ターン（1ユニットの行動 + カスケード収束）を実行
  private executeTurn(actingUnit: Unit, board: Board): BattleEvent[]

  // 内部: 行動ユニットの move を実行（移動 or 不動）
  private executeMove(unit: Unit, board: Board): BattleEvent[]

  // 無限ループ保護: stepCount > maxStepsPerTurn で強制終了
  private guardStep(board: Board): boolean
}
```

---

## モジュール依存関係

```
src/types/          ← 依存なし（最下層）
    │
    ├── src/data/unitTemplates.ts
    │       └── types のみ参照
    │
    └── src/engine/
            ├── Board.ts
            │       └── types のみ参照
            │
            ├── InitiativeQueue.ts
            │       └── types, Board
            │
            ├── PushResolver.ts
            │       └── types, Board
            │
            ├── TriggerProcessor.ts
            │       └── types, Board, PushResolver
            │
            ├── VictoryChecker.ts
            │       └── types, Board
            │
            └── BattleEngine.ts    ← 最上位
                    └── types, Board, InitiativeQueue,
                        PushResolver, TriggerProcessor, VictoryChecker

src/debug/
    ├── consolePrinter.ts  →  types, engine/Board
    └── scenarios.ts       →  types, data, engine/Board

src/dojo/opponents.ts      →  types, data, engine/Board

tests/ → engine/, types, data
```

依存の方向は **必ず上から下**。循環依存禁止。

---

## 決定論ルール（実装の契約）

| # | ルール | 実装箇所 |
|---|---|---|
| 1 | 行動順：speed 降順、同値は y→x 昇順 | `InitiativeQueue.build()` |
| 2 | 連鎖解決：FIFO キュー、同時誘発は y→x 昇順 | `TriggerProcessor.drainCascade()` |
| 3 | 押し出し：押し先にユニットがあれば再帰的に連鎖押し | `PushResolver.push()` |
| 4 | 盤外撃破：盤外に押し出されたら即座に撃破・on_destroy 誘発 | `PushResolver.push()` |
| 5 | HP0 処理：連鎖ステップの境界（キュー drain 後）でまとめて除去 | `TriggerProcessor.drainCascade()` |
| 6 | 無限ループ防止：1ターン内 stepCount > 200 で強制収束 | `BattleEngine` 内ガード |
| 7 | 乱数禁止：`Math.random()` をエンジン内で一切使わない | 全モジュール |

---

## ユニット定義（MVP 6種）

| ID | 名前 | 移動 | 主トリガー | 連鎖での役割 |
|---|---|---|---|---|
| `pusher` | プッシャー | 前進1 | on_push_other → push_target(facing) | 連鎖の起点 |
| `reactor` | リアクター | 不動 | on_pushed → push_target(away_from_self) | 連鎖の伝播 |
| `bomber` | ボマー | 不動 | on_destroy → explode(radius=1) | 連鎖の拡散 |
| `magnet` | マグネット | 不動 | on_adjacent_enemy → pull_nearest | 位置関係の能動的操作 |
| `swapper` | スワッパー | 不動 | on_adjacent_enemy → swap_adjacent | 陣形崩し |
| `core` | コア | 不動 | なし | 守る対象。撃破で敗北 |

各ユニットのデフォルトパラメータは `src/data/unitTemplates.ts` で定義する。

---

## フェーズ1 完了の定義（Go/No-Go 基準）

> 「手作業で2つの盤面を JSON で定義し、`BattleEngine.run()` を呼ぶと、
> コンソールに連鎖ログが出力され、読んで"ニヤッとする"体験が得られる」

具体的には：
- プッシャーが押す → リアクターが伝播 → ボマーに当たって爆発 → 相手コアが吹き飛ぶ
  …という連鎖がイベントログに記録されて、コンソールで追跡できること。

---
---

# フェーズ2 設計（UI・共有コード）

> フェーズ1（エンジン）完成・Go 判定後の追加設計。要件定義書 §14 の「2か月目：UI（エディタ・リプレイ・共有コード）」に対応する。
> **エンジン層（`types/data/engine`）は不変。** フェーズ2 は新規モジュール `src/share/`・`src/ui/` の追加と `main.ts` の差し替えのみで構成する。

## 方針（フェーズ2 の非交渉ルール）

- **依存は一方向を厳守**：`ui → engine / share / dojo / data / types`。**エンジンは UI を一切 import しない**（DOM/ブラウザAPI も不可）。決定論はエンジンと codec に閉じ込め、UI は「純粋な表示＋入力」に徹する。
- **描画は DOM + CSS Grid、フレームワークなし**（要件定義書 §4）。連鎖アニメが重くなったら Canvas 移行を検討するが MVP では入れない。
- **codec はエンジンと同じ §5 決定論規律に従う**：`Math.random()`/時刻/反復順依存/async を使わない。同一盤面は常に同一コードへ直列化する（ユニットは読み順 y→x で安定ソートしてから書き出す）。
- **リプレイ再生のタイマー（`setTimeout` 等）は UI 層のみ**で使う。エンジン・codec には持ち込まない。

## 依存DAG（フェーズ2 拡張）

```
src/types/  ← 最下層（変更なし）
    │
    ├── src/data/unitTemplates.ts
    │
    ├── src/engine/*               ← フェーズ1で確定・不変
    │
    ├── src/share/                 ← 新規（純粋・決定論的・テスト可能）
    │       format.ts → types
    │       encode.ts → types, engine/Board, share/format, lz-string
    │       decode.ts → types, engine/Board, data/unitTemplates, share/format, lz-string
    │
    └── src/ui/                    ← 新規（最上位・DOM 依存）
            BoardView.ts   → types, engine/Board
            Editor.ts      → types, data, engine/Board, share, ui/BoardView
            ReplayPlayer.ts→ types, engine, ui/BoardView
            ShareCode.ts   → share
            ResultShare.ts → types
            App.ts         → 上記すべて, engine/BattleEngine, dojo
```

逆流・循環は禁止。UI を engine から import した時点で設計違反。

---

## 共有コード codec 設計（`src/share/` / T19）

ゲームの本質「サーバーレス非同期対戦」の心臓部。**盤面 ⇄ 文字列の純粋変換**のみを担い、対戦相手としての反転・合成は扱わない（後述）。

### 公開シグネチャ（CLAUDE.md §6 の確定名に準拠）

```typescript
// share/format.ts
export const SCHEMA_VERSION = 'v1'        // コード先頭プレフィックス

// share/encode.ts
export function encodeBoard(board: Board): string

// share/decode.ts
export function decodeBoard(code: string): Board   // 不正入力は throw（握り潰さない）
```

### コード形式

```
<SCHEMA_VERSION> ":" <lz-string(URLセーフ Base64) で圧縮した中間JSON>
例: "v1:N4Igxg..."
```

- **先頭にバージョン**（要件定義書 §10）。`decodeBoard` は最初に `:` までのプレフィックスを取り出し、`SCHEMA_VERSION` と一致しなければ復号前に throw（**SUP-10**）。
- 圧縮は `lz-string` の **`compressToEncodedURIComponent` / `decompressFromEncodedURIComponent`** を用い、`?b=<code>` でそのまま URL に載る（URLセーフ）。

### 中間表現（直列化対象）

```typescript
interface BoardCodec {
  w: number
  h: number
  u: Array<[t: number, s: number, x: number, y: number, f: number]>
  // t: UnitType を 0..5 にトークン化 / s: Side（player=0, enemy=1）
  // f: Direction（up=0,down=1,left=2,right=3） / x,y: 整数座標
}
```

- `type`/`side`/`facing` は `format.ts` の固定テーブルで**整数トークン化**（短さ＋バージョン管理のため文字列直書きを避ける）。
- ユニットは **読み順（y 昇順 → x 昇順）で安定ソートしてから** `u[]` に積む。これにより同一盤面 → 同一コードを保証（結果シェアの一貫性に必要）。
- 復元時は `data/unitTemplates.ts` の `createUnit()` でユニットを再生成し、座標・facing・side を適用する（HP 等のステータスはテンプレートの既定値に戻す＝構築は「型と配置」のみを共有する）。

### decode の検証（不正入力は例外。SUP-10〜12）

| 検証 | 失敗時 | 対応ケース |
|---|---|---|
| プレフィックスが `SCHEMA_VERSION` と不一致 | throw | SUP-10 |
| 座標が `0 <= x < w` / `0 <= y < h` の範囲外 | throw | SUP-11 |
| 未知の type トークン | throw | SUP-12(a) |
| 同一座標に2体 | throw | SUP-12(b) |
| コアが0体（守る対象が無い構築は不正） | throw | SUP-12(c) |
| 圧縮文字列が壊れている／JSON 不正 | throw | （堅牢性） |

### スコープ外（codec は扱わない＝別タスク）

- **対戦相手としての反転・合成**：共有コードは「片陣営の構築（自分の盤面）」を表す。対戦時に相手コードを `enemy` 側へ反転（上下ミラー＋ `side` 反転）して自分の盤面と1つの `Board` に合成する処理は、**battle セットアップの責務**（T22 で `setupBattle(myBoard, oppBoard): Board` 相当として実装）。codec はあくまで `Board ⇄ string` の往復に限定する。

---

## UI 層 設計（`src/ui/` / T20〜）

> UI は決定論制約の外（タイマー・DOM 可）。ただし**ゲームロジックは一切持たない**：盤面の真実は `Board`、戦闘の真実は `BattleEngine.run()` が返す `BattleResult.events`。UI はそれを描画・再生・編集するだけ。

| モジュール | 責務 | 対応タスク |
|---|---|---|
| `BoardView` | `Board` を CSS Grid の DOM に描画。エディタとリプレイで共用 | T20 |
| `Editor` | クリック/タップでユニット配置・撤去・向き変更。コスト上限を管理し `encodeBoard` でコード化 | T20 |
| `ReplayPlayer` | `BattleResult.events` を step 順に再生（再生/一時停止/早送り/スキップ）。`BoardView` を更新 | T21 |
| `ShareCode` | コードのコピー／貼り付け読込、`?b=<code>` の URL 生成と起動時パース | T22 |
| `App` | 画面遷移（エディタ ⇄ リプレイ）、道場相手の選択、対戦実行（`setupBattle` → `BattleEngine.run` → `ReplayPlayer`） | T20〜 |
| `ResultShare` | 勝敗・最大連鎖数・決め手を Wordle 風の短文＋絵文字に整形 | T24 |

### 画面遷移（最小）

```
[エディタ] --「対戦」--> setupBattle(自盤, 相手盤) --> BattleEngine.run() --> [リプレイ] --「編集に戻る」--> [エディタ]
   ↑ 起動時 ?b=<code> があれば decodeBoard して相手盤にセット
```

---

## フェーズ2 完了の定義（Go/No-Go 基準）

> 「自分の構築を共有コード（URL一発）にして人に渡すと、相手はブラウザで開くだけで非同期対戦のリプレイを観られ、負けたら**相手の盤面を編集して再挑戦**できる」——このカウンター構築のループが成立すること（要件定義書 §5 の MVP ゴール）。

具体的には：
- エディタで6種を配置 → コスト内で構築 → `encodeBoard` でコード生成。
- 相手コード（または `?b=` URL）を読み込み → `decodeBoard` → 合成 → `BattleEngine.run` → リプレイで連鎖が観られる。
- 共有コードの往復（**SUP-09**）と不正コード拒否（**SUP-10〜12**）が全緑。

---
---

# フェーズ3 設計（バランス検証ツール `src/balance/` / T24）

> 要件定義書 §215-218「バランス方針」に対応。戦闘は完全決定論（CLAUDE.md §5）なので、
> 代表構築どうしを総当たりさせる「全数テストに近い検証」で支配的コンボ（壊れ）を機械的に検出できる。
> **エンジン層（types/data/engine）と codec は不変。** 解析は新規モジュール `src/balance/` のみで構成する。

## 位置づけと依存

`src/balance/` は **出荷ランタイムの依存グラフ外の解析ツール**（`src/debug/` と同格）。UI でも import されず、`npm run balance`（tsx）とテストからのみ使う。

- `builds.ts` → `types` のみ（代表構築データ。construction frame ＝プレイヤー側・下段・`up` 向き）。
- `harness.ts` → `types, data/unitTemplates, engine/Board, engine/BattleEngine, dojo, balance/builds, ui/setupBattle`。
  - 反転・合成は `ui/setupBattle`（純粋・DOM 非依存）を再利用する。これは新規の解析ツール → 既存純粋関数への一方向依存で、エンジンの決定論・テスト容易性を損なわない（balance に依存するのはテストと run.ts のみ）。
- `run.ts` → `balance/harness`。

乱数・時刻・反復順依存・async は持たない（解析自体も決定論。同入力 → 同レポート）。

## 検証手法と是正方針

- **総当たり**：投入可能（コスト上限 12 以内）な構築の順序付き相異ペアを全戦。`(A,B)` と `(B,A)` の両方を回し攻守入替の2戦（要件定義書 §173）を網羅する。
- **指標**：構築ごとの勝率・引き分け率・勝利時平均連鎖深度、コスト、コスト上限超過の除外一覧。
- **「壊れ」の定義**：安価（cost ≤ 4）かつ高勝率（≥ 0.85）の支配的構築。検出したら §217 に従い「その接続を弱める/コスト化する」。
- **バランスレバー**：MVP の戦闘では撃破は盤外押し出しのみ（HP ダメージ未実装）で、HP は同点タイブレーク限定、不動ユニットの speed も実質不活性。よって勝敗を動かす実質的なレバーは **cost（枠制限）** であり、T24 の調整は cost に集約する。
- **回帰ガード**：`tests/balance/balance.test.ts`（T24-01〜08）で、決定論・最安支配の不在・最高勝率上限・引き分け量産の不在・コスト上限の発効・道場の編成可能性・是正コストの下限を不変条件として固定する。
