import { engine, Entity, Name, Transform, getEntitiesWithParent } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import * as utils from '@dcl-sdk/utils'

export function SetUpTargetSystem() {
    FindShootableObjects()
    TargetMotion()
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const FLY_SPEED = 10          // units per second while circling
const TURN_RATE = 2           // higher = tighter turns, lower = wide lazy swoops
const ARRIVE_RADIUS = 6       // how close counts as "reached" the target point
const ROTATION_SMOOTHING = 8  // how quickly the model rotates to face its heading
const PITCH_AMOUNT = 0.5      // 0 = stay level, 1 = fully pitch up/down with climb
const MODEL_YAW_OFFSET = 0    // add 90 / -90 / 180 if the model faces a different axis
const FALL_SPEED = 20
const MAX_DT = 0.1            // clamp dt so tab-switching lag spikes don't teleport birds

// Area the birds fly around in (state 2)
const minCyl: Vector3 = Vector3.create(206, 40, 206)
const maxCyl: Vector3 = Vector3.create(306, 60, 306)

// Collection Timings
const TimeOnGround = 5

// ---------------------------------------------------------------------------
// Types / data
// ---------------------------------------------------------------------------
type TargetRig = {
    name: string
    entity: Entity
    state: number // 0: Waiting For Spawn, 1: Shot By Cannon, 2: In Flight Circle, 3: Falling, 4: Collection
    canonPath: Entity | null
    heading: Vector3 // current flight direction (normalized)
    targetPoint: Vector3 | null // point the bird is currently steering toward
    resetTimer: number
}

export const targets: TargetRig[] = []
export const cannonPaths: Entity[] = []

// Find Target entities within game system
function FindShootableObjects() {
    const foundTargets: { name: string; entity: Entity }[] = []

    for (const [entity, name] of engine.getEntitiesWith(Name, Transform)) {
        const n = name.value

        if (n.includes('Target_')) {
            foundTargets.push({ name: n, entity })
            continue
        }
        if (n.includes('Path_')) {
            cannonPaths.push(entity)
            continue
        }
    }

    for (const found of foundTargets) {
        targets.push({
            name: found.name,
            entity: found.entity,
            state: 0,
            canonPath: null,
            heading: Vector3.Forward(),
            targetPoint: null,
            resetTimer: 0
        })
    }
}

// ---------------------------------------------------------------------------
// World position helpers
// ---------------------------------------------------------------------------

// Manual function to compute world position factoring in Scale, Rotation, and Position
function getWorldPositionWithScale(entity: Entity): Vector3 {
    const transform = Transform.getOrNull(entity)
    if (!transform) return Vector3.Zero()

    const parent = transform.parent
    if (!parent) {
        return { ...transform.position }
    }

    const parentTransform = Transform.getOrNull(parent)
    const parentScale = parentTransform ? parentTransform.scale : Vector3.One()

    // Step 1: Multiply the child's local position by the parent's scale (component-wise)
    const scaledLocalPos = Vector3.multiply(transform.position, parentScale)

    // Step 2: Rotate the scaled position by the parent's world rotation
    const parentWorldRot = utils.getWorldRotation(parent)
    const rotatedPos = Vector3.rotate(scaledLocalPos, parentWorldRot)

    // Step 3: Add the parent's world position to get the final world coordinates
    const parentWorldPos = getWorldPositionWithScale(parent)
    return Vector3.add(parentWorldPos, rotatedPos)
}

// Store all children's accurate world positions into an array
function getChildrenWorldPositions(parent: Entity): Vector3[] {
    const childEntities = getEntitiesWithParent(engine, parent)
    const positions: Vector3[] = []

    for (const child of childEntities) {
        if (Transform.has(child)) {
            positions.push(getWorldPositionWithScale(child))
        }
    }

    return positions
}

// ---------------------------------------------------------------------------
// Random point generation
// ---------------------------------------------------------------------------

// Random point inside a cylinder inscribed in the given bounding box
function getRandomPointInCylinderFromBounds(minBound: Vector3, maxBound: Vector3): Vector3 {
    const centerX = (minBound.x + maxBound.x) / 2
    const centerZ = (minBound.z + maxBound.z) / 2

    // Uses the smaller horizontal dimension so the cylinder stays strictly inside the box
    const sizeX = Math.abs(maxBound.x - minBound.x)
    const sizeZ = Math.abs(maxBound.z - minBound.z)
    const maxRadius = Math.min(sizeX, sizeZ) / 2

    // Uniform random polar coordinates
    const angle = Math.random() * Math.PI * 2
    const radius = Math.sqrt(Math.random()) * maxRadius

    const x = centerX + radius * Math.cos(angle)
    const z = centerZ + radius * Math.sin(angle)
    const y = minBound.y + Math.random() * (maxBound.y - minBound.y)

    return Vector3.create(x, y, z)
}

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

// Eases the bird's heading toward the target point, moves it forward, and faces it along its heading
function steerTowardTarget(rig: TargetRig, mt: ReturnType<typeof Transform.getMutable>, dt: number) {
    if (!rig.targetPoint) {
        rig.targetPoint = getRandomPointInCylinderFromBounds(minCyl, maxCyl)
    }

    const toTarget = Vector3.subtract(rig.targetPoint, mt.position)

    // Reached it? Pick a fresh point next frame (the heading carries over, so no snap)
    if (Vector3.length(toTarget) < ARRIVE_RADIUS) {
        rig.targetPoint = null
        // Keep flying along the current heading this frame so the bird never stalls
        mt.position = Vector3.add(mt.position, Vector3.scale(rig.heading, FLY_SPEED * dt))
        return
    }

    // Ease the heading toward the desired direction (frame-rate independent)
    const desired = Vector3.normalize(toTarget)
    const t = 1 - Math.exp(-TURN_RATE * dt)
    let h = Vector3.lerp(rig.heading, desired, t)
    if (Vector3.lengthSquared(h) < 0.0001) h = desired // target was directly behind
    rig.heading = Vector3.normalize(h)

    // Move forward along the heading
    mt.position = Vector3.add(mt.position, Vector3.scale(rig.heading, FLY_SPEED * dt))

    // Face the direction of travel, smoothed
    const yaw = (Math.atan2(rig.heading.x, rig.heading.z) * 180) / Math.PI + MODEL_YAW_OFFSET
    const pitch = -Math.asin(Math.max(-1, Math.min(1, rig.heading.y))) * (180 / Math.PI) * PITCH_AMOUNT
    mt.rotation = Quaternion.slerp(
        mt.rotation,
        Quaternion.fromEulerDegrees(pitch, yaw, 0),
        1 - Math.exp(-ROTATION_SMOOTHING * dt)
    )
}

// ---------------------------------------------------------------------------
// Main target system
// ---------------------------------------------------------------------------
function TargetMotion() {
    engine.addSystem((rawDt) => {
        const dt = Math.min(rawDt, MAX_DT)

        for (const target of targets) {
            if (!Transform.has(target.entity)) continue

            // ---- State 0: Waiting. Pick a cannon path and launch along it ----
            if (target.state == 0) {
                const path = cannonPaths[Math.floor(Math.random() * cannonPaths.length)]
                if (!path) {
                    console.log('cannon path not found')
                    continue
                }

                const curvepoints = getChildrenWorldPositions(path)
                if (curvepoints.length == 0) {
                    console.log('cannon path has no points')
                    continue
                }

                target.canonPath = path
                target.state = 1

                utils.paths.startSmoothPath(target.entity, curvepoints, 2, 30, true, () => {
                    // Ignore if the bird was shot mid-launch
                    if (target.state != 1) return

                    // Hand off to steering using the direction the bird was already flying
                    const n = curvepoints.length
                    if (n >= 2) {
                        const dir = Vector3.subtract(curvepoints[n - 1], curvepoints[n - 2])
                        if (Vector3.lengthSquared(dir) > 0.0001) {
                            target.heading = Vector3.normalize(dir)
                        }
                    }
                    target.targetPoint = null
                    target.state = 2
                })
            }

            // ---- State 1: Launching. The cannon path utility handles movement ----
            else if (target.state == 1) {
                // Nothing to do
            }

            // ---- State 2: Circling. Steer toward random points ----
            else if (target.state == 2) {
                const mt = Transform.getMutable(target.entity)
                steerTowardTarget(target, mt, dt)
            }

            // ---- State 3: Falling ----
            else if (target.state == 3) {
                const mt = Transform.getMutable(target.entity)
                mt.position.y -= dt * FALL_SPEED
                if (mt.position.y < 0) {
                    target.state = 4
                    target.resetTimer = TimeOnGround
                    target.targetPoint = null
                }
            }

            // ---- State 4: Awaiting Collection ----
            else if (target.state == 4) {
                target.resetTimer -= dt
                if(target.resetTimer <= 0) target.state = 0
            }
        }
    })
}

export function ResetTarget(entity: Entity) {
    for (const target of targets) {
        if (entity == target.entity) {
            utils.paths.stopPath(target.entity)
            target.state = 3
            target.targetPoint = null
        }
    }
}
