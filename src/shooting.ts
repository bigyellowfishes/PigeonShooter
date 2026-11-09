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
import { ResetTarget, targets } from './targets'

//
let pointerState: boolean | undefined

// --------------------------------------------------------------
// Set Up Script For Shooting, Called in index
// --------------------------------------------------------------
export function SetUpShooting() {
    // Give Player Gun Visuals
    SetUpPlayerVisuals()

    // Create a system that runs every frame
    engine.addSystem(() => {

        // Check if the left mouse button was pressed down anywhere on screen
        if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
            pointerState = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked
            PointerLock.createOrReplace(engine.CameraEntity, {isPointerLocked: true})
            createFirstPersonZoneAtPlayer()
            // Would be lovely if this works, but it pulls the player out of FPS
            //triggerSceneEmote({ src: 'assets/Models/ShootingAnimation_emote/ShootingAnimation_emote.glb', loop: false, })
        }

        // Check if the left mouse button was released anywhere on screen
        if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
            if(pointerState != undefined) PointerLock.createOrReplace(engine.CameraEntity, {isPointerLocked: pointerState});
            removeFirstPersonZone()
            Shoot()
        }
    })
}

// Player Visuals
function SetUpPlayerVisuals() {
  // Create an invisible parent entity anchored to the player's right hand
  const handAnchor = engine.addEntity()
  Transform.create(handAnchor)
  AvatarAttach.create(handAnchor, {
    anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND,
    // Omit avatarId to attach to the local player, or pass a specific user's Ethereum address/ID
  })

  // 2. Create the GLB entity as a child of the anchor so you can offset its grip/rotation
  const heldItem = engine.addEntity()
  GltfContainer.create(heldItem, {
    src: 'assets/Models/Shotty/Shotty.glb',
  })

  Transform.create(heldItem, {
    parent: handAnchor,
    position: Vector3.create(0.05, 0.33, -0.1), // Adjust offset to fit the palm
    rotation: Quaternion.fromEulerDegrees(185, 90, 90), // Adjust angle
    scale: Vector3.create(1.2, 1.2, 1.2),
  })
}


// --------------------------------------------------------------
// Handle Player Camera
// --------------------------------------------------------------

// Keep track of the active zone entity globally in your script file
let activeCameraArea: Entity | null = null

// Create a system that runs every frame to make the box follow the player
engine.addSystem((dt) => {
    // If the zone isn't active or the player doesn't have a transform yet, do nothing
    if (!activeCameraArea) return
    if (!Transform.has(engine.PlayerEntity)) return
    
    // Get the player's current position
    const playerTransform = Transform.get(engine.PlayerEntity)
    
    // Get the mutable transform of our camera zone entity and update its position
    const zoneTransform = Transform.getMutable(activeCameraArea)
    zoneTransform.position = Vector3.create(
        playerTransform.position.x,
        playerTransform.position.y,
        playerTransform.position.z
    )
})

// Creates a first-person camera zone right where the player is currently standing
export function createFirstPersonZoneAtPlayer(): Entity | null {
    // Clean up any existing zone first to prevent overlapping entities
    if (activeCameraArea) {
      removeFirstPersonZone()
    }

    // Ensure the player entity has a valid transform position
    if (!Transform.has(engine.PlayerEntity)) {
      console.log("Player position could not be found.")
      return null
    }

    // Fetch the player's current coordinates
    const playerTransform = Transform.get(engine.PlayerEntity)
    const currentPos = playerTransform.position

    // Create the new entity for the restriction zone
    activeCameraArea = engine.addEntity()

    // Position the zone precisely where the player is standing
    Transform.create(activeCameraArea, {
      position: Vector3.create(currentPos.x, currentPos.y, currentPos.z),
    })

    // Apply the CameraModeArea component forcing First Person
    CameraModeArea.create(activeCameraArea, {
      area: Vector3.create(6, 4, 6), // Width, Height, Depth (in meters)
      mode: CameraType.CT_FIRST_PERSON,
    })

    return activeCameraArea
}

