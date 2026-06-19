# 連鎖要塞 / CASCADE — 実装タスクリスト（フェーズ1：戦闘エンジン）

> 各タスクは Claude Code が1回の実装で完結できる粒度。
> 上から順に実装すること（依存関係を考慮した順序）。
> 前のタスクが完了してから次へ進む。

---

## セットアップ

### T01: プロジェクト初期化

**目的**: Vite + TypeScript + Vitest の動くプロジェクト骨格を作る。

**作成するファイル**:
- `package.json`
- `vite.config.ts`
- `tsconfig.json`
- `index.html`
- `src/main.ts`（空のエントリポイント）

**package.json の dependencies**:
```json
{
  "devDependencies": {
    "typescript": "^5.x",
    "vite": "^5.x",
    "vitest": "^1.x"
  }
}
```

**vite.config.ts**:
- `base: './'`（GitHub Pages 向け相対パス）
- `test: { globals: true, environment: 'node' }`

**tsconfig.json**:
- `strict: true`
- `target: "ES2022"`
- `moduleResolution: "bundler"`

**完了条件**: `npm install && npm run build` が成功し、`npm test` が（テストなしで）パスする。

---

### T02: ディレクトリ構造の作成

**目的**: `architecture.md` に定義したディレクトリを作り、空の `.ts` ファイルでプレースホルダーを置く。

**作成するディレクトリ・ファイル（空ファイル）**:
```
src/types/direction.ts
src/types/unit.ts
src/types/board.ts
src/types/event.ts
src/types/battle.ts
src/data/unitTemplates.ts
src/engine/Board.ts
src/engine/InitiativeQueue.ts
src/engine/PushResolver.ts
src/engine/TriggerProcessor.ts
src/engine/VictoryChecker.ts
src/engine/BattleEngine.ts
src/debug/consolePrinter.ts
src/debug/scenarios.ts
src/dojo/opponents.ts
tests/engine/Board.test.ts
tests/engine/PushResolver.test.ts
tests/engine/TriggerProcessor.test.ts
tests/engine/VictoryChecker.test.ts
tests/engine/BattleEngine.test.ts
tests/scenarios/chainScenarios.test.ts
```

各ファイルの内容は `export {}` のみ（空ファイル）でよい。

**完了条件**: `npm run build` が成功する（空ファイルでエラーなし）。

---

## 型定義層

### T03: `Direction` 型の定義

**ファイル**: `src/types/direction.ts`

**実装内容**:
```typescript
export type Direction = 'up' | 'down' | 'left' | 'right'

export const OPPOSITE: Record<Direction, Direction> = {
  up: 'down', down: 'up', left: 'right', right: 'left'
}

export const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up:    { dx: 0, dy: -1 },
  down:  { dx: 0, dy:  1 },
  left:  { dx: -1, dy: 0 },
  right: { dx:  1, dy: 0 },
}
```

**完了条件**: `tsc --noEmit` でエラーなし。

---

### T04: `Unit` 関連の型定義 ✅

**ファイル**: `src/types/unit.ts`

**実装内容**:
- `UnitType = 'pusher' | 'reactor' | 'bomber' | 'magnet' | 'swapper' | 'core'`
- `Side = 'player' | 'enemy'`
- `TriggerEventKind` — 6種類のイベント（`on_enter`, `on_move`, `on_push_other`, `on_pushed`, `on_destroy`, `on_adjacent_enemy`）
- `TriggerEffectKind` — 5種類のエフェクト（`push_target`, `push_self`, `pull_nearest`, `explode`, `swap_adjacent`）
- `TriggerEffect` インターフェース（`kind`, オプション: `dir`, `radius`, `damage`）
- `TriggerDef` インターフェース（`on: TriggerEventKind`, `effect: TriggerEffect`）
- `Unit` インターフェース（`id`, `type`, `hp`, `maxHp`, `speed`, `facing`, `position`, `side`, `triggers`, `cost`）

**完了条件**: `tsc --noEmit` でエラーなし。

---

### T05: `Position` / `BoardState` / `BattleEvent` / `BattleResult` の型定義 ✅

**ファイル**: `src/types/board.ts`, `src/types/event.ts`, `src/types/battle.ts`

**`src/types/board.ts`**:
- `Position` インターフェース（`x: number`, `y: number`）
- `BoardState` インターフェース（`width`, `height`, `units: Map<string, Unit>`, `turn`, `stepCount`, `phase: 'battle' | 'ended'`）

