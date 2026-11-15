import {
  engine,
  Entity,
  Name,
  Transform,
  GltfContainer,
  Animator,
  MeshRenderer,
  MeshCollider,
  Material,
  MaterialTransparencyMode
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import {
  BODY_CENTRE,
  CANNONS,
  CANOPY_CENTRE,
  CATCH_RADIUS,
  GRAB_RADIUS,
  LAUNCH_TIME,
  PIGEON_SCALE,
  PLAYER_COLOURS
} from '../shared/config'
import { pigeonPose } from '../shared/flight'
import { PigeonPhase } from '../shared/phases'
import { game, serverNow } from './store'

// ---------------------------------------------------------------------------
// Draws the server's pigeons: stunt pigeons under parachutes, the cannons that
// fire them, and a landing shadow in the shooter's colour. Positions come from
// the shared flight maths, so only phase changes travel over the network.
// ---------------------------------------------------------------------------

const LAUNCH_HIDE = 0.25 // seconds hidden at launch so the bird appears on the cannon's bang
const LAUNCH_SPINS = 2 // tumbles while flying out of the cannon
const DEPLOY_TIME = 0.7 // length of the parachute's Deploy clip
const DETACH_TIME = 1.1 // length of the parachute's Detach clip
const CANNON_FIRE_TIME = 1.1 // length of the cannon's Fire clip
const SWAY_ROLL = 6 // degrees of side-to-side swing under the canopy
const SWAY_PITCH = 4 // degrees of front-to-back swing

const MODELS = {
  pigeon: 'assets/Models/Pigeon/PS_Pigeon.glb',
  pigeonGolden: 'assets/Models/Pigeon/PS_Pigeon_Golden.glb',
  parachute: 'assets/Models/Pigeon/PS_Parachute.glb',
  parachuteGolden: 'assets/Models/Pigeon/PS_Parachute_Golden.glb'
}

type Visual = {
  prevPhase: number
  prevT0: number
  enteredAt: number // local seconds when the current phase was first seen
  golden: boolean
  phase: number // random sway phase
  birdPivot: Entity
  birdOffset: Entity
  tumble: Entity
  bird: Entity
  chutePivot: Entity
  chute: Entity
  chuteFree: boolean
  chuteFreeAt: number
  offsetY: number
  yaw: number
  marker: Entity
  markerKey: string
}

const visuals = new Map<number, Visual>()
const cannonEntities = new Map<number, { entity: Entity; resetAt: number }>()
let clock = 0

export function setupPigeons() {
  // Hide the editor's placeholder balls; hits are judged by the server now
  for (const [entity, name] of engine.getEntitiesWith(Name)) {
    if (name.value.startsWith('Target_')) {
      if (MeshRenderer.has(entity)) MeshRenderer.deleteFrom(entity)
      if (MeshCollider.has(entity)) MeshCollider.deleteFrom(entity)
    }
    const index = CANNONS.findIndex((c) => c.name === name.value)
    if (index >= 0 && Animator.has(entity)) cannonEntities.set(index, { entity, resetAt: -1 })
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

function createVisual(): Visual {
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

  // Landing shadow: a flat disc on the ground in the shooter's colour
  const marker = engine.addEntity()
  Transform.create(marker, { position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(marker)

  return {
    prevPhase: -1,
    prevT0: -1,
    enteredAt: 0,
    golden: false,
    phase: Math.random() * Math.PI * 2,
    birdPivot,
    birdOffset,
    tumble,
    bird,
    chutePivot,
    chute,
    chuteFree: false,
    chuteFreeAt: 0,
    offsetY: -BODY_CENTRE * S,
    yaw: 0,
    marker,
    markerKey: ''
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function setModels(v: Visual, golden: boolean) {
  if (v.golden === golden) return
  v.golden = golden
  GltfContainer.getMutable(v.bird).src = golden ? MODELS.pigeonGolden : MODELS.pigeon
  GltfContainer.getMutable(v.chute).src = golden ? MODELS.parachuteGolden : MODELS.parachute
}

function colourOf(address: string): [number, number, number] {
  for (const s of game.scores) {
    if (s.address === address) return PLAYER_COLOURS[s.colour % PLAYER_COLOURS.length]
  }
  return [1, 1, 1]
}

function showMarker(v: Visual, x: number, z: number, radius: number, colour: [number, number, number], alpha: number) {
  const key = [x, z, radius, colour.join(','), alpha].join('|')
  if (key === v.markerKey) return
  v.markerKey = key
  const t = Transform.getMutable(v.marker)
  t.position = Vector3.create(x, 0.08, z)
  t.scale = Vector3.create(radius * 2, 0.02, radius * 2)
  Material.setPbrMaterial(v.marker, {
    albedoColor: Color4.create(colour[0], colour[1], colour[2], alpha),
    emissiveColor: Color4.create(colour[0], colour[1], colour[2], 1),
    emissiveIntensity: 0.6,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
}

function hideMarker(v: Visual) {
  if (v.markerKey === '') return
  v.markerKey = ''
  const t = Transform.getMutable(v.marker)
  t.scale = Vector3.Zero()
  t.position = Vector3.create(0, -50, 0)
}

function fireCannon(index: number) {
  const c = cannonEntities.get(index)
  if (!c) return
  play(c.entity, 'Fire')
  c.resetAt = clock + CANNON_FIRE_TIME
}

// ---------------------------------------------------------------------------
// Phase changes
// ---------------------------------------------------------------------------
function onEnterPhase(v: Visual, st: { phase: number; cannon: number; golden: boolean; t0: number }, tau: number) {
  const S = PIGEON_SCALE
  if (st.phase === PigeonPhase.Launch) {
    setModels(v, st.golden)
    if (tau < 1) fireCannon(st.cannon) // skip the bang when joining mid-flight
    v.chuteFree = false
    v.offsetY = -BODY_CENTRE * S
    setScale(v.birdOffset, 0)
    setScale(v.chute, 0)
    play(v.bird, 'Flap')
    hideMarker(v)
  } else if (st.phase === PigeonPhase.Flying) {
    setModels(v, st.golden)
    v.chuteFree = false
    setScale(v.birdOffset, S)
    setScale(v.chute, S)
    Transform.getMutable(v.tumble).rotation = Quaternion.Identity()
    play(v.chute, tau < DEPLOY_TIME ? 'Deploy' : 'Idle')
    play(v.bird, 'Hang')
    hideMarker(v)
  } else if (st.phase === PigeonPhase.Falling) {
    setScale(v.birdOffset, S)
    Transform.getMutable(v.tumble).rotation = Quaternion.Identity()
    if (Transform.get(v.chute).scale.x > 0 && tau < DETACH_TIME) {
      v.chuteFree = true
      v.chuteFreeAt = clock
      play(v.chute, 'Detach')
    } else {
      setScale(v.chute, 0)
    }
    play(v.bird, 'Flap')
  } else if (st.phase === PigeonPhase.Landed) {
    setScale(v.birdOffset, S)
    setScale(v.chute, 0)
    Transform.getMutable(v.tumble).rotation = Quaternion.Identity()
    play(v.bird, 'Sit')
  } else {
    setScale(v.birdOffset, 0)
    setScale(v.chute, 0)
    v.chuteFree = false
    hideMarker(v)
  }
}

// ---------------------------------------------------------------------------
// Per frame
// ---------------------------------------------------------------------------
function pigeonSystem(rawDt: number) {
  const dt = Math.min(rawDt, 0.1)
  clock += dt
  const S = PIGEON_SCALE
  const now = serverNow()

  for (const c of cannonEntities.values()) {
    if (c.resetAt > 0 && clock >= c.resetAt) {
      c.resetAt = -1
      play(c.entity, 'Idle')
    }
  }

  for (const st of game.pigeons) {
    let v = visuals.get(st.slot)
    if (!v) {
      v = createVisual()
      visuals.set(st.slot, v)
    }
    const t0 = Number(st.t0)
    const pose = pigeonPose({ ...st, t0 }, now)

    if (st.phase !== v.prevPhase || t0 !== v.prevT0) {
      const phaseChanged = st.phase !== v.prevPhase
      v.prevPhase = st.phase
      v.prevT0 = t0
      if (phaseChanged) {
        v.enteredAt = clock
        onEnterPhase(v, { phase: st.phase, cannon: st.cannon, golden: st.golden, t0 }, pose.tau)
      }
    }

    const time = clock + v.phase
    let pivotPos = pose.position
    let wantOffset = -BODY_CENTRE * S
    let roll = 0
    let pitch = 0
    let snapOffset = false

    if (st.phase === PigeonPhase.Launch) {
      if (pose.tau >= LAUNCH_HIDE) setScale(v.birdOffset, S)
      const spin = 360 * LAUNCH_SPINS * smooth(pose.tau / LAUNCH_TIME)
      Transform.getMutable(v.tumble).rotation = Quaternion.fromEulerDegrees(spin, 0, 0)
    } else if (st.phase === PigeonPhase.Flying) {
      wantOffset = -CANOPY_CENTRE * S
      const settle = Math.min(1, pose.tau / 1.5)
      roll = SWAY_ROLL * Math.sin(time * 2.2) * settle
      pitch = SWAY_PITCH * Math.sin(time * 1.7) * settle
      const seenFor = clock - v.enteredAt
      if (seenFor >= DEPLOY_TIME && seenFor - dt < DEPLOY_TIME) play(v.chute, 'Idle')
    } else if (st.phase === PigeonPhase.Falling || st.phase === PigeonPhase.Landed) {
      // Position is the pigeon's feet from here on
      wantOffset = 0
      snapOffset = true
      const colour = colourOf(st.owner)
      if (st.phase === PigeonPhase.Falling) showMarker(v, st.sx, st.sz, CATCH_RADIUS, colour, 0.45)
      else showMarker(v, st.sx, st.sz, GRAB_RADIUS, [1, 1, 1], 0.3)
    }

    if (!pose.visible) continue

    if (snapOffset) v.offsetY = wantOffset
    else v.offsetY += (wantOffset - v.offsetY) * (1 - Math.exp(-10 * dt))

    // Turn smoothly towards the direction of travel (the launch arc joins the circle at an angle)
    if (st.phase === PigeonPhase.Launch || st.phase === PigeonPhase.Flying) {
      const d = ((pose.yaw - v.yaw + 540) % 360) - 180
      v.yaw += d * (1 - Math.exp(-4 * dt))
    }
    const rot = Quaternion.fromEulerDegrees(pitch, v.yaw, roll)
    const bp = Transform.getMutable(v.birdPivot)
    bp.position = pivotPos
    bp.rotation = st.phase === PigeonPhase.Falling || st.phase === PigeonPhase.Landed ? Quaternion.fromEulerDegrees(0, v.yaw, 0) : rot
    Transform.getMutable(v.birdOffset).position = Vector3.create(0, v.offsetY, 0)

    // The parachute follows the pigeon until it is shot off, then flies away on its own
    if (!v.chuteFree) {
      if (st.phase === PigeonPhase.Launch || st.phase === PigeonPhase.Flying) {
        const cp = Transform.getMutable(v.chutePivot)
        cp.position = pivotPos
        cp.rotation = rot
      }
    } else if (clock - v.chuteFreeAt >= DETACH_TIME) {
      v.chuteFree = false
      setScale(v.chute, 0)
    }
  }
}
