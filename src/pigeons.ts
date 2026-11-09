import { engine, Entity, Name, Transform, GltfContainer, Animator, MeshRenderer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { targets } from './targets'

// ---------------------------------------------------------------------------
// Pigeon visuals for Joel's targets.
// Reads target.state from targets.ts and never writes to it. Each target keeps its
// own sphere collider (that is what the shot raycast hits); only the ball mesh is
// removed and replaced by a stunt pigeon hanging under a parachute.
//
// state 0 waiting, 1 shot out of a cannon, 2 floating, 3 falling (parachute shot), 4 on the ground
// ---------------------------------------------------------------------------

// Tuning
const PIGEON_SCALE = 4            // model is real pigeon size (about 0.45 m tall), so scale it up for the arena
const GOLDEN_CHANCE = 0           // 0..1, chance a launch uses the golden pigeon (for Golden Hour later)
const CANOPY_CENTRE = 1.27        // canopy centre above the pigeon's feet, in model units
const BODY_CENTRE = 0.25          // pigeon body centre above its feet, in model units
const LAUNCH_HIDE = 0.25          // seconds hidden at launch so the bird appears on the cannon's bang
const LAUNCH_TIME = 2             // matches the duration targets.ts passes to startSmoothPath
const LAUNCH_SPINS = 2            // tumbles while flying out of the cannon
const DEPLOY_TIME = 0.7           // length of the parachute's Deploy clip
const DETACH_TIME = 1.1           // length of the parachute's Detach clip
const CANNON_FIRE_TIME = 1.1      // length of the cannon's Fire clip
const SWAY_ROLL = 6               // degrees of side-to-side swing under the canopy
const SWAY_PITCH = 4              // degrees of front-to-back swing

const MODELS = {
  pigeon: 'assets/Models/Pigeon/PS_Pigeon.glb',
  pigeonGolden: 'assets/Models/Pigeon/PS_Pigeon_Golden.glb',
  parachute: 'assets/Models/Pigeon/PS_Parachute.glb',
  parachuteGolden: 'assets/Models/Pigeon/PS_Parachute_Golden.glb'
}

// Cannon muzzle positions in scene coordinates, used to pick the cannon nearest a launch
const CANNON_MUZZLES: { name: string; pos: Vector3 }[] = [
  { name: 'Cannon 01', pos: Vector3.create(232.26, 15.24, 344.61) },
  { name: 'Cannon 02', pos: Vector3.create(191.14, 15.24, 320.86) },
  { name: 'Cannon 03', pos: Vector3.create(167.39, 15.24, 279.74) },
  { name: 'Cannon 04', pos: Vector3.create(167.39, 15.24, 232.26) },
  { name: 'Cannon 05', pos: Vector3.create(191.14, 15.24, 191.14) },
  { name: 'Cannon 06', pos: Vector3.create(232.26, 15.24, 167.39) },
  { name: 'Cannon 07', pos: Vector3.create(279.74, 15.24, 167.39) },
  { name: 'Cannon 08', pos: Vector3.create(320.86, 15.24, 191.14) },
  { name: 'Cannon 09', pos: Vector3.create(344.61, 15.24, 232.26) },
  { name: 'Cannon 10', pos: Vector3.create(344.61, 15.24, 279.74) },
  { name: 'Cannon 11', pos: Vector3.create(320.86, 15.24, 320.86) },
  { name: 'Cannon 12', pos: Vector3.create(279.74, 15.24, 344.61) }
]

type PigeonVisual = {
  target: Entity
  prevState: number
  stateTime: number
  golden: boolean
  phase: number
  // bird: pivot at the canopy centre > offset (scaled) > tumble > model
  birdPivot: Entity
  birdOffset: Entity
  tumble: Entity
  bird: Entity
  // parachute: pivot at the canopy centre > model (scaled)
  chutePivot: Entity
  chute: Entity
  chuteFree: boolean
  offsetY: number
}

const visuals: PigeonVisual[] = []
const cannons: { entity: Entity; pos: Vector3; resetAt: number }[] = []
let clock = 0

export function SetUpPigeons() {
  // cannons
  for (const [entity, name] of engine.getEntitiesWith(Name)) {
    const muzzle = CANNON_MUZZLES.find((c) => c.name === name.value)
    if (muzzle && Animator.has(entity)) cannons.push({ entity, pos: muzzle.pos, resetAt: -1 })
  }

  // swap each ball for a pigeon
  for (const t of targets) {
    if (MeshRenderer.has(t.entity)) MeshRenderer.deleteFrom(t.entity)
    visuals.push(createVisual(t.entity))
  }

  engine.addSystem(pigeonSystem)
}

// ---------------------------------------------------------------------------
// Entity setup
// ---------------------------------------------------------------------------
function child(parent: Entity, position: Vector3 = Vector3.Zero(), scale: Vector3 = Vector3.One()): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position, scale })
  return e
}