**`src/types/event.ts`**:
- `EventKind` 型（`'unit_move' | 'unit_push' | 'unit_destroy' | 'trigger_fire' | 'cascade_start' | 'cascade_end' | 'turn_start' | 'battle_end'`）
- `BattleEvent` インターフェース（`step`, `kind`, オプション: `unitId`, `targetId`, `from`, `to`, `dir`, `triggerKind`, `effectKind`, `metadata`）

**`src/types/battle.ts`**:
- `WinReason` 型（`'core_destroyed' | 'unit_count' | 'core_hp' | 'total_hp' | 'timeout'`）
- `BattleResult` インターフェース（`winner: Side | 'draw'`, `reason`, `totalTurns`, `maxChainDepth`, `events`）
- `BattleConfig` インターフェース（`maxTurns: number`, `maxStepsPerTurn: number`）

**完了条件**: `tsc --noEmit` でエラーなし。

---

## データ層

### T06: ユニットテンプレートの定義 ✅

**ファイル**: `src/data/unitTemplates.ts`

**目的**: 6種のユニットを生成するファクトリ関数を実装する。

**実装内容**:

```typescript
import type { Unit, UnitType, Side } from '../types/unit'
import type { Position } from '../types/board'
import type { Direction } from '../types/direction'

// 各ユニットのデフォルトパラメータ
const BASE_STATS: Record<UnitType, Pick<Unit, 'hp' | 'maxHp' | 'speed' | 'cost' | 'triggers'>> = {
  pusher:  { hp: 3, maxHp: 3, speed: 5, cost: 2, triggers: [
    { on: 'on_push_other', effect: { kind: 'push_target', dir: 'facing' } }
  ]},
  reactor: { hp: 2, maxHp: 2, speed: 3, cost: 1, triggers: [
    { on: 'on_pushed', effect: { kind: 'push_target', dir: 'away_from_self' } }
  ]},
  bomber:  { hp: 2, maxHp: 2, speed: 2, cost: 3, triggers: [
    { on: 'on_destroy', effect: { kind: 'explode', radius: 1 } }
  ]},
  magnet:  { hp: 2, maxHp: 2, speed: 4, cost: 2, triggers: [
    { on: 'on_adjacent_enemy', effect: { kind: 'pull_nearest' } }
  ]},
  swapper: { hp: 2, maxHp: 2, speed: 4, cost: 2, triggers: [
    { on: 'on_adjacent_enemy', effect: { kind: 'swap_adjacent' } }
  ]},
  core:    { hp: 5, maxHp: 5, speed: 0, cost: 0, triggers: [] },
}

export function createUnit(
  type: UnitType,
  side: Side,
  position: Position,
  facing: Direction = 'right',
  idSuffix?: string
): Unit
```

`id` は `${side[0]}_${type}_${idSuffix ?? 自動連番}` の形式。

**完了条件**: `tsc --noEmit` でエラーなし。

---

## エンジン層

### T07: `Board` クラスの実装 ✅

**ファイル**: `src/engine/Board.ts`

**実装内容**: `architecture.md` に定義した `Board` クラスを完全に実装する。

**メソッド詳細**:
- `constructor(width: number, height: number)` — 空の盤面を初期化
- `getUnit(id: string): Unit | undefined`
- `getUnitAt(pos: Position): Unit | undefined`
- `getAdjacentUnits(pos: Position): Unit[]` — 上下左右4マスのユニット
- `getUnitsInLine(pos: Position, dir: Direction): Unit[]` — dir 方向の全ユニット（近い順）
- `getAllUnits(): Unit[]`
- `getUnitsBySide(side: Side): Unit[]`
- `isInBounds(pos: Position): boolean`
- `isEmpty(pos: Position): boolean`
- `placeUnit(unit: Unit): void` — 盤面外や重複はエラーを throw
- `removeUnit(id: string): void`
- `moveUnit(id: string, to: Position): void` — isInBounds チェック付き
- `updateUnit(id: string, partial: Partial<Unit>): void`
- `posKey(pos: Position): string` — `"${pos.x},${pos.y}"`
- `clone(): Board` — ディープコピー（テスト用）

**注意**: `unitMap`（id → Unit）と `posMap`（"x,y" → Unit）を常に同期させる。

