import type { Unit, UnitType, Side, TriggerDef } from '../types/unit'
import type { Position } from '../types/board'
import type { Direction } from '../types/direction'

const BASE_STATS: Record<UnitType, Pick<Unit, 'hp' | 'maxHp' | 'speed' | 'cost' | 'triggers'>> = {
  pusher: {
    hp: 3, maxHp: 3, speed: 5, cost: 2,
    triggers: [{ on: 'on_push_other', effect: { kind: 'push_target', dir: 'facing' } }],
  },
  reactor: {
    hp: 2, maxHp: 2, speed: 3, cost: 1,
    triggers: [{ on: 'on_pushed', effect: { kind: 'push_target', dir: 'away_from_self' } }],
  },
  bomber: {
    hp: 2, maxHp: 2, speed: 2, cost: 3,
    triggers: [{ on: 'on_destroy', effect: { kind: 'explode', radius: 1 } }],
  },
  magnet: {
    hp: 2, maxHp: 2, speed: 4, cost: 2,
    triggers: [{ on: 'on_adjacent_enemy', effect: { kind: 'pull_nearest' } }],
  },
  swapper: {
    hp: 2, maxHp: 2, speed: 4, cost: 2,
    triggers: [{ on: 'on_adjacent_enemy', effect: { kind: 'swap_adjacent' } }],
  },
  core: {
    hp: 5, maxHp: 5, speed: 0, cost: 0,
    triggers: [],
  },
}

// Module-level counter for auto-generating ID suffixes when none is provided.
// Engine code should always pass an explicit idSuffix to ensure determinism.
let _autoId = 0

export function resetAutoId(): void {
  _autoId = 0
}

export function createUnit(
  type: UnitType,
  side: Side,
  position: Position,
  facing: Direction = 'right',
  idSuffix?: string,
): Unit {
  const suffix = idSuffix ?? String(_autoId++)
  const id = `${side[0]}_${type}_${suffix}`
  const stats = BASE_STATS[type]
  const triggers: TriggerDef[] = stats.triggers.map(t => ({
    on: t.on,
    effect: { ...t.effect },
  }))
  return { id, type, hp: stats.hp, maxHp: stats.maxHp, speed: stats.speed, cost: stats.cost, triggers, facing, position, side }
}
