import { engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import {
  BREAK_SECONDS,
  CANNONS,
  CANOPY_CENTRE,
  CATCH_HEIGHT,
  CATCH_RADIUS,
  FIRST_LAUNCH_SPREAD,
  GOLDEN_CHANCE,
  GOLDEN_MULTIPLIER,
  GRAB_RADIUS,
  GROUND_SECONDS,
  HIT_RADIUS,
  LAG_COMPENSATION,
  LAUNCH_TIME,
  LONG_SHOT_FROM,
  LONG_SHOT_MAX_BONUS,
  LONG_SHOT_SPAN,
  MAX_CATCH_MULTIPLIER,
  MAX_SHOT_DISTANCE,
  MAX_SHOT_MULTIPLIER,
  MIN_PLAYERS_TO_START,
  PIGEON_COUNT,
  PIGEON_SCALE,
  PLAYER_COLOURS,
  POINTS_CATCH,
  POINTS_GRAB,
  POINTS_HIT,
  RELAUNCH_MAX,
  RELAUNCH_MIN,
  ROUND_SECONDS,
  RUNNING_BONUS,
  RUNNING_SPEED,
  SHOT_ORIGIN_TOLERANCE,
  STREAK_STEP
} from '../shared/config'
import { fallDuration, pigeonPose } from '../shared/flight'
import { GameEvent, room } from '../shared/messages'
import {
  PigeonPhase,
  PigeonState,
  PlayerScore,
  RoundPhase,
  RoundState,
  ServerClock
} from '../shared/schemas'

// ---------------------------------------------------------------------------
// The Multiplayer Server: owns rounds, pigeons, hits, catches, steals and scores.
// ---------------------------------------------------------------------------

const TICK = 0.1 // seconds between rule updates
const CLOCK_EVERY = 1.0 // seconds between clock pulses (doubles as the liveness heartbeat)
const PLAYER_GONE_AFTER = 20 // seconds before a departed player's score is removed

type PlayerInfo = {
  address: string
  name: string
  scoreEntity: Entity | null
  position: Vector3 | null
  lastPosition: Vector3 | null
  lastSeen: number // server ms
  speed: number
  present: boolean
}

const players = new Map<string, PlayerInfo>()
const pigeons: Entity[] = []
let roundEntity: Entity
let clockEntity: Entity

export function initServer() {
  console.log('[SERVER] Pigeon Shooter server starting')
  try {
    setupServerState()
  } catch (e) {
    console.error('[SERVER] Failed to start: ' + String(e) + ' ' + ((e as Error)?.stack ?? ''))
    throw e
  }
  console.log('[SERVER] Ready: ' + PIGEON_COUNT + ' pigeons, waiting for players')
}

function setupServerState() {
  const now = Date.now()

  roundEntity = engine.addEntity()
  RoundState.create(roundEntity, { phase: RoundPhase.Waiting, endsAt: now, round: 0 })
  syncEntity(roundEntity, [RoundState.componentId])

  clockEntity = engine.addEntity()
  ServerClock.create(clockEntity, { now })
  syncEntity(clockEntity, [ServerClock.componentId])

  for (let i = 0; i < PIGEON_COUNT; i++) {
    const e = engine.addEntity()
    PigeonState.create(e, {
      slot: i,
      phase: PigeonPhase.Idle,
      cannon: 0,
      seed: 0,
      t0: now + 1e9,
      sx: 0,
      sy: 0,
      sz: 0,
      owner: '',
      golden: false
    })
    syncEntity(e, [PigeonState.componentId])
    pigeons.push(e)
  }

  room.onMessage('hello', (data, context) => {
    if (!context) return
    const p = getPlayer(context.from)
    const name = (data.name || '').trim().slice(0, 24)
    if (name) p.name = name
    ensureScore(p)
    const s = PlayerScore.getMutable(p.scoreEntity!)
    s.name = p.name
  })

  room.onMessage('shoot', (data, context) => {
    if (!context) return
    handleShot(context.from, data)
  })

  // Timed from Date.now() rather than the frame dt, so the pace never depends on how the headless runtime ticks
  let lastTick = 0
  let lastClock = 0
  let lastStatus = 0
  let errorCount = 0
  engine.addSystem(() => {
    const t = Date.now()
    if (t - lastClock >= CLOCK_EVERY * 1000) {
      lastClock = t
      ServerClock.getMutable(clockEntity).now = t
    }
    if (t - lastStatus >= 10000) {
      lastStatus = t
      const r = RoundState.get(roundEntity)
      console.log('[SERVER] status: players=' + presentPlayers().length + ' known=' + players.size + ' round=' + r.round + ' phase=' + r.phase)
    }
    if (t - lastTick < TICK * 1000) return
    lastTick = t
    // Log and carry on rather than let one bad tick take the server down for everyone
    try {
      updatePlayers(t)
      updateRound(t)
      updatePigeons(t)
    } catch (e) {
      errorCount++
      if (errorCount <= 5) console.error('[SERVER] Tick failed: ' + String(e) + ' ' + ((e as Error)?.stack ?? ''))
    }
  })
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
function getPlayer(address: string): PlayerInfo {
  const key = address.toLowerCase()
  let p = players.get(key)
  if (!p) {
    p = {
      address: key,
      name: 'Player ' + key.slice(-4),
      scoreEntity: null,
      position: null,
      lastPosition: null,
      lastSeen: Date.now(),
      speed: 0,
      present: true
    }
    players.set(key, p)
  }
  return p
}

function nextColour(): number {
  const used = new Set<number>()
  for (const p of players.values()) {
    if (p.scoreEntity && PlayerScore.has(p.scoreEntity)) used.add(PlayerScore.get(p.scoreEntity).colour)
  }
  for (let i = 0; i < PLAYER_COLOURS.length; i++) if (!used.has(i)) return i
  return players.size % PLAYER_COLOURS.length
}

function ensureScore(p: PlayerInfo) {
  if (p.scoreEntity && PlayerScore.getOrNull(p.scoreEntity)) return
  const e = engine.addEntity()
  PlayerScore.create(e, {
    address: p.address,
    name: p.name,
    colour: nextColour(),
    score: 0,
    shotStreak: 0,
    catchStreak: 0,
    shots: 0,
    hits: 0,
    catches: 0,
    grabs: 0,
    best: 0
  })
  syncEntity(e, [PlayerScore.componentId])
  p.scoreEntity = e
}

function updatePlayers(now: number) {
  const seen = new Set<string>()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const key = identity.address.toLowerCase()
    seen.add(key)
    const p = getPlayer(key)
    p.present = true
    const tr = Transform.getOrNull(entity)
    if (tr) {
      const pos = Vector3.clone(tr.position)
      if (p.position) {
        const dtSec = Math.max(0.05, (now - p.lastSeen) / 1000)
        const flat = Math.hypot(pos.x - p.position.x, pos.z - p.position.z)
        p.speed = p.speed * 0.5 + (flat / dtSec) * 0.5
      }
      p.lastPosition = p.position
      p.position = pos
    }
    p.lastSeen = now
    ensureScore(p)
  }
  for (const p of players.values()) {
    if (seen.has(p.address)) continue
    p.present = false
    if (now - p.lastSeen > PLAYER_GONE_AFTER * 1000) {
      if (p.scoreEntity) engine.removeEntity(p.scoreEntity)
      players.delete(p.address)
    }
  }
}

function presentPlayers(): PlayerInfo[] {
  return [...players.values()].filter((p) => p.present)
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
function broadcast(e: Partial<GameEvent> & { kind: string }, to?: string[]) {
  const full: GameEvent = {
    kind: e.kind,
    who: e.who ?? '',
    whoName: e.whoName ?? '',
    other: e.other ?? '',
    otherName: e.otherName ?? '',
    points: e.points ?? 0,
    multiplier: e.multiplier ?? 1,
    slot: e.slot ?? -1,
    x: e.x ?? 0,
    y: e.y ?? 0,
    z: e.z ?? 0
  }
  void room.send('event', full, to ? { to } : undefined)
}

function startRound(now: number) {
  const r = RoundState.getMutable(roundEntity)
  r.phase = RoundPhase.Playing
  r.endsAt = now + ROUND_SECONDS * 1000
  r.round += 1
  for (const p of players.values()) {
    if (!p.scoreEntity) continue
    const s = PlayerScore.getMutableOrNull(p.scoreEntity)
    if (!s) continue
    s.score = 0
    s.shotStreak = 0
    s.catchStreak = 0
    s.shots = 0
    s.hits = 0
    s.catches = 0
    s.grabs = 0
  }
  for (const e of pigeons) {
    const st = PigeonState.getMutable(e)
    st.phase = PigeonPhase.Idle
    st.owner = ''
    st.t0 = now + Math.random() * FIRST_LAUNCH_SPREAD * 1000
  }
  console.log('[SERVER] Round ' + r.round + ' started with ' + presentPlayers().length + ' player(s)')
  broadcast({ kind: 'roundStart' })
}

function endRound(now: number) {
  const r = RoundState.getMutable(roundEntity)
  r.phase = RoundPhase.Break
  r.endsAt = now + BREAK_SECONDS * 1000
  for (const e of pigeons) {
    const st = PigeonState.getMutable(e)
    st.phase = PigeonPhase.Idle
    st.owner = ''
    st.t0 = now + 1e9
  }
  for (const p of players.values()) {
    if (!p.scoreEntity) continue
    const s = PlayerScore.getMutableOrNull(p.scoreEntity)
    if (s && s.score > s.best) s.best = s.score
  }
  console.log('[SERVER] Round ' + r.round + ' ended')
  broadcast({ kind: 'roundEnd' })
}

function updateRound(now: number) {
  const r = RoundState.get(roundEntity)
  const count = presentPlayers().length
  if (r.phase === RoundPhase.Waiting) {
    if (count >= MIN_PLAYERS_TO_START) startRound(now)
  } else if (r.phase === RoundPhase.Playing) {
    if (count === 0) {
      endRound(now)
      RoundState.getMutable(roundEntity).phase = RoundPhase.Waiting
    } else if (now >= r.endsAt) endRound(now)
  } else if (r.phase === RoundPhase.Break) {
    if (now >= r.endsAt) {
      if (count >= MIN_PLAYERS_TO_START) startRound(now)
      else RoundState.getMutable(roundEntity).phase = RoundPhase.Waiting
    }
  }
}

// ---------------------------------------------------------------------------
// Pigeons
// ---------------------------------------------------------------------------
function relaunchDelay(): number {
  return (RELAUNCH_MIN + Math.random() * (RELAUNCH_MAX - RELAUNCH_MIN)) * 1000
}

function setIdle(e: Entity, now: number) {
  const st = PigeonState.getMutable(e)
  st.phase = PigeonPhase.Idle
  st.owner = ''
  st.t0 = now + relaunchDelay()
}

function scoreOf(address: string) {
  const p = players.get(address)
  if (!p || !p.scoreEntity) return null
  return PlayerScore.getMutableOrNull(p.scoreEntity)
}

function nameOf(address: string): string {
  return players.get(address)?.name ?? 'Someone'
}

function horizontalDistance(a: Vector3, x: number, z: number): number {
  return Math.hypot(a.x - x, a.z - z)
}

function updatePigeons(now: number) {
  const playing = RoundState.get(roundEntity).phase === RoundPhase.Playing
  for (const e of pigeons) {
    const st = PigeonState.get(e)
    const tau = (now - st.t0) / 1000

    if (st.phase === PigeonPhase.Idle) {
      if (!playing || now < st.t0) continue
      const m = PigeonState.getMutable(e)
      m.phase = PigeonPhase.Launch
      m.cannon = Math.floor(Math.random() * CANNONS.length)
      m.seed = Math.floor(Math.random() * 2147483647)
      m.t0 = now
      m.owner = ''
      m.golden = Math.random() < GOLDEN_CHANCE
    } else if (st.phase === PigeonPhase.Launch) {
      if (tau >= LAUNCH_TIME) {
        const m = PigeonState.getMutable(e)
        m.phase = PigeonPhase.Flying
        m.t0 = st.t0 + LAUNCH_TIME * 1000
      }
    } else if (st.phase === PigeonPhase.Falling) {
      const landAfter = fallDuration(st.sy)
      const pose = pigeonPose(st, now)
      // Only the shooter can catch it in the air
      const owner = players.get(st.owner)
      if (owner && owner.present && owner.position && pose.position.y <= CATCH_HEIGHT) {
        if (horizontalDistance(owner.position, st.sx, st.sz) <= CATCH_RADIUS) {
          awardCatch(st.owner, st.slot, st.golden, st.sx, st.sz)
          setIdle(e, now)
          continue
        }
      }
      if (tau >= landAfter) {
        const m = PigeonState.getMutable(e)
        m.phase = PigeonPhase.Landed
        m.t0 = st.t0 + Math.round(landAfter * 1000)
        // Missed catch: the shooter's catch streak ends
        const s = scoreOf(st.owner)
        if (s) s.catchStreak = 0
        broadcast({ kind: 'lost', who: st.owner, whoName: nameOf(st.owner), slot: st.slot, x: st.sx, y: 0, z: st.sz })
      }
    } else if (st.phase === PigeonPhase.Landed) {
      // Anyone can grab a landed pigeon, the shooter included
      let grabber: PlayerInfo | null = null
      let best = GRAB_RADIUS
      for (const p of presentPlayers()) {
        if (!p.position) continue
        const d = horizontalDistance(p.position, st.sx, st.sz)
        if (d <= best) {
          best = d
          grabber = p
        }
      }
      if (grabber && playing) {
        awardGrab(grabber.address, st.owner, st.slot, st.golden, st.sx, st.sz)
        setIdle(e, now)
      } else if (tau >= GROUND_SECONDS) {
        setIdle(e, now)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shooting and scoring
// ---------------------------------------------------------------------------
function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number): number {
  const ox = o.x - c.x
  const oy = o.y - c.y
  const oz = o.z - c.z
  const b = ox * d.x + oy * d.y + oz * d.z
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - cc
  if (disc < 0) return -1
  const sq = Math.sqrt(disc)
  let t = -b - sq
  if (t < 0) t = -b + sq
  return t
}

function handleShot(
  from: string,
  data: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }
) {
  const now = Date.now()
  if (RoundState.get(roundEntity).phase !== RoundPhase.Playing) return
  const shooter = getPlayer(from)
  ensureScore(shooter)
  const score = PlayerScore.getMutable(shooter.scoreEntity!)
  score.shots += 1

  const origin = Vector3.create(data.ox, data.oy, data.oz)
  if (shooter.position) {
    if (Vector3.distance(origin, shooter.position) > SHOT_ORIGIN_TOLERANCE) {
      console.log('[SERVER] Rejected shot from ' + shooter.address + ': gun too far from player')
      return
    }
  } else {
    console.log('[SERVER] No server position for ' + shooter.address + ', accepting reported gun position')
  }
  const len = Math.hypot(data.dx, data.dy, data.dz)
  if (!(len > 0.0001)) return
  const dir = Vector3.create(data.dx / len, data.dy / len, data.dz / len)

  // Find the nearest parachute along the ray, now or a moment ago (lag compensation)
  let bestT = Infinity
  let bestEntity: Entity | null = null
  let bestPos: Vector3 | null = null
  for (const e of pigeons) {
    const st = PigeonState.get(e)
    const flyingNow = st.phase === PigeonPhase.Flying || (st.phase === PigeonPhase.Launch && now - st.t0 >= LAUNCH_TIME * 1000)
    if (!flyingNow) continue
    for (const back of LAG_COMPENSATION) {
      const at = now - back * 1000
      const pose = pigeonPose(st, at)
      const t = raySphere(origin, dir, pose.position, HIT_RADIUS)
      if (t >= 0 && t <= MAX_SHOT_DISTANCE && t < bestT) {
        bestT = t
        bestEntity = e
        bestPos = pigeonPose(st, now).position
      }
    }
  }

  if (!bestEntity || !bestPos) {
    score.shotStreak = 0
    broadcast({ kind: 'miss', who: shooter.address, whoName: shooter.name }, [shooter.address])
    return
  }

  const st = PigeonState.get(bestEntity)
  const multiplier = Math.min(MAX_SHOT_MULTIPLIER, 1 + STREAK_STEP * score.shotStreak)
  const longBonus = Math.min(LONG_SHOT_MAX_BONUS, Math.max(0, (bestT - LONG_SHOT_FROM) / LONG_SHOT_SPAN) * LONG_SHOT_MAX_BONUS)
  const runBonus = shooter.speed >= RUNNING_SPEED ? RUNNING_BONUS : 0
  const golden = st.golden ? GOLDEN_MULTIPLIER : 1
  const points = Math.round(POINTS_HIT * multiplier * (1 + longBonus) * (1 + runBonus) * golden)
  score.score += points
  score.hits += 1
  score.shotStreak += 1

  const m = PigeonState.getMutable(bestEntity)
  m.phase = PigeonPhase.Falling
  m.t0 = now
  // The fall is tracked at the pigeon's feet, which hang below the canopy centre
  m.sx = bestPos.x
  m.sy = Math.max(0, bestPos.y - CANOPY_CENTRE * PIGEON_SCALE)
  m.sz = bestPos.z
  m.owner = shooter.address

  broadcast({
    kind: 'hit',
    who: shooter.address,
    whoName: shooter.name,
    points,
    multiplier,
    slot: st.slot,
    x: bestPos.x,
    y: bestPos.y,
    z: bestPos.z
  })
}

function awardCatch(address: string, slot: number, golden: boolean, x: number, z: number) {
  const s = scoreOf(address)
  if (!s) return
  const multiplier = Math.min(MAX_CATCH_MULTIPLIER, 1 + STREAK_STEP * s.catchStreak)
  const points = Math.round(POINTS_CATCH * multiplier * (golden ? GOLDEN_MULTIPLIER : 1))
  s.score += points
  s.catches += 1
  s.catchStreak += 1
  broadcast({ kind: 'catch', who: address, whoName: nameOf(address), points, multiplier, slot, x, y: 0, z })
}

function awardGrab(address: string, owner: string, slot: number, golden: boolean, x: number, z: number) {
  const s = scoreOf(address)
  if (!s) return
  const points = Math.round(POINTS_GRAB * (golden ? GOLDEN_MULTIPLIER : 1))
  s.score += points
  s.grabs += 1
  const stolen = owner !== '' && owner !== address
  broadcast({
    kind: stolen ? 'steal' : 'grab',
    who: address,
    whoName: nameOf(address),
    other: owner,
    otherName: owner ? nameOf(owner) : '',
    points,
    slot,
    x,
    y: 0,
    z
  })
}