**完了条件**:
- `tests/engine/Board.test.ts` に以下のテストを書いてパスさせる:
  - `placeUnit` で同じ座標に2体置こうとしたらエラー
  - `removeUnit` 後に `getUnitAt` で undefined が返る
  - `isInBounds` が盤外座標で false を返す
  - `getAdjacentUnits` が正しく4方向を返す

---

### T08: `InitiativeQueue` の実装 ✅

**ファイル**: `src/engine/InitiativeQueue.ts`

**実装内容**:

```typescript
export class InitiativeQueue {
  private queue: Unit[]
  private index: number

  // speed 降順、同値は y 昇順 → x 昇順でソート
  static sort(units: Unit[]): Unit[]

  constructor(units: Unit[])
  next(): Unit | undefined    // 次の行動ユニットを返す（なければ undefined）
  hasNext(): boolean
  reset(units: Unit[]): void  // ターン開始時に再構築
  remaining(): Unit[]         // デバッグ用
}
```

**ソートの決定論ルール**:
1. `speed` 降順
2. 同値なら `position.y` 昇順
3. さらに同値なら `position.x` 昇順

**完了条件**:
- `tests/engine/InitiativeQueue.test.ts`（新規追加）に以下をテスト:
  - speed が異なる3体が正しい順序で返る
  - speed 同値の場合、y→x 昇順になる
  - `hasNext()` が空になったら false になる

---

### T09: `PushResolver` の実装 ✅

**ファイル**: `src/engine/PushResolver.ts`

**これが最も複雑なモジュール。慎重に実装すること。**

**実装内容**:

```typescript
interface PushResult {
  moved: Array<{ unitId: string; from: Position; to: Position }>
  destroyed: string[]
  events: BattleEvent[]
}

export class PushResolver {
  // unit を dir 方向へ1マス押す
  // 押し先にユニットがいれば、そのユニットも同じ dir で再帰的に押す（連鎖押し）
  // 盤外に出たユニットは destroyed に追加し board から削除する
  push(board: Board, unitId: string, dir: Direction, step: number): PushResult
}
```

**再帰ロジックの仕様**:
1. 押し先の座標を計算する（`pos + DIR_DELTA[dir]`）
2. 押し先が盤外 → そのユニットを撃破（`unit_destroy` イベント）
3. 押し先にユニットがいる → まずそのユニットを再帰的に push する（連鎖押し）
4. 押し先が空になったら、元のユニットを移動（`unit_push` イベント）

**重要**: ステップ3でまず先のユニットを動かしてから、元のユニットを動かす（スタックベースの解決）。

**完了条件**:
- `tests/engine/PushResolver.test.ts` に以下をテスト:
  - 空きマスへの押し出し → 1マス移動
  - ユニット A→B→空き の連鎖押し → A と B が1マス移動
  - ユニット A→B→盤外 の場合 → B が撃破、A が移動
  - ユニット A→盤外 の場合 → A が撃破

---

### T10: `TriggerProcessor` の実装 ✅

**ファイル**: `src/engine/TriggerProcessor.ts`

**実装内容**:

```typescript
interface TriggerQueueItem {
  unit: Unit
  triggerDef: TriggerDef
  context: { pushedBy?: string; dir?: Direction; sourcePos?: Position }
}

export class TriggerProcessor {
  private queue: TriggerQueueItem[]

  enqueue(item: TriggerQueueItem): void

  // キューが空になるまで全トリガーを処理
  // 各エフェクトで新たなイベントが発生したら、対応するトリガーを再度 enqueue
  // board を直接更新し、全発生イベントの配列を返す
  drainCascade(board: Board, pushResolver: PushResolver, step: number): BattleEvent[]

  // ヘルパー
  static findResponders(units: Unit[], eventKind: TriggerEventKind): Unit[]
}
```

**各エフェクトの実装仕様**:

| effectKind | 処理 |
|---|---|
| `push_target` | `context` にある対象ユニットを `dir` 方向へ push |
| `push_self` | 自ユニットを `dir` 方向へ push |
| `pull_nearest` | 自ユニットの最寄り敵を1マス引き寄せる（自ユニットに向かう方向へ push） |
| `explode` | `radius` 内の全ユニットを爆発中心から外向きに push |
| `swap_adjacent` | 隣の敵と自ユニットの座標を入れ替える |

**`drainCascade` のループ**:
```
while queue is not empty:
  item = queue.shift()
  if unit is no longer on board: skip
  events += executeEffect(item)
  // executeEffect 内で push が起きたら → on_push_other, on_pushed の enqueue
  // executeEffect 内で destroy が起きたら → on_destroy の enqueue
```

