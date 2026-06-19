import type { Side } from './unit'
import type { BattleEvent } from './event'

export type WinReason =
  | 'core_destroyed'
  | 'unit_count'
  | 'core_hp'
  | 'total_hp'
  | 'timeout'

export interface BattleResult {
  winner: Side | 'draw'
  reason: WinReason
  totalTurns: number
  maxChainDepth: number
  events: BattleEvent[]
}

export interface BattleConfig {
  maxTurns: number
  maxStepsPerTurn: number
}
