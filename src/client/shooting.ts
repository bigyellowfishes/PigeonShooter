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
  GltfContainer,
  AvatarAttach,
  AvatarAnchorPointType,
  MeshRenderer,
  Material
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { MAX_SHOT_DISTANCE } from '../shared/config'
import { room } from '../shared/messages'
import { RoundPhase, RoundState } from '../shared/schemas'

// ---------------------------------------------------------------------------
// Hold, aim, release (Joel's controls). Holding switches to a first-person aim
// view; letting go fires. The client draws the tracer straight away and sends
// the ray to the Multiplayer Server, which decides what was hit.
// ---------------------------------------------------------------------------

const GUN_MODEL = 'assets/Models/Pistol/PS_Pistol.glb' // GDD: everyone starts each round with the pistol
const SHOT_LINE_TIME = 0.4

let pointerState: boolean | undefined

export function setupShooting() {
  setUpPlayerVisuals()

  engine.addSystem(() => {
    // Pressed anywhere on screen: lock the pointer and switch to the aim view
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
      pointerState = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked
      PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: true })
      createFirstPersonZoneAtPlayer()
    }

    // Released: restore the pointer and fire
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
      if (pointerState != undefined) PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: pointerState })
      removeFirstPersonZone()
      shoot()
    }
  })

  engine.addSystem(updateShotLines)
  engine.addSystem(followPlayerWithAimZone)
}

// ---------------------------------------------------------------------------
// Gun in the player's hand
// ---------------------------------------------------------------------------
function setUpPlayerVisuals() {
  const handAnchor = engine.addEntity()
  Transform.create(handAnchor)
  AvatarAttach.create(handAnchor, {
    anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND
  })

  const heldItem = engine.addEntity()
  GltfContainer.create(heldItem, {
    src: GUN_MODEL,
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  Transform.create(heldItem, {
    parent: handAnchor,
    position: Vector3.create(0.05, 0.1, -0.05), // grip sits in the palm
    rotation: Quaternion.fromEulerDegrees(185, 90, 90),
    scale: Vector3.create(1.2, 1.2, 1.2)
  })
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
// Shot tracer
// ---------------------------------------------------------------------------
type ShotLine = { entity: Entity; life: number }
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
    Material.setPbrMaterial(line.entity, {
      albedoColor: Color4.create(1, 1, 0.2, line.life / SHOT_LINE_TIME),
      emissiveColor: Color4.create(1, 1, 0.2, 1),
      emissiveIntensity: 1.0,
      roughness: 0.9,
      castShadows: false
    })
  }
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------
function roundIsPlaying(): boolean {
  for (const [, r] of engine.getEntitiesWith(RoundState)) return r.phase === RoundPhase.Playing
  return false
}

function shoot() {
  const pointerInfo = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const camera = Transform.getOrNull(engine.CameraEntity)
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!pointerInfo?.worldRayDirection || !camera || !player) return

  const dir = Vector3.normalize(
    Vector3.create(pointerInfo.worldRayDirection.x, pointerInfo.worldRayDirection.y, pointerInfo.worldRayDirection.z)
  )
  const origin = Vector3.clone(camera.position)

  // The server judges the hit
  if (roundIsPlaying()) {
    void room.send('shoot', { ox: origin.x, oy: origin.y, oz: origin.z, dx: dir.x, dy: dir.y, dz: dir.z })
  }

  // Draw the tracer from the gun to whatever scenery the shot reaches
  const rayEntity = engine.addEntity()
  Transform.create(rayEntity, { position: origin })
  raycastSystem.registerGlobalDirectionRaycast(
    {
      entity: rayEntity,
      opts: {
        queryType: RaycastQueryType.RQT_HIT_FIRST,
        direction: dir,
        maxDistance: MAX_SHOT_DISTANCE,
        continuous: false
      }
    },
    (result) => {
      const hit = result.hits[0]
      const side = Vector3.scale(Vector3.rotate(Vector3.Right(), camera.rotation), 0.2)
      const start = Vector3.add(Vector3.add(player.position, Vector3.create(0, 1.5, 0)), side)
      const end = hit?.position ? hit.position : Vector3.add(origin, Vector3.scale(dir, MAX_SHOT_DISTANCE))
      shotLines.push({ entity: createLine(start, end), life: SHOT_LINE_TIME })
      engine.removeEntity(rayEntity)
    }
  )
}