**完了条件**:
- `tests/engine/TriggerProcessor.test.ts` に以下をテスト:
  - `on_pushed` → `push_target` の1段階トリガーが動作する
  - 2段階の連鎖（A が B を押す → B の on_pushed 発火 → B が C を押す）
  - `on_destroy` → `explode` が発火する
  - 盤面を離れたユニットのトリガーはスキップされる

---

### T11: `VictoryChecker` の実装 ✅

**ファイル**: `src/engine/VictoryChecker.ts`

**実装内容**:

```typescript
export class VictoryChecker {
  // コアが盤面から消えていれば、そのサイドの負けを返す
  // 両コア消失は先に消えた方の負け（引き分けは起きにくいが、同時消失は draw）
  static checkCoreDestroyed(board: Board): { winner: Side | 'draw'; reason: WinReason } | null

  // ターン数上限到達時の最終判定
  // 判定順: 生存ユニット数 → コアHP → 合計残HP → draw
  static checkEndOfGame(board: Board): { winner: Side | 'draw'; reason: WinReason }
}
```

**完了条件**:
- `tests/engine/VictoryChecker.test.ts` に以下をテスト:
  - player コアのみ消失 → enemy の勝ち
  - 両コア消失 → draw
  - ユニット数判定が正しく動作する
  - HP 合計での判定が正しく動作する

---

### T12: `BattleEngine` のメインループ実装 ✅

**ファイル**: `src/engine/BattleEngine.ts`

**実装内容**:

```typescript
import type { BattleConfig, BattleResult } from '../types/battle'

const DEFAULT_CONFIG: BattleConfig = {
  maxTurns: 30,
  maxStepsPerTurn: 200,
}

export class BattleEngine {
  constructor(private config: BattleConfig = DEFAULT_CONFIG) {}

  // ★ run(board: Board) を採用（下の処理フロー設計判断に準拠）。
  run(board: Board): BattleResult
}
```

**`run()` の処理フロー**:

```
1. player と enemy の盤面を1つの Board にマージする
   - player ユニット: y = 0..height/2-1 に配置（下半分）
   - enemy ユニット: y = height/2..height-1 に配置（上半分）
   - あるいは、最初から1つの Board として受け取る設計でもよい
     → 設計判断: run(board: Board) を受け取る方がシンプル。呼び出し元が盤面を合成する。
   
   ★ run(board: Board) を採用する（呼び出し元が player/enemy の両ユニットを配置済みの Board を渡す）

2. InitiativeQueue を構築する

3. メインループ（turn <= maxTurns かつ battle 継続中）:
   a. turn_start イベントを記録
   b. InitiativeQueue から次のユニットを取得
   c. 盤面上に存在しなければスキップ
   d. executeMove() で移動実行
   e. 移動で発生したイベント（on_move, on_push_other, on_pushed 等）を TriggerProcessor に enqueue
   f. TriggerProcessor.drainCascade() でカスケード解決
   g. VictoryChecker.checkCoreDestroyed() でコア撃破チェック → 終了なら break
   h. stepCount が maxStepsPerTurn を超えたら警告してターン強制終了
   i. InitiativeQueue.hasNext() が false になったら turn++ して 2 へ戻る

4. maxTurns 到達または break → VictoryChecker.checkEndOfGame()

5. BattleResult を組み立てて return
```

**`executeMove()` の仕様**:
- `unit.type === 'core'` または move パターンが「不動」→ 何もしない
- `pusher`：`facing` 方向に1マス移動を試みる。移動先が盤外または別ユニットがいる場合は PushResolver で解決。
- 移動が発生したら `unit_move` イベントを記録し、`on_move` トリガーを enqueue。

**注意**: MVP 時点では pusher のみ移動する。他ユニットは不動（speed は行動順のみに使用）。

**完了条件**:
- `tests/engine/BattleEngine.test.ts` に以下をテスト:
  - 盤面に core のみを配置した場合、maxTurns で draw になる
  - player pusher が enemy core を直接押して盤外に出す → player 勝利
  - maxStepsPerTurn 超過時に無限ループせず終了する

---

### T13: `on_adjacent_enemy` トリガーのターン開始処理を追加 ✅

**ファイル**: `src/engine/BattleEngine.ts`（修正）

