import {
  engine,
  InputAction,
  inputSystem,
  PointerEventType,
  Transform,
  Entity,
  CameraModeArea,
  CameraType,
  PointerLock,
  raycastSystem,
  RaycastQueryType,
  PrimaryPointerInfo,
  MeshRenderer,
  Material
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { room } from '../shared/messages'
import { cosmeticById, DEFAULT_LOOK, gunOf, MAX_ACTIVE_PERKS, pelletDirections } from '../shared/rules'
import { pushToast } from './state'
import { activePerks, game, roundIsPlaying } from './store'

// ---------------------------------------------------------------------------
// Hold, aim, release (Joel's controls). Holding switches to a first-person aim
// view; letting go fires. The client draws the tracers straight away and sends
// the ray to the Multiplayer Server, which decides what was hit with the gun
// the player bought (pistol, shotgun or sniper).
//
// Perks fire with the 1, 2, 3 keys (or the buttons in the perk tray / the big
// perk button on a phone). A press that lands on a HUD button never fires a shot.
// ---------------------------------------------------------------------------

const SHOT_LINE_TIME = 0.4
const FIRE_KEYS: [InputAction, number][] = [
  [InputAction.IA_ACTION_3, 0],
  [InputAction.IA_ACTION_4, 1],
  [InputAction.IA_ACTION_5, 2]
]

let pointerState: boolean | undefined
let aiming = false
let uiPressedAt = 0
let lastShotLocal = 0

/** The HUD calls this from every button's onMouseDown, so that press doesn't also fire the gun */
export function noteUiPress() {
  uiPressedAt = Date.now()
}

export function setupShooting() {
  engine.addSystem(() => {
    // Pressed anywhere on screen during a round: lock the pointer and switch to the aim view
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
      if (roundIsPlaying() && Date.now() - uiPressedAt > 150) {
        aiming = true
        pointerState = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked
        PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: true })
        createFirstPersonZoneAtPlayer()
      }
    }

    // Released: restore the pointer and fire
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
      if (aiming) {
        aiming = false
        if (pointerState != undefined) PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: pointerState })
        removeFirstPersonZone()
        if (Date.now() - uiPressedAt > 150) shoot()
      }
    }

    // Perk keys
    for (const [action, index] of FIRE_KEYS) {
      if (inputSystem.isTriggered(action, PointerEventType.PET_DOWN)) firePerk(index)
    }
  })

  engine.addSystem(updateShotLines)
  engine.addSystem(followPlayerWithAimZone)
}

/** Fire the perk in this slot of the tray, if the arena has room for it */
export function firePerk(index: number) {
  const id = game.me.perks[index]
  if (!id || !roundIsPlaying()) return
  const running = activePerks()
  if (running.length >= MAX_ACTIVE_PERKS) {
    pushToast('3 perks are already running', [0.7, 0.15, 0.12], 1.6)
    return
  }
  if (running.some((p) => p.id === id)) {
    pushToast('That perk is already running', [0.7, 0.15, 0.12], 1.6)
    return
  }
  void room.send('fire', { perk: id })
}

/** Whether a perk in the tray can be fired right now (for greying out its button) */
export function perkReady(index: number): boolean {
  const id = game.me.perks[index]
  if (!id || !roundIsPlaying()) return false
  const running = activePerks()
  return running.length < MAX_ACTIVE_PERKS && !running.some((p) => p.id === id)
}

// ---------------------------------------------------------------------------
// First-person aim view while the button is held
// ---------------------------------------------------------------------------
let activeCameraArea: Entity | null = null

function followPlayerWithAimZone() {
  if (!activeCameraArea) return
  if (!Transform.has(engine.PlayerEntity)) return
  const playerTransform = Transform.get(engine.PlayerEntity)
  Transform.getMutable(activeCameraArea).position = Vector3.clone(playerTransform.position)
}

export function createFirstPersonZoneAtPlayer(): Entity | null {
  if (activeCameraArea) removeFirstPersonZone()
  if (!Transform.has(engine.PlayerEntity)) return null
  const currentPos = Transform.get(engine.PlayerEntity).position
  activeCameraArea = engine.addEntity()
  Transform.create(activeCameraArea, { position: Vector3.clone(currentPos) })
  CameraModeArea.create(activeCameraArea, {
    area: Vector3.create(6, 4, 6),
    mode: CameraType.CT_FIRST_PERSON
  })
  return activeCameraArea
}

