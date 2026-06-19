import type { Direction } from './direction'

// Position is logically owned by board.ts, but Unit needs it here before T05 is implemented.
// board.ts will import Position from this file once T05 is done.
export interface Position { x: number; y: number }

export type UnitType = 'pusher' | 'reactor' | 'bomber' | 'magnet' | 'swapper' | 'core'

export type Side = 'player' | 'enemy'

export type TriggerEventKind =
  | 'on_enter'
  | 'on_move'
  | 'on_push_other'
  | 'on_pushed'
  | 'on_destroy'
  | 'on_adjacent_enemy'

export type TriggerEffectKind =
  | 'push_target'
  | 'push_self'
  | 'pull_nearest'
  | 'explode'
  | 'swap_adjacent'

export interface TriggerEffect {
  kind: TriggerEffectKind
  dir?: Direction | 'facing' | 'away_from_self'
  radius?: number
  damage?: number
}

export interface TriggerDef {
  on: TriggerEventKind
  effect: TriggerEffect
}

export interface Unit {
  id: string
  type: UnitType
  hp: number
  maxHp: number
  speed: number
  facing: Direction
  position: Position
  side: Side
  triggers: TriggerDef[]
  cost: number
}