**目的**: `magnet` と `swapper` の `on_adjacent_enemy` は、そのユニットのターン開始時に隣に敵がいる場合に発火する。これはステップ 3b の後に追加する。

**追加処理（`executeMove` の前）**:
```typescript
// 行動ユニットの on_adjacent_enemy トリガーチェック
for (const trigger of actingUnit.triggers) {
  if (trigger.on === 'on_adjacent_enemy') {
    const adjEnemies = board.getAdjacentUnits(actingUnit.position)
      .filter(u => u.side !== actingUnit.side)
    if (adjEnemies.length > 0) {
      triggerProcessor.enqueue({ unit: actingUnit, triggerDef: trigger, context: {} })
    }
  }
}
```

**完了条件**:
- `tests/engine/BattleEngine.test.ts` に magnet が隣の敵を引き寄せるシナリオを追加してパス。

---

## デバッグ・検証ツール

### T14: `consolePrinter` の実装 ✅

**ファイル**: `src/debug/consolePrinter.ts`

**目的**: `BattleEvent[]` をコンソールに人間が読める形式で出力する。UIなしで連鎖ログを確認するためのツール。

**実装内容**:

```typescript
export function printBattleLog(events: BattleEvent[], result: BattleResult): void
export function printEvent(event: BattleEvent): string  // イベント1件を文字列化
export function printBoard(board: Board): void           // 盤面をグリッド表示
```

**`printBoard` の出力形式**（5x5 盤面の例）:
```
  0   1   2   3   4
0 [  ] [PC] [  ] [EC] [  ]
1 [  ] [  ] [PB] [  ] [  ]
2 [  ] [EP] [  ] [PR] [  ]
3 [  ] [  ] [  ] [  ] [  ]
4 [  ] [  ] [  ] [  ] [  ]

P=player, E=enemy, C=core, P=pusher, B=bomber, R=reactor
```

**`printEvent` の出力例**:
```
[step  1] TURN_START: unit p_pusher_0 (speed=5)
[step  2] UNIT_MOVE: p_pusher_0  (1,0)→(1,1)
[step  3] TRIGGER_FIRE: p_pusher_0  on_push_other → push_target
[step  4] UNIT_PUSH: e_reactor_0  (1,1)→(1,2)
[step  5] TRIGGER_FIRE: e_reactor_0  on_pushed → push_target
[step  6] UNIT_PUSH: e_bomber_0  (1,2)→(1,3)
[step  7] TRIGGER_FIRE: e_bomber_0  on_destroy → explode
[step  8] UNIT_DESTROY: e_core_0  pushed off board
[step 10] BATTLE_END: winner=player, reason=core_destroyed
```

**完了条件**: 出力が読みやすいこと（目視確認）。`tsc --noEmit` でエラーなし。

---

### T15: テストシナリオの定義と実行 ✅

**ファイル**: `src/debug/scenarios.ts`, `tests/scenarios/chainScenarios.test.ts`

**目的**: 手作業で盤面を定義し、連鎖が正しく動作することを確認するシナリオテスト。

**`src/debug/scenarios.ts`** に最低3つのシナリオを定義する:

```typescript
export interface Scenario {
  name: string
  description: string
  board: Board           // 初期盤面（両陣営のユニット配置済み）
  expectedWinner: Side | 'draw'
  expectedReason: WinReason
  minChainDepth?: number // 最小連鎖深度（連鎖が起きているか確認）
}
```

**シナリオ1: 「基本押し出し」**
- 5x3 の盤面
- player: pusher(facing=right, pos=(0,1)), core(pos=(0,2))
- enemy: core(pos=(4,1))
- pusher が core に向かって進み、直接押して盤外へ
- 期待: player 勝利、reason=core_destroyed

**シナリオ2: 「2段連鎖」**
- 6x3 の盤面
- player: pusher(facing=right, pos=(0,1)), core(pos=(0,2))
- enemy: reactor(pos=(2,1)), core(pos=(5,1))
- pusher が reactor を押す → reactor の on_pushed 発火 → core を押して盤外
- 期待: player 勝利、reason=core_destroyed、chainDepth >= 2

