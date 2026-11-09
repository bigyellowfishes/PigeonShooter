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
    Name
} from '@dcl/sdk/ecs'

import { Vector3 } from '@dcl/sdk/math'
import { ResetTarget, targets } from './targets'

//
let pointerState: boolean | undefined

// --------------------------------------------------------------
// Set Up Script For Shooting, Called in index
// --------------------------------------------------------------
export function SetUpShooting() {

    // Create a system that runs every frame
    engine.addSystem(() => {

        // Check if the left mouse button was pressed down anywhere on screen
        if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
            //console.log("Global left mouse button DOWN")
            pointerState = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked
            PointerLock.createOrReplace(engine.CameraEntity, {isPointerLocked: true})
            createFirstPersonZoneAtPlayer()
        }

        // Check if the left mouse button was released anywhere on screen
        if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
            //console.log("Global left mouse button UP")
            if(pointerState != undefined) PointerLock.createOrReplace(engine.CameraEntity, {isPointerLocked: pointerState});
            removeFirstPersonZone()
            Shoot()
        }
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



function Shoot() {
  const pointerInfo = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const camera = Transform.getOrNull(engine.CameraEntity)
  if (!pointerInfo?.worldRayDirection || !camera) return

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
      const hit = result.hits[0]
      if (hit?.entityId !== undefined) {
        for (const target of targets) {
          if (hit.entityId === target.entity) ResetTarget(target.entity)
        }
      }
      engine.removeEntity(rayEntity) // clean up
    }
  )
}