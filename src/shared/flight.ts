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
import { ArenaPerk, PigeonKind, slowedSeconds, SLOW_RATE, windOffset } from './rules'

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
  kind?: number
  slow?: boolean
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

// Circling path: tau seconds after circling started. Fast pigeons go round quicker; zig-zaggers
// weave in and out and bob up and down.
export function flightPosition(seed: number, cannon: number, tau: number, kind: number = PigeonKind.Normal): Vector3 {
  const p = flightParams(seed, cannon)
  const speed = kind === PigeonKind.Fast ? 1.8 : 1
  let radius = FLIGHT_RADIUS + FLIGHT_RADIUS_WOBBLE * Math.sin(0.23 * tau + p.p1)
  let theta = p.theta0 + p.dir * (FLIGHT_ANGULAR_SPEED * speed * tau + 0.4 * Math.sin(0.11 * tau + p.p2))
  let y = FLIGHT_HEIGHT + FLIGHT_HEIGHT_WOBBLE * Math.sin(0.31 * tau + p.p3)
  if (kind === PigeonKind.ZigZag) {
    radius += 7 * Math.sin(1.7 * tau + p.p2)
    theta += 0.18 * Math.sin(1.3 * tau + p.p1)
    y += 3.5 * Math.sin(2.1 * tau + p.p3)
  }
  return Vector3.create(ARENA_CENTRE.x + radius * Math.cos(theta), y, ARENA_CENTRE.z + radius * Math.sin(theta))
}

// Launch arc from the cannon muzzle to the start of the circling path, u in 0..1
export function launchPosition(seed: number, cannon: number, u: number, kind: number = PigeonKind.Normal): Vector3 {
  const e = 1 - (1 - u) * (1 - u) // fast out of the barrel, easing into the circle
  const a = CANNONS[cannon % CANNONS.length].muzzle
  const b = flightPosition(seed, cannon, 0, kind)
  const mid = Vector3.create((a.x + b.x) / 2, Math.max(a.y, b.y) + LAUNCH_ARC_HEIGHT, (a.z + b.z) / 2)
  const k = 1 - e
  return Vector3.create(
    k * k * a.x + 2 * k * e * mid.x + e * e * b.x,
    k * k * a.y + 2 * k * e * mid.y + e * e * b.y,
    k * k * a.z + 2 * k * e * mid.z + e * e * b.z
  )
}

// A popped pigeon falls faster and faster; one popped under Slow Chutes falls at half the rate
function fallRate(slow: boolean): number {
  return slow ? SLOW_RATE : 1
}

// Seconds a pigeon popped at height h takes to reach the ground
export function fallDuration(h: number, slow: boolean = false): number {
  const k = fallRate(slow)
  const v = FALL_START_SPEED * k
  const a = FALL_ACCEL * k
  return (-v + Math.sqrt(v * v + 2 * a * Math.max(0, h))) / a
}

function fallHeight(startY: number, tau: number, slow: boolean): number {
  const k = fallRate(slow)
  return Math.max(0, startY - (FALL_START_SPEED * k * tau + 0.5 * FALL_ACCEL * k * tau * tau))
}

function positionAt(s: PigeonLike, serverMs: number, perks: ArenaPerk[]): Vector3 | null {
  const tau = (serverMs - s.t0) / 1000
  const kind = s.kind ?? PigeonKind.Normal
  switch (s.phase) {
    case PigeonPhase.Launch:
    case PigeonPhase.Flying: {
      // Flying pigeons move on effective time (Slow Chutes holds it back) and drift on the wind
      const eff = Math.max(0, tau - slowedSeconds(perks, s.t0, serverMs))
      const wind = windOffset(perks, s.seed, serverMs)
      if (s.phase === PigeonPhase.Launch && eff < LAUNCH_TIME) {
        const u = eff / LAUNCH_TIME
        return Vector3.add(launchPosition(s.seed, s.cannon, u, kind), Vector3.scale(wind, u))
      }
      const flown = s.phase === PigeonPhase.Launch ? eff - LAUNCH_TIME : eff
      return Vector3.add(flightPosition(s.seed, s.cannon, flown, kind), wind)
    }
    case PigeonPhase.Falling:
      return Vector3.create(s.sx, fallHeight(s.sy, Math.max(0, tau), !!s.slow), s.sz)
    case PigeonPhase.Landed:
      return Vector3.create(s.sx, 0, s.sz)
    default:
      return null
  }
}

/** Seconds into the launch, on effective time (for the launch tumble) */
export function launchProgress(s: PigeonLike, serverMs: number, perks: ArenaPerk[]): number {
  const tau = (serverMs - s.t0) / 1000
  return Math.max(0, tau - slowedSeconds(perks, s.t0, serverMs))
}

// Where a pigeon is at serverMs. For Launch and Flying the position is the canopy
// centre (the hit sphere); for Falling and Landed it is the pigeon itself.
export function pigeonPose(s: PigeonLike, serverMs: number, perks: ArenaPerk[] = []): PigeonPose {
  const tau = (serverMs - s.t0) / 1000
  const pos = positionAt(s, serverMs, perks)
  if (!pos) return { visible: false, position: Vector3.Zero(), yaw: 0, tau }
  let yaw = 0
  if (s.phase === PigeonPhase.Launch || s.phase === PigeonPhase.Flying) {
    const ahead = positionAt(s, serverMs + 100, perks)
    if (ahead) {
      const dx = ahead.x - pos.x
      const dz = ahead.z - pos.z
      if (Math.abs(dx) + Math.abs(dz) > 0.0001) yaw = (Math.atan2(dx, dz) * 180) / Math.PI
    }
  }
  return { visible: true, position: pos, yaw, tau }
}