**シナリオ3: 「ボマー爆発連鎖」**
- 7x3 の盤面
- player: pusher(facing=right, pos=(0,1)), core(pos=(0,2))
- enemy: bomber(pos=(5,1)), core(pos=(6,0))
- pusher が bomber を右端から盤外へ押し出す → bomber の on_destroy で explode → 爆心(lastPos=(6,1))の上隣にいた core(6,0) が爆風で盤外撃破
- 期待: player 勝利、reason=core_destroyed
- 注: 当初の配置（bomber=(2,1), core=(3,1)）はコアが bomber の押し出し射線上にあり、連鎖押しでコアが先に盤外へ出て **bomber が撃破されず爆発が起きない**ことを実証で確認したため、コアを射線外 (6,0) に退避する配置へ修正した。

**`tests/scenarios/chainScenarios.test.ts`** でこれら3シナリオを実行・検証する。

**完了条件**: 3シナリオ全てが期待結果でパス。`consolePrinter.printBattleLog()` でログを出力して目視確認。

---

### T16: `src/main.ts` をデバッグ実行エントリに実装 ✅

**ファイル**: `src/main.ts`

**目的**: `npm run dev` で `scenarios.ts` を実行してコンソールにログを出力する。「ニヤッとするか」の手動検証用。

**実装内容**:
```typescript
import { scenarios } from './debug/scenarios'
import { printBattleLog, printBoard } from './debug/consolePrinter'
import { BattleEngine } from './engine/BattleEngine'

for (const scenario of scenarios) {
  console.log(`\n${'='.repeat(50)}`)
  console.log(`シナリオ: ${scenario.name}`)
  console.log(scenario.description)
  console.log('初期盤面:')
  printBoard(scenario.board)

  const engine = new BattleEngine()
  const result = engine.run(scenario.board.clone())

  printBattleLog(result.events, result)

  const pass = result.winner === scenario.expectedWinner
    && result.reason === scenario.expectedReason
  console.log(pass ? '✅ PASS' : '❌ FAIL')
}
```

**完了条件**: `npm run dev` でコンソールに3シナリオの連鎖ログが表示される。全シナリオ PASS。

---

## 道場相手（コールドスタート対策）

### T17: 道場相手の定義 ✅

**ファイル**: `src/dojo/opponents.ts`

**目的**: ゲーム内にプリセットされた対戦相手を5体定義する。段階的な難易度設計。

**実装内容**:

```typescript
export interface DojoOpponent {
  id: string
  name: string
  description: string   // 「〇〇型構築。〜〜が弱点」
  difficulty: 1 | 2 | 3 | 4 | 5
  buildBoard(): Board   // 対戦相手の盤面を生成するファクトリ
}

export const DOJO_OPPONENTS: DojoOpponent[] = [
  // Lv1: core + pusher x1 のみ。まっすぐ来るだけ。
  // Lv2: core + pusher x2（並列配置）
  // Lv3: core + pusher + reactor の連携
  // Lv4: core + bomber 配置。爆発範囲が脅威
  // Lv5: 全種を組み合わせた複合構成
]
```

各 `buildBoard()` は `createUnit()` で盤面を組み立てて `Board` を返す。

**完了条件**: `tsc --noEmit` でエラーなし。5体の `buildBoard()` が呼べる。

---

## フェーズ1 完了チェック

### T18: 最終統合テストと Go/No-Go 検証 ✅

**目的**: フェーズ1の完了基準を満たすか確認する。

**実行内容**:

1. `npm test` を実行してすべてのテストがパスすることを確認する。

2. `npm run dev` を実行して `main.ts` の3シナリオが全て PASS することを確認する。

3. コンソールに出力された連鎖ログを読んで、以下を目視確認する:
   - シナリオ2: `TRIGGER_FIRE: on_pushed` が出力されている
   - シナリオ3: `TRIGGER_FIRE: on_destroy` と `explode` が出力されている
   - 連鎖の流れがイベントログで追跡できる

4. **Go/No-Go 判定**:
   - 連鎖ログを読んで「プッシャーが押す → リアクターが伝播 → ボマーで爆発 → コア撃破」の流れが追えて、それを"ニヤッとできる"なら **Go**（フェーズ2: UI 実装へ）
   - 連鎖が起きない/ログが追えない/面白みを感じないなら **No-Go**（エンジン再設計）

**完了条件**:
- `npm test` 全テストパス
- `npm run dev` 全シナリオ PASS
- Go/No-Go の判断を下せる状態になっている

---

# フェーズ2：UI・共有コード（非同期対戦ループの成立）