export function removeFirstPersonZone() {
  if (activeCameraArea) {
    engine.removeEntity(activeCameraArea)
    activeCameraArea = null
  }
}

// ---------------------------------------------------------------------------
// Shot tracers, in the player's tracer colour
// ---------------------------------------------------------------------------
type ShotLine = { entity: Entity; life: number; colour: [number, number, number] }
const shotLines: ShotLine[] = []

function createLine(start: Vector3, end: Vector3, thickness: number = 0.04): Entity {
  const lineEntity = engine.addEntity()
  const position = Vector3.scale(Vector3.add(start, end), 0.5)
  const length = Vector3.distance(start, end)
  const direction = Vector3.normalize(Vector3.subtract(end, start))
  Transform.create(lineEntity, {
    position,
    rotation: Quaternion.lookRotation(direction),
    scale: Vector3.create(thickness, thickness, length)
  })
  MeshRenderer.setBox(lineEntity)
  return lineEntity
}

function updateShotLines(dt: number) {
  for (let i = shotLines.length - 1; i >= 0; i--) {
    const line = shotLines[i]
    line.life -= dt
    if (line.life <= 0) {
      engine.removeEntity(line.entity)
      shotLines.splice(i, 1)
      continue
    }
    const [r, g, b] = line.colour
    Material.setPbrMaterial(line.entity, {
      albedoColor: Color4.create(r, g, b, line.life / SHOT_LINE_TIME),
      emissiveColor: Color4.create(r, g, b, 1),
      emissiveIntensity: 1.0,
      roughness: 0.9,
      castShadows: false
    })
  }
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------
function shoot() {
  const pointerInfo = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const camera = Transform.getOrNull(engine.CameraEntity)
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!pointerInfo?.worldRayDirection || !camera || !player) return

  const gun = gunOf(game.me.gun)
  const now = Date.now()
  if (now - lastShotLocal < gun.cooldown * 1000) return // still reloading
  lastShotLocal = now

  const aim = Vector3.normalize(
    Vector3.create(pointerInfo.worldRayDirection.x, pointerInfo.worldRayDirection.y, pointerInfo.worldRayDirection.z)
  )
  const origin = Vector3.clone(camera.position)

  // The server judges the hit (it spreads the shotgun's pellets the same way)
  if (roundIsPlaying()) {
    void room.send('shoot', { ox: origin.x, oy: origin.y, oz: origin.z, dx: aim.x, dy: aim.y, dz: aim.z })
  }

  const colour = (cosmeticById(game.me.trace) ?? cosmeticById(DEFAULT_LOOK.trace))!.colour
  const side = Vector3.scale(Vector3.rotate(Vector3.Right(), camera.rotation), 0.2)
  const start = Vector3.add(Vector3.add(player.position, Vector3.create(0, 1.5, 0)), side)
  const thickness = gun.id === 'sniper' ? 0.06 : gun.id === 'shotgun' ? 0.03 : 0.04

  // Draw a tracer for each pellet, to whatever scenery it reaches
  for (const dir of pelletDirections(aim, gun)) {
    const rayEntity = engine.addEntity()
    Transform.create(rayEntity, { position: origin })
    raycastSystem.registerGlobalDirectionRaycast(
      {
        entity: rayEntity,
        opts: {
          queryType: RaycastQueryType.RQT_HIT_FIRST,
          direction: dir,
          maxDistance: gun.range,
          continuous: false
        }
      },
      (result) => {
        const hit = result.hits[0]
        const end = hit?.position ? hit.position : Vector3.add(origin, Vector3.scale(dir, gun.range))
        shotLines.push({ entity: createLine(start, end, thickness), life: SHOT_LINE_TIME, colour })
        engine.removeEntity(rayEntity)
      }
    )
  }
}

/** Seconds until the gun can fire again (for the HUD) */
export function reloadLeft(): number {
  const gun = gunOf(game.me.gun)
  return Math.max(0, gun.cooldown - (Date.now() - lastShotLocal) / 1000)
}