function createVisual(target: Entity): PigeonVisual {
  const S = PIGEON_SCALE
  const birdPivot = engine.addEntity()
  Transform.create(birdPivot, { position: Vector3.Zero() })
  const birdOffset = child(birdPivot, Vector3.create(0, -BODY_CENTRE * S, 0), Vector3.Zero())
  const tumble = child(birdOffset, Vector3.create(0, BODY_CENTRE, 0))
  const bird = child(tumble, Vector3.create(0, -BODY_CENTRE, 0))
  GltfContainer.create(bird, { src: MODELS.pigeon, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  Animator.create(bird, {
    states: [
      { clip: 'Hang', playing: false, loop: true, weight: 1, speed: 1, shouldReset: false },
      { clip: 'Flap', playing: true, loop: true, weight: 1, speed: 1, shouldReset: false },
      { clip: 'Sit', playing: false, loop: true, weight: 1, speed: 1, shouldReset: false }
    ]
  })

  const chutePivot = engine.addEntity()
  Transform.create(chutePivot, { position: Vector3.Zero() })
  const chute = child(chutePivot, Vector3.create(0, -CANOPY_CENTRE * S, 0), Vector3.Zero())
  GltfContainer.create(chute, { src: MODELS.parachute, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  Animator.create(chute, {
    states: [
      { clip: 'Deploy', playing: false, loop: false, weight: 1, speed: 1, shouldReset: true },
      { clip: 'Idle', playing: true, loop: true, weight: 1, speed: 1, shouldReset: false },
      { clip: 'Detach', playing: false, loop: false, weight: 1, speed: 1, shouldReset: true }
    ]
  })

  return {
    target,
    prevState: -1,
    stateTime: 0,
    golden: false,
    phase: Math.random() * Math.PI * 2,
    birdPivot,
    birdOffset,
    tumble,
    bird,
    chutePivot,
    chute,
    chuteFree: false,
    offsetY: -BODY_CENTRE * S
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function worldPosition(entity: Entity): Vector3 {
  const t = Transform.getOrNull(entity)
  if (!t) return Vector3.Zero()
  if (!t.parent) return Vector3.clone(t.position)
  const p = Transform.getOrNull(t.parent)
  if (!p) return Vector3.clone(t.position)
  const local = Vector3.rotate(Vector3.multiply(t.position, p.scale), worldRotation(t.parent))
  return Vector3.add(worldPosition(t.parent), local)
}

function worldRotation(entity: Entity): Quaternion {
  const t = Transform.getOrNull(entity)
  if (!t) return Quaternion.Identity()
  if (!t.parent) return t.rotation
  return Quaternion.multiply(worldRotation(t.parent), t.rotation)
}

function yawOf(entity: Entity): number {
  const f = Vector3.rotate(Vector3.Forward(), worldRotation(entity))
  if (Math.abs(f.x) + Math.abs(f.z) < 0.0001) return 0
  return (Math.atan2(f.x, f.z) * 180) / Math.PI
}

function setScale(entity: Entity, s: number) {
  Transform.getMutable(entity).scale = Vector3.create(s, s, s)
}

function play(entity: Entity, clip: string) {
  Animator.playSingleAnimation(entity, clip, true)
}

function smooth(u: number): number {
  const x = Math.max(0, Math.min(1, u))
  return x * x * (3 - 2 * x)
}

function fireNearestCannon(pos: Vector3) {
  let best: (typeof cannons)[number] | null = null
  let bestD = Infinity
  for (const c of cannons) {
    const d = Vector3.distanceSquared(c.pos, pos)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  if (!best) return
  play(best.entity, 'Fire')
  best.resetAt = clock + CANNON_FIRE_TIME
}

function setModels(v: PigeonVisual, golden: boolean) {
  if (v.golden === golden) return
  v.golden = golden
  GltfContainer.getMutable(v.bird).src = golden ? MODELS.pigeonGolden : MODELS.pigeon
  GltfContainer.getMutable(v.chute).src = golden ? MODELS.parachuteGolden : MODELS.parachute
}

// ---------------------------------------------------------------------------
// Per-frame
// ---------------------------------------------------------------------------
function onEnterState(v: PigeonVisual, state: number) {
  const S = PIGEON_SCALE
  if (state === 1) {
    // shot out of a cannon: bird tumbles out with the bang, parachute packed away
    setModels(v, Math.random() < GOLDEN_CHANCE)
    fireNearestCannon(worldPosition(v.target))
    v.offsetY = -BODY_CENTRE * S
    v.chuteFree = false
    setScale(v.birdOffset, 0)
    setScale(v.chute, 0)
    play(v.bird, 'Flap')
  } else if (state === 2) {
    // parachute pops open, bird drops in under it and dangles
    setScale(v.birdOffset, S)
    setScale(v.chute, S)
    Transform.getMutable(v.tumble).rotation = Quaternion.Identity()
    play(v.chute, 'Deploy')
    play(v.bird, 'Hang')
  } else if (state === 3) {
    // parachute shot: it flies off on its own, the bird falls flapping
    setScale(v.birdOffset, S)
    Transform.getMutable(v.tumble).rotation = Quaternion.Identity()
    if (Transform.get(v.chute).scale.x > 0) {
      v.chuteFree = true
      play(v.chute, 'Detach')
    }
    play(v.bird, 'Flap')
  } else if (state === 4) {
    play(v.bird, 'Sit')
  } else if (state === 0) {
    setScale(v.birdOffset, 0)
    setScale(v.chute, 0)
  }
}

function pigeonSystem(rawDt: number) {
  const dt = Math.min(rawDt, 0.1)
  clock += dt
  const S = PIGEON_SCALE

  for (const c of cannons) {
    if (c.resetAt > 0 && clock >= c.resetAt) {
      c.resetAt = -1
      play(c.entity, 'Idle')
    }
  }

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const v = visuals[i]
    if (!v || !Transform.has(t.entity)) continue

    if (t.state !== v.prevState) {
      v.prevState = t.state
      v.stateTime = 0
      onEnterState(v, t.state)
    } else {
      v.stateTime += dt
    }

    const pos = worldPosition(t.entity)
    const yaw = yawOf(t.entity)
    const time = clock + v.phase

    // where the bird hangs relative to the target (the canopy centre / collider)
    let wantOffset = -BODY_CENTRE * S
    let roll = 0
    let pitch = 0
    let pivotPos = pos

    if (t.state === 1) {
      if (v.stateTime >= LAUNCH_HIDE) setScale(v.birdOffset, S)
      const spin = 360 * LAUNCH_SPINS * smooth(v.stateTime / LAUNCH_TIME)
      Transform.getMutable(v.tumble).rotation = Quaternion.fromEulerDegrees(spin, 0, 0)
    } else if (t.state === 2) {
      wantOffset = -CANOPY_CENTRE * S
      const settle = Math.min(1, v.stateTime / 1.5)
      roll = SWAY_ROLL * Math.sin(time * 2.2) * settle
      pitch = SWAY_PITCH * Math.sin(time * 1.7) * settle
      if (v.stateTime >= DEPLOY_TIME && v.stateTime - dt < DEPLOY_TIME) play(v.chute, 'Idle')
    } else if (t.state === 4) {
      // sit on the ground: feet at y = 0
      pivotPos = Vector3.create(pos.x, 0, pos.z)
      wantOffset = 0
    }

    // ease the hang distance so the bird drops in under the canopy with a little bounce
    const k = 1 - Math.exp(-10 * dt)
    v.offsetY += (wantOffset - v.offsetY) * k
    if (t.state === 4) v.offsetY = 0

    const rot = Quaternion.fromEulerDegrees(pitch, yaw, roll)
    const bp = Transform.getMutable(v.birdPivot)
    bp.position = pivotPos
    bp.rotation = rot
    Transform.getMutable(v.birdOffset).position = Vector3.create(0, v.offsetY, 0)

    // parachute follows the target until it is shot off
    if (!v.chuteFree) {
      const cp = Transform.getMutable(v.chutePivot)
      cp.position = pos
      cp.rotation = rot
    } else if (v.stateTime >= DETACH_TIME) {
      v.chuteFree = false
      setScale(v.chute, 0)
    }
  }
}