> 前提：T18 で **Go** 判定済み。要件定義書 §14「2か月目」に対応。
> 設計詳細は `architecture.md` 末尾「フェーズ2 設計（UI・共有コード）」を参照。
> **エンジン層（types/data/engine）は不変。** 新規モジュール `src/share/`・`src/ui/` の追加で構成する。
> UI 系タスク（T20〜）は着手直前に必要なら詳細化する。T19 は test-spec が既にあるため先にフル実装する。

---

### T19: 共有コード codec（encode / decode） ✅

**ファイル**: `src/share/format.ts`, `src/share/encode.ts`, `src/share/decode.ts`

**目的**: 盤面 ⇄ 文字列の純粋・決定論的変換を実装する。サーバーレス非同期対戦の心臓部。

**前提**: なし（エンジン完成済み）。フェーズ2 の最初のタスク。

**依存追加**: `lz-string`（CLAUDE.md §6 で許可済みの唯一の実行時依存）を `dependencies` に追加してよい。

**実装内容**:
```typescript
// share/format.ts
export const SCHEMA_VERSION = 'v1'
// UnitType / Side / Direction の整数トークン化テーブル（双方向）

// share/encode.ts
export function encodeBoard(board: Board): string
//   形式: `${SCHEMA_VERSION}:${lz-string圧縮(URLセーフBase64)}`
//   ユニットは読み順(y昇順→x昇順)で安定ソートしてから直列化（同一盤面→同一コード）

// share/decode.ts
export function decodeBoard(code: string): Board   // 不正入力は throw（握り潰さない）
```

**決定論ルール（§5 準拠）**: `Math.random()`/時刻/反復順依存/async を使わない。中間表現はソート済みで一意。`lz-string` は `compressToEncodedURIComponent` / `decompressFromEncodedURIComponent` を使い `?b=` にそのまま載る。

**復元仕様**: ユニットは `data/unitTemplates.ts` の `createUnit()` で再生成し、座標・facing・side を適用（HP 等はテンプレ既定値に戻す＝共有するのは「型と配置」のみ）。

**検証（decode で例外）**: ① バージョン不一致 ② 盤外座標 ③ 未知 type ④ 座標重複 ⑤ コア0体 ⑥ 圧縮文字列破損。

**完了条件**:
- `tests/share/codec.test.ts` を作り、test-spec の **SUP-09〜12** を緑にする:
  - SUP-09: `decodeBoard(encodeBoard(board))` で size・全ユニットの type/side/座標/facing が一致
  - SUP-10: バージョン不一致コードで例外
  - SUP-11: 盤外座標を含むコードで例外
  - SUP-12: 未知 type / 座標重複 / コア不在 で各々例外
  - 追加: 同一盤面を2回 encode → 同一文字列（決定論）
- `npm test` 全緑かつ `npm run typecheck` エラーなし。

---

### T20: 盤面エディタ（BoardView + Editor）✅

**ファイル**: `src/ui/BoardView.ts`, `src/ui/Editor.ts`, `src/ui/App.ts`, `index.html`（描画領域追加）, `src/main.ts`（UIブートストラップへ差し替え）

**目的**: クリック/タップで6種ユニットを配置・撤去・向き変更できる盤面エディタ。スマホ対応（CSS Grid）。コスト上限を管理。

**前提**: T19（コード化のため）。

**完了条件**: ブラウザで盤面を編集でき、構築を `encodeBoard` でコード化できる。エンジンを import しない範囲で `BoardView` が `Board` を描画する。（UIのため目視確認 + 型チェック）

---

### T21: リプレイビューア（ReplayPlayer）✅

**ファイル**: `src/ui/ReplayPlayer.ts`, `src/ui/App.ts`（遷移追加）

**目的**: `BattleEngine.run()` が返す `BattleResult.events` を step 順に再生する。再生/一時停止/早送り/スキップ。「面白さを売る」画面。

**前提**: T20。

**完了条件**: 道場相手（T17）との対戦リプレイが再生され、連鎖が目で追える。タイマーは UI 層のみ。

---

### T22: 対戦セットアップ + 共有コード/URL 連携 ✅

**ファイル**: `src/ui/ShareCode.ts`, `src/engine/`（または `src/ui/`）に `setupBattle(myBoard, oppBoard): Board` 相当, `src/ui/App.ts`

**目的**: 相手コードを反転（上下ミラー＋ side 反転）して自盤と合成し対戦実行。コードのコピー/読込、`?b=<code>` URL の生成と起動時パース。

**前提**: T19, T21。

**完了条件**: 相手の共有コード（または `?b=` URL）を読み込んで対戦 → リプレイ表示まで通る。