// Deletes the camera area and completely cleans up the entity (Reset)
export function removeFirstPersonZone() {
    if (activeCameraArea) {
        // Removing the camera automatically destroys all attached components
        engine.removeEntity(activeCameraArea)
        activeCameraArea = null
  }
}

// --------------------------------------------------------------
// Shooting
// --------------------------------------------------------------

type shotVisualType = {
  entity: Entity
  lifeTimer: number
}

const shotVisuals: shotVisualType[] = []

const shotTime = 0.4

// Draw Shot Visuals
export function createLine(start: Vector3, end: Vector3, thickness: number = 0.04): Entity {
  const lineEntity = engine.addEntity()

  // 1. Calculate the midpoint between start and end
  const position = Vector3.scale(Vector3.add(start, end), 0.5)

  // 2. Calculate distance (stretches the cube along the Z-axis)
  const length = Vector3.distance(start, end)

  // 3. Compute the normalized direction vector and get the rotation
  const direction = Vector3.normalize(Vector3.subtract(end, start))
  const rotation = Quaternion.lookRotation(direction)

  // 4. Apply the Transform component
  Transform.create(lineEntity, {
    position,
    rotation,
    scale: Vector3.create(thickness, thickness, length)
  })

  // 5. Add mesh and collider
  MeshRenderer.setBox(lineEntity)

  return lineEntity
}

// Draw Line Visuals
function UpdateLine(dt: number, line: Entity) {
  // Loop backwards to safely remove items while iterating
  for (let i = shotVisuals.length - 1; i >= 0; i--) {
    const shotVis = shotVisuals[i]
    
    if (shotVis.entity !== line) continue

    Material.setPbrMaterial(shotVis.entity, {
    albedoColor: Color4.create(1, 1, 0.2, shotVis.lifeTimer / shotTime),
    emissiveColor: Color4.create(1, 1, 0.2, 1),
    emissiveIntensity: 1.0,
    roughness: 0.9,
    castShadows: false,
  })

    shotVis.lifeTimer -= dt
    if (shotVis.lifeTimer <= 0) {
      shotVisuals.splice(i, 1)
      engine.removeEntity(line)
      break // Exit early since we found and removed the specific line
    }
  }
}

function Shoot() {
  const pointerInfo = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const camera = Transform.getOrNull(engine.CameraEntity)
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!pointerInfo?.worldRayDirection || !camera || !player) return

  const dir = Vector3.create(
    pointerInfo.worldRayDirection.x,
    pointerInfo.worldRayDirection.y,
    pointerInfo.worldRayDirection.z
  )

  // Fresh entity per shot, placed at the camera's position
  const rayEntity = engine.addEntity()
  Transform.create(rayEntity, { position: Vector3.clone(camera.position) })

  raycastSystem.registerGlobalDirectionRaycast(
    {
      entity: rayEntity,
      opts: {
        queryType: RaycastQueryType.RQT_HIT_FIRST,
        direction: dir,
        maxDistance: 250,
        continuous: false,
      },
    },
    (result) => {
      // Define Hit
      const hit = result.hits[0]

      // Find End Position For Line
      const rVec = Vector3.scale(Vector3.rotate(Vector3.Right(), camera.rotation), 0.2)
      const startPos = Vector3.add(Vector3.add(player.position, Vector3.create(0, 1.5, 0)), rVec)
      const rEnd = Vector3.scale(Vector3.rotate(Vector3.Forward(), camera.rotation), 250)
      const fullEnd = Vector3.add(Vector3.add(player.position, Vector3.create(0, 1.5, 0)), rEnd)
      const endPos = hit?.entityId !== undefined ? hit.position : fullEnd
      if(endPos != undefined) {
        const newline = createLine(startPos, endPos)
        shotVisuals.push({ entity: newline, lifeTimer: shotTime })
        engine.addSystem((dt) => {
          UpdateLine(dt, newline)
        })
      }

      // 
      if (hit?.entityId !== undefined) {
        for (const target of targets) {
          if (hit.entityId === target.entity) ResetTarget(target.entity)
        }
      }
      engine.removeEntity(rayEntity) // clean up
    }
  )
}