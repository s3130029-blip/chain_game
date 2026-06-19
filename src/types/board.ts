import type { Unit } from './unit'

// Position is defined in unit.ts (both Unit and BoardState need it).
// Re-exporting here so consumers can import from board.ts per architecture intent.
export type { Position } from './unit'

export interface BoardState {
  width: number
  height: number
  units: Map<string, Unit>
  turn: number
  stepCount: number
  phase: 'battle' | 'ended'
}