---

### T23: 道場UI + 最小チュートリアル ✅

**ファイル**: `src/ui/App.ts`（道場選択UI）, 必要なら `src/ui/Tutorial.ts`

**目的**: 道場相手5体（T17 定義済み）を選んで対戦できるUI。最初の連鎖を体験させる最小チュートリアル。コールドスタート対策。

**前提**: T17, T22。

**完了条件**: 対戦相手ゼロでも道場で遊べる。初回に最小の連鎖体験を提示できる。

---

# フェーズ3：仕上げ・公開

> 要件定義書 §14「3か月目」に対応。フェーズ2 の非同期ループ成立後に着手。

---

### T24: バランス調整 ✅

**目的**: 決定論ゆえの全数テストに近い検証で、支配的コンボ（壊れ）を是正。ユニットの speed/HP/cost を調整（CLAUDE.md §8「T7.2 まで据え置き」の凍結を解除するのはここ）。

**前提**: フェーズ2 完了。**完了条件**: 道場相手・代表構築での偏りが許容範囲。回帰テスト緑。

**実装**:
- `src/balance/`（出荷ランタイム外の解析ツール。architecture.md フェーズ3 章参照）:
  - `builds.ts`: 代表構築（攻撃/伝播/爆発/制御/防御/安価スパムの archetype）。
  - `harness.ts`: 投入可能（コスト上限12以内）構築の決定論総当たり → 勝率/引分/連鎖/コストを集計、最安支配（壊れ）検出、上限超過の除外。`ui/setupBattle` を再利用。
  - `run.ts`: `npm run balance` でレポート出力。
- 調整（`src/data/unitTemplates.ts`）: `pusher` cost 2→3、`reactor` cost 1→2。MVP の撃破は盤外押し出しのみで HP/不動 speed は勝敗にほぼ無影響のため cost に集約（§216-218「便利な接続をコスト化」）。
- 検証結果: 最安支配コンボ（旧 relay cost3=93%）を解消。コスト上限が発効し過剰スタック（reactor_swarm/combo_aggro）は投入不可に。引き分け量産なし（7%）。
- 回帰ガード: `tests/balance/balance.test.ts`（T24-01〜08）。

---

### T25: 結果シェア（Wordle方式）+ 演出ジュース

**ファイル**: `src/ui/ResultShare.ts`, リプレイ演出の強化。

**目的**: 勝敗・最大連鎖数・決め手を短文＋絵文字グリッドに整形（ネタバレ抑制）。連鎖時の音・シェイク・コンボ表示。

**前提**: T21, T24。**完了条件**: 結果テキストがコピーでき、SNSに貼れる長さ。

---

### T26: GitHub Pages デプロイ

**目的**: `vite build` → `dist/` を GitHub Pages へ。遊び方ページ、作例コードと共に公開。

**前提**: 全フェーズ2タスク。**完了条件**: 公開URLで誰でもログイン不要・インストール不要で遊べる。`?b=` 共有が動作。

---

## タスク依存関係まとめ

```
T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08
                                              ↓
                                      T09 (PushResolver)
                                              ↓
                                      T10 (TriggerProcessor)
                                              ↓
                                      T11 (VictoryChecker)
                                              ↓
                                      T12 (BattleEngine メインループ)
                                              ↓
                                      T13 (on_adjacent_enemy 追加)
                                              ↓
                               T14 (consolePrinter) ← T12 と並行可
                                              ↓
                                      T15 (シナリオテスト)
                                              ↓
                               T16 (main.ts デバッグエントリ)
                                              ↓
                               T17 (道場相手) ← T16 と並行可
                                              ↓
                                      T18 (最終統合 / Go-No-Go)
```

T14 は T12 完了後、T15 と並行して実装可能。
T17 は T16 完了後、T18 の前なら順不同で実装可能。

### フェーズ2・3

```
T18 (Go) → T19 (codec) → T20 (エディタ) → T21 (リプレイ) → T22 (対戦/共有/URL)
                                                                      ↓
                                                              T23 (道場UI/チュートリアル)
                                                                      ↓
                                      T24 (バランス) → T25 (結果シェア/演出) → T26 (デプロイ)
```

T19 は test-spec（SUP-09〜12）が既にあるため最初に TDD 実装する。
T20〜T23 は UI のため目視確認中心。各タスクは着手直前に必要なら詳細化する。
