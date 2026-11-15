import {
  AvatarAnchorPointType,
  AvatarAttach,
  engine,
  Entity,
  GltfContainer,
  GltfNodeModifiers,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { cosmeticById, DEFAULT_LOOK, gunOf } from '../shared/rules'
import { getMyAddress } from './state'
import { game } from './store'

// ---------------------------------------------------------------------------
// What everyone in the arena can see of each player: the gun in their right hand
// in their gun paint, and their level and title above their name. Status, never
// power (GDD §4.2). Drawn for every player the server lists, this one included.
// ---------------------------------------------------------------------------

type Look = {
  hand: Entity
  gun: Entity
  tag: Entity
  text: Entity
  model: string
  paint: string
  label: string
}

const looks = new Map<string, Look>()

export function setupPlayers() {
  engine.addSystem(updatePlayers)
}

/** The colour a gun-paint cosmetic paints the gun's 'Paint' node */
export function paintModifiers(paintId: string) {
  const c = (cosmeticById(paintId) ?? cosmeticById(DEFAULT_LOOK.paint))!.colour
  const gold = paintId === 'paint:gold'
  return {
    modifiers: [
      {
        path: 'Paint',
        material: {
          material: {
            $case: 'pbr' as const,
            pbr: {
              albedoColor: Color4.create(c[0], c[1], c[2], 1),
              metallic: gold ? 0.8 : 0.1,
              roughness: gold ? 0.3 : 0.5
            }
          }
        }
      }
    ]
  }
}

function create(address: string, mine: boolean): Look {
  const hand = engine.addEntity()
  Transform.create(hand)
  AvatarAttach.create(hand, { avatarId: mine ? undefined : address, anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  const gun = engine.addEntity()
  Transform.create(gun, { parent: hand, rotation: Quaternion.fromEulerDegrees(185, 90, 90) })

  const tag = engine.addEntity()
  Transform.create(tag)
  AvatarAttach.create(tag, { avatarId: mine ? undefined : address, anchorPointId: AvatarAnchorPointType.AAPT_NAME_TAG })
  const text = engine.addEntity()
  Transform.create(text, { parent: tag, position: Vector3.create(0, 0.32, 0) })
  TextShape.create(text, {
    text: '',
    fontSize: 1.6,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textColor: Color4.create(0.118, 0.204, 0.259, 1),
    outlineWidth: 0.25,
    outlineColor: Color4.White()
  })
  return { hand, gun, tag, text, model: '', paint: '', label: '' }
}

function remove(look: Look) {
  for (const e of [look.gun, look.hand, look.text, look.tag]) engine.removeEntity(e)
}

function updatePlayers() {
  const me = getMyAddress()
  const seen = new Set<string>()
  for (const s of game.scores) {
    seen.add(s.address)
    const mine = s.address === me
    let look = looks.get(s.address)
    if (!look) {
      look = create(s.address, mine)
      looks.set(s.address, look)
    }
    // My own gun follows my own state straight away (a purchase shows before the scores come round)
    const gunId = mine && game.heardMe ? game.me.gun : s.gun ?? 'pistol'
    const paint = mine && game.heardMe ? game.me.paint : s.paint ?? DEFAULT_LOOK.paint
    const gun = gunOf(gunId)
    if (look.model !== gun.model) {
      look.model = gun.model
      GltfContainer.createOrReplace(look.gun, { src: gun.model, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
      look.paint = '' // the new model needs its paint again
      const t = Transform.getMutable(look.gun)
      t.position = Vector3.create(gun.hold.x, gun.hold.y, gun.hold.z)
      t.scale = Vector3.create(gun.hold.scale, gun.hold.scale, gun.hold.scale)
    }
    if (look.paint !== paint) {
      look.paint = paint
      GltfNodeModifiers.createOrReplace(look.gun, paintModifiers(paint))
    }
    const level = mine && game.heardMe ? game.me.level : s.level ?? 1
    const titleId = mine && game.heardMe ? game.me.title : s.title ?? DEFAULT_LOOK.title
    const title = titleId && titleId !== 'title:none' ? cosmeticById(titleId)?.name ?? '' : ''
    const label = 'LV ' + level + (title ? '  ' + title : '')
    if (look.label !== label) {
      look.label = label
      TextShape.getMutable(look.text).text = label
    }
  }
  for (const [address, look] of looks) {
    if (!seen.has(address)) {
      remove(look)
      looks.delete(address)
    }
  }
}
