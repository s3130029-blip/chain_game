import type { Unit, UnitType, Side, TriggerDef } from '../types/unit'
import type { Position } from '../types/board'
import type { Direction } from '../types/direction'

// バランス調整（tasks.md T24 / 要件定義書 §216-218）。
// MVP の戦闘では撃破は「盤外押し出し」のみ（HP ダメージ効果は未実装）で、HP は同点時の
// タイブレーク（core_hp / total_hp）にしか効かず、不動ユニットの speed もほぼ不活性。
// よって勝敗を動かす実質的なレバーは cost（コスト上限による枠制限）であり、調整は cost に絞る。
// 決定論ゆえの総当たり検証（src/balance）で「安価かつ支配的なコンボ（壊れ）」を検出し、
// §217「その接続を弱める/コスト化する」に従って下記を是正した:
//   - pusher: 2→3  唯一の自走＝勝利条件の運搬役。単体で支配的（§216「1体で完結する強ユニットを避ける」）。
//   - reactor: 1→2 最安(1)で最強の relay コンボとスパムを成立させる「便利すぎる接続」をコスト化。
// HP/speed は検証上ほぼ無影響のため据え置く（早期の無意味な変更を避ける）。
const BASE_STATS: Record<UnitType, Pick<Unit, 'hp' | 'maxHp' | 'speed' | 'cost' | 'triggers'>> = {
  pusher: {
    hp: 3, maxHp: 3, speed: 5, cost: 3,
    triggers: [{ on: 'on_push_other', effect: { kind: 'push_target', dir: 'facing' } }],
  },
  reactor: {
    hp: 2, maxHp: 2, speed: 3, cost: 2,
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
