import { Vector3 } from '@dcl/sdk/math'
import {
  ARENA_CENTRE,
  CANNONS,
  FALL_ACCEL,
  FALL_START_SPEED,
  FLIGHT_ANGULAR_SPEED,
  FLIGHT_HEIGHT,
  FLIGHT_HEIGHT_WOBBLE,
  FLIGHT_RADIUS,
  FLIGHT_RADIUS_WOBBLE,
  LAUNCH_ARC_HEIGHT,
  LAUNCH_TIME
} from './config'
import { PigeonPhase } from './phases'

// ---------------------------------------------------------------------------
// Pigeon motion as a pure function of (state, server time). The server uses it
// to judge hits and catches, the clients use it to draw the birds, so nothing
// per-frame has to travel over the network: only phase changes do.
// ---------------------------------------------------------------------------

export type PigeonLike = {
  phase: number
  cannon: number
  seed: number
  t0: number
  sx: number
  sy: number
  sz: number
}

export type PigeonPose = {
  visible: boolean
  position: Vector3 // canopy centre (flying) or feet (falling body centre / landed feet handled by visuals)
  yaw: number // degrees, direction of travel
  tau: number // seconds since t0
}

// Small seeded random generator so both sides derive the same flight from a seed
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type FlightParams = { dir: number; theta0: number; p1: number; p2: number; p3: number }

const paramCache = new Map<string, FlightParams>()

function flightParams(seed: number, cannon: number): FlightParams {
  const key = seed + ':' + cannon
  const hit = paramCache.get(key)
  if (hit) return hit
  const r = seededRandom(seed)
  const c = CANNONS[cannon % CANNONS.length].muzzle
  const cannonAngle = Math.atan2(c.z - ARENA_CENTRE.z, c.x - ARENA_CENTRE.x)
  const p: FlightParams = {
    dir: r() < 0.5 ? -1 : 1,
    theta0: cannonAngle + (r() - 0.5),
    p1: r() * Math.PI * 2,
    p2: r() * Math.PI * 2,
    p3: r() * Math.PI * 2
  }
  if (paramCache.size > 200) paramCache.clear()
  paramCache.set(key, p)
  return p
}

// Circling path: tau seconds after circling started
export function flightPosition(seed: number, cannon: number, tau: number): Vector3 {
  const p = flightParams(seed, cannon)
  const radius = FLIGHT_RADIUS + FLIGHT_RADIUS_WOBBLE * Math.sin(0.23 * tau + p.p1)
  const theta = p.theta0 + p.dir * (FLIGHT_ANGULAR_SPEED * tau + 0.4 * Math.sin(0.11 * tau + p.p2))
  const y = FLIGHT_HEIGHT + FLIGHT_HEIGHT_WOBBLE * Math.sin(0.31 * tau + p.p3)
  return Vector3.create(ARENA_CENTRE.x + radius * Math.cos(theta), y, ARENA_CENTRE.z + radius * Math.sin(theta))
}

// Launch arc from the cannon muzzle to the start of the circling path, u in 0..1
export function launchPosition(seed: number, cannon: number, u: number): Vector3 {
  const e = 1 - (1 - u) * (1 - u) // fast out of the barrel, easing into the circle
  const a = CANNONS[cannon % CANNONS.length].muzzle
  const b = flightPosition(seed, cannon, 0)
  const mid = Vector3.create((a.x + b.x) / 2, Math.max(a.y, b.y) + LAUNCH_ARC_HEIGHT, (a.z + b.z) / 2)
  const k = 1 - e
  return Vector3.create(
    k * k * a.x + 2 * k * e * mid.x + e * e * b.x,
    k * k * a.y + 2 * k * e * mid.y + e * e * b.y,
    k * k * a.z + 2 * k * e * mid.z + e * e * b.z
  )
}

// Seconds a pigeon popped at height h takes to reach the ground
export function fallDuration(h: number): number {
  const v = FALL_START_SPEED
  const a = FALL_ACCEL
  return (-v + Math.sqrt(v * v + 2 * a * Math.max(0, h))) / a
}

function fallHeight(startY: number, tau: number): number {
  return Math.max(0, startY - (FALL_START_SPEED * tau + 0.5 * FALL_ACCEL * tau * tau))
}

function rawPosition(s: PigeonLike, tau: number): Vector3 | null {
  switch (s.phase) {
    case PigeonPhase.Launch:
      if (tau < LAUNCH_TIME) return launchPosition(s.seed, s.cannon, Math.max(0, tau) / LAUNCH_TIME)
      return flightPosition(s.seed, s.cannon, tau - LAUNCH_TIME)
    case PigeonPhase.Flying:
      return flightPosition(s.seed, s.cannon, Math.max(0, tau))
    case PigeonPhase.Falling:
      return Vector3.create(s.sx, fallHeight(s.sy, Math.max(0, tau)), s.sz)
    case PigeonPhase.Landed:
      return Vector3.create(s.sx, 0, s.sz)
    default:
      return null
  }
}

// Where a pigeon is at serverMs. For Launch and Flying the position is the canopy
// centre (the hit sphere); for Falling and Landed it is the pigeon itself.
export function pigeonPose(s: PigeonLike, serverMs: number): PigeonPose {
  const tau = (serverMs - s.t0) / 1000
  const pos = rawPosition(s, tau)
  if (!pos) return { visible: false, position: Vector3.Zero(), yaw: 0, tau }
  let yaw = 0
  if (s.phase === PigeonPhase.Launch || s.phase === PigeonPhase.Flying) {
    const ahead = rawPosition(s, tau + 0.1)
    if (ahead) {
      const dx = ahead.x - pos.x
      const dz = ahead.z - pos.z
      if (Math.abs(dx) + Math.abs(dz) > 0.0001) yaw = (Math.atan2(dx, dz) * 180) / Math.PI
    }
  }
  return { visible: true, position: pos, yaw, tau }
}
