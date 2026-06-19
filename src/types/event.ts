import type { Direction } from './direction'
import type { Position, TriggerEventKind, TriggerEffectKind } from './unit'

export type EventKind =
  | 'unit_move'
  | 'unit_push'
  | 'unit_destroy'
  | 'trigger_fire'
  | 'cascade_start'
  | 'cascade_end'
  | 'turn_start'
  | 'battle_end'

export interface BattleEvent {
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
