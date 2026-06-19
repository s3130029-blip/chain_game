import type { BattleEvent } from '../types/event'
import type { BattleResult } from '../types/battle'
import type { Unit, UnitType, Side } from '../types/unit'
import type { Position } from '../types/board'
import type { Board } from '../engine/Board'

/**
 * UIなしで連鎖ログ・盤面を目視確認するためのコンソール整形ツール（tasks.md T14）。
 * エンジンの決定論には関与しない純粋な表示層。Board は読み取りのみで参照する。
 */

const SIDE_LETTER: Record<Side, string> = { player: 'P', enemy: 'E' }

const TYPE_LETTER: Record<UnitType, string> = {
  core: 'C',
  pusher: 'P',
  bomber: 'B',
  reactor: 'R',
  magnet: 'M',
  swapper: 'S',
}

function fmtPos(pos: Position | undefined): string {
  return pos === undefined ? '(?,?)' : `(${pos.x},${pos.y})`
}

/** `[step  1]` のように step を幅2で右寄せした接頭辞。1桁/2桁で桁が揃う。 */
function stepPrefix(step: number): string {
  return `[step ${String(step).padStart(2, ' ')}]`
}

/** イベント種別ごとの本文。未規定フィールドは '?' でフォールバックして決して throw しない。 */
function eventBody(event: BattleEvent): string {
  const id = event.unitId ?? '?'
  switch (event.kind) {
    case 'turn_start': {
      const speed = event.metadata?.['speed']
      return `unit ${id} (speed=${speed ?? '?'})`
    }
    case 'unit_move':
    case 'unit_push':
      return `${id}  ${fmtPos(event.from)}→${fmtPos(event.to)}`
    case 'unit_destroy': {
      // 現エンジンの撃破は全て盤外押し出し（PushResolver: cause 'offBoard'）。
      const cause = event.metadata?.['cause']
      const how = cause === 'offBoard' ? 'pushed off board' : 'destroyed'
      return `${id}  ${how}`
    }
    case 'trigger_fire':
      return `${id}  ${event.triggerKind ?? '?'} → ${event.effectKind ?? '?'}`
    case 'cascade_start':
      return 'cascade begins'
    case 'cascade_end':
      return 'cascade settled'
    case 'battle_end': {
      const winner = event.metadata?.['winner']
      const reason = event.metadata?.['reason']
      return `winner=${winner ?? '?'}, reason=${reason ?? '?'}`
    }
    default: {
      // EventKind の網羅を never で検証する（CLAUDE.md §6）。
      const _exhaustive: never = event.kind
      return _exhaustive
    }
  }
}

/** イベント1件を1行の人間可読文字列に整形する（出力例は tasks.md T14 参照）。 */
export function printEvent(event: BattleEvent): string {
  return `${stepPrefix(event.step)} ${event.kind.toUpperCase()}: ${eventBody(event)}`
}

/** 戦闘ログ全体と結果サマリをコンソールへ出力する。 */
export function printBattleLog(events: BattleEvent[], result: BattleResult): void {
  console.log('--- Battle Log ---')
  for (const event of events) {
    console.log(printEvent(event))
  }
  console.log('------------------')
  console.log(
    `Result: winner=${result.winner}, reason=${result.reason}, ` +
      `turns=${result.totalTurns}, maxChainDepth=${result.maxChainDepth}`,
  )
}

const CELL_WIDTH = 4 // "[XY]" の文字数

function cellFor(unit: Unit | undefined): string {
  if (unit === undefined) return '[  ]'
  return `[${SIDE_LETTER[unit.side]}${TYPE_LETTER[unit.type]}]`
}

/** 列番号をセル幅(4)の中で中央寄せし、`[XY]` の真上に揃える。 */
function centerInCell(label: string): string {
  const pad = CELL_WIDTH - label.length
  const left = Math.max(Math.floor(pad / 2), 0)
  const right = Math.max(pad - left, 0)
  return ' '.repeat(left) + label + ' '.repeat(right)
}

/** 盤面をグリッド表示する。行ラベルとセルは同じ stride(5) で縦に揃う。 */
export function printBoard(board: Board): void {
  const labelWidth = String(board.height - 1).length
  const gutter = ' '.repeat(labelWidth + 1)

  const header =
    gutter +
    Array.from({ length: board.width }, (_, x) => centerInCell(String(x))).join(' ')

  const lines: string[] = [header]
  for (let y = 0; y < board.height; y++) {
    const rowLabel = String(y).padStart(labelWidth, ' ')
    const cells = Array.from({ length: board.width }, (_, x) =>
      cellFor(board.getUnitAt({ x, y })),
    )
    lines.push(`${rowLabel} ${cells.join(' ')}`)
  }

  lines.push('')
  lines.push('P=player, E=enemy | C=core, P=pusher, B=bomber, R=reactor, M=magnet, S=swapper')
  console.log(lines.join('\n'))
}
