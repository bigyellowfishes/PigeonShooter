import { engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
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
import { GameEvent, PigeonWire, room, ScoreWire } from '../shared/messages'
import { PigeonPhase, RoundPhase } from '../shared/phases'

/**
 * The Pigeon Shooter server. Runs only on the Multiplayer Server (see main() in
 * index.ts), never in a player's client. Built the same way as Pixel Golf's
 * ledger: all state lives in memory here and goes out to the scenes as
 * messages; nothing is a synced component.
 *
 * It owns the rounds, the pigeons, every hit, catch and steal, and the scores.
 * Players report where they are a few times a second; their shots arrive as
 * rays, and the server decides what each one hit.
 */

const TICK_MS = 100 // rule updates
const ROUND_PULSE_MS = 1000 // the round message doubles as the clock and the heartbeat
const PRESENCE_MS = 10000 // a player counts as here this long after their last message
const FORGET_MS = 60000 // and is forgotten this long after it
const MAX_SPEED = 30 // m/s; reported positions moving faster than this are ignored

type Player = {
  address: string
  name: string
  colour: number
  position: Vector3 | null
  lastPosAt: number
  lastSeen: number
  speed: number
  score: ScoreWire
}

const players = new Map<string, Player>()
const pigeons: PigeonWire[] = []
const round = { phase: RoundPhase.Waiting as number, endsAt: 0, round: 0 }

let pigeonsDirty = true
let scoresDirty = true
let roundDirty = true

const now = () => Date.now()

export function runServer(): void {
  console.log('[SERVER] Pigeon Shooter server starting')

  for (let i = 0; i < PIGEON_COUNT; i++) {
    pigeons.push({ slot: i, phase: PigeonPhase.Idle, cannon: 0, seed: 0, t0: 0, sx: 0, sy: 0, sz: 0, owner: '', golden: false })
  }

  room.onMessage('hello', (data, context) => {
    const address = context?.from
    if (!address) return
    const p = getPlayer(address)
    p.lastSeen = now()
    const name = (data.name || '').trim().slice(0, 24)
    if (name && name !== p.name) {
      p.name = name
      p.score.name = name
      scoresDirty = true
    }
    // Everything a newcomer needs to draw the arena as it is right now
    sendRound([address])
    void room.send('pigeons', { json: JSON.stringify(pigeons) }, { to: [address] })
    void room.send('scores', { json: JSON.stringify(scoreList()) }, { to: [address] })
  })

  room.onMessage('pos', (data, context) => {
    const address = context?.from
    if (!address) return
    const p = getPlayer(address)
    const t = now()
    const pos = Vector3.create(data.x, data.y, data.z)
    if (p.position && p.lastPosAt > 0) {
      const dt = Math.max(0.05, (t - p.lastPosAt) / 1000)
      const flat = Math.hypot(pos.x - p.position.x, pos.z - p.position.z)
      const speed = flat / dt
      if (speed > MAX_SPEED && dt < 2) return // a jump this big isn't running; ignore it
      p.speed = p.speed * 0.5 + speed * 0.5
    }
    p.position = pos
    p.lastPosAt = t
    p.lastSeen = t
  })

  room.onMessage('shoot', (data, context) => {
    const address = context?.from
    if (!address) return
    handleShot(address, data)
  })

  let lastTick = 0
  let lastPulse = 0
  let lastStatus = 0
  let errors = 0
  engine.addSystem(() => {
    const t = now()
    if (t - lastTick < TICK_MS) return
    lastTick = t
    try {
      updatePlayers(t)
      updateRound(t)
      updatePigeons(t)
      if (roundDirty || t - lastPulse >= ROUND_PULSE_MS) {
        roundDirty = false
        lastPulse = t
        sendRound()
      }
      if (pigeonsDirty) {
        pigeonsDirty = false
        void room.send('pigeons', { json: JSON.stringify(pigeons) })
      }
      if (scoresDirty) {
        scoresDirty = false
        void room.send('scores', { json: JSON.stringify(scoreList()) })
      }
      if (t - lastStatus >= 10000) {
        lastStatus = t
        console.log('[SERVER] status: players=' + present().length + ' round=' + round.round + ' phase=' + round.phase)
      }
    } catch (e) {
      errors++
      if (errors <= 5) console.error('[SERVER] tick failed: ' + String(e))
    }
  })

  console.log('[SERVER] ready, waiting for players')
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
function getPlayer(address: string): Player {
  const key = address.toLowerCase()
  let p = players.get(key)
  if (!p) {
    const name = 'Player ' + key.slice(-4)
    const colour = nextColour()
    p = {
      address: key,
      name,
      colour,
      position: null,
      lastPosAt: 0,
      lastSeen: now(),
      speed: 0,
      score: { address: key, name, colour, score: 0, shotStreak: 0, catchStreak: 0, shots: 0, hits: 0, catches: 0, grabs: 0, best: 0 }
    }
    players.set(key, p)
    scoresDirty = true
  }
  return p
}

function nextColour(): number {
  const used = new Set<number>()
  for (const p of players.values()) used.add(p.colour)
  for (let i = 0; i < PLAYER_COLOURS.length; i++) if (!used.has(i)) return i
  return players.size % PLAYER_COLOURS.length
}

function present(): Player[] {
  const t = now()
  return [...players.values()].filter((p) => t - p.lastSeen <= PRESENCE_MS)
}

function updatePlayers(t: number) {
  for (const p of [...players.values()]) {
    if (t - p.lastSeen > FORGET_MS) {
      players.delete(p.address)
      scoresDirty = true
    }
  }
}

function scoreList(): ScoreWire[] {
  return [...players.values()].map((p) => p.score)
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------
function sendRound(to?: string[]) {
  void room.send('round', { phase: round.phase, endsAt: round.endsAt, round: round.round, now: now() }, to ? { to } : undefined)
}

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

function startRound(t: number) {
  round.phase = RoundPhase.Playing
  round.endsAt = t + ROUND_SECONDS * 1000
  round.round += 1
  roundDirty = true
  for (const p of players.values()) {
    const s = p.score
    s.score = 0
    s.shotStreak = 0
    s.catchStreak = 0
    s.shots = 0
    s.hits = 0
    s.catches = 0
    s.grabs = 0
  }
  scoresDirty = true
  for (const pg of pigeons) {
    pg.phase = PigeonPhase.Idle
    pg.owner = ''
    pg.t0 = t + Math.random() * FIRST_LAUNCH_SPREAD * 1000
  }
  pigeonsDirty = true
  console.log('[SERVER] round ' + round.round + ' started with ' + present().length + ' player(s)')
  broadcast({ kind: 'roundStart' })
}

function endRound(t: number, next: number) {
  round.phase = next
  round.endsAt = t + BREAK_SECONDS * 1000
  roundDirty = true
  for (const pg of pigeons) {
    pg.phase = PigeonPhase.Idle
    pg.owner = ''
    pg.t0 = t + 1e9
  }
  pigeonsDirty = true
  for (const p of players.values()) if (p.score.score > p.score.best) p.score.best = p.score.score
  scoresDirty = true
  console.log('[SERVER] round ' + round.round + ' ended')
  broadcast({ kind: 'roundEnd' })
}

function updateRound(t: number) {
  const count = present().length
  if (round.phase === RoundPhase.Waiting) {
    if (count >= MIN_PLAYERS_TO_START) startRound(t)
  } else if (round.phase === RoundPhase.Playing) {
    if (count === 0) endRound(t, RoundPhase.Waiting)
    else if (t >= round.endsAt) endRound(t, RoundPhase.Break)
  } else if (round.phase === RoundPhase.Break) {
    if (t >= round.endsAt) {
      if (count >= MIN_PLAYERS_TO_START) startRound(t)
      else {
        round.phase = RoundPhase.Waiting
        roundDirty = true
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pigeons
// ---------------------------------------------------------------------------
function setIdle(pg: PigeonWire, t: number) {
  pg.phase = PigeonPhase.Idle
  pg.owner = ''
  pg.t0 = t + (RELAUNCH_MIN + Math.random() * (RELAUNCH_MAX - RELAUNCH_MIN)) * 1000
  pigeonsDirty = true
}

function horizontalDistance(a: Vector3, x: number, z: number): number {
  return Math.hypot(a.x - x, a.z - z)
}

function updatePigeons(t: number) {
  const playing = round.phase === RoundPhase.Playing
  for (const pg of pigeons) {
    const tau = (t - pg.t0) / 1000

    if (pg.phase === PigeonPhase.Idle) {
      if (!playing || t < pg.t0) continue
      pg.phase = PigeonPhase.Launch
      pg.cannon = Math.floor(Math.random() * CANNONS.length)
      pg.seed = Math.floor(Math.random() * 2147483647)
      pg.t0 = t
      pg.owner = ''
      pg.golden = Math.random() < GOLDEN_CHANCE
      pigeonsDirty = true
    } else if (pg.phase === PigeonPhase.Launch) {
      if (tau >= LAUNCH_TIME) {
        pg.phase = PigeonPhase.Flying
        pg.t0 = pg.t0 + LAUNCH_TIME * 1000
        pigeonsDirty = true
      }
    } else if (pg.phase === PigeonPhase.Falling) {
      const landAfter = fallDuration(pg.sy)
      const pose = pigeonPose(pg, t)
      // Only the shooter can catch it in the air
      const owner = players.get(pg.owner)
      if (owner && owner.position && t - owner.lastSeen <= PRESENCE_MS && pose.position.y <= CATCH_HEIGHT) {
        if (horizontalDistance(owner.position, pg.sx, pg.sz) <= CATCH_RADIUS) {
          awardCatch(owner, pg)
          setIdle(pg, t)
          continue
        }
      }
      if (tau >= landAfter) {
        pg.phase = PigeonPhase.Landed
        pg.t0 = pg.t0 + Math.round(landAfter * 1000)
        pigeonsDirty = true
        // A missed catch ends the shooter's catch streak
        if (owner) {
          owner.score.catchStreak = 0
          scoresDirty = true
        }
        broadcast({ kind: 'lost', who: pg.owner, whoName: owner?.name ?? '', slot: pg.slot, x: pg.sx, y: 0, z: pg.sz })
      }
    } else if (pg.phase === PigeonPhase.Landed) {
      // Anyone can grab a landed pigeon, the shooter included
      let grabber: Player | null = null
      let best = GRAB_RADIUS
      for (const p of present()) {
        if (!p.position) continue
        const d = horizontalDistance(p.position, pg.sx, pg.sz)
        if (d <= best) {
          best = d
          grabber = p
        }
      }
      if (grabber && playing) {
        awardGrab(grabber, pg)
        setIdle(pg, t)
      } else if (tau >= GROUND_SECONDS) {
        setIdle(pg, t)
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

function handleShot(from: string, data: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }) {
  const t = now()
  if (round.phase !== RoundPhase.Playing) return
  const shooter = getPlayer(from)
  shooter.lastSeen = t
  const score = shooter.score
  score.shots += 1
  scoresDirty = true

  const origin = Vector3.create(data.ox, data.oy, data.oz)
  if (shooter.position && Vector3.distance(origin, shooter.position) > SHOT_ORIGIN_TOLERANCE) {
    console.log('[SERVER] ignored a shot from ' + shooter.address + ': gun too far from the player')
    return
  }
  const len = Math.hypot(data.dx, data.dy, data.dz)
  if (!(len > 0.0001)) return
  const dir = Vector3.create(data.dx / len, data.dy / len, data.dz / len)

  // The nearest parachute along the ray, now or a moment ago (to allow for lag)
  let bestT = Infinity
  let hit: PigeonWire | null = null
  for (const pg of pigeons) {
    const flying = pg.phase === PigeonPhase.Flying || (pg.phase === PigeonPhase.Launch && t - pg.t0 >= LAUNCH_TIME * 1000)
    if (!flying) continue
    for (const back of LAG_COMPENSATION) {
      const pose = pigeonPose(pg, t - back * 1000)
      const d = raySphere(origin, dir, pose.position, HIT_RADIUS)
      if (d >= 0 && d <= MAX_SHOT_DISTANCE && d < bestT) {
        bestT = d
        hit = pg
      }
    }
  }

  if (!hit) {
    score.shotStreak = 0
    broadcast({ kind: 'miss', who: shooter.address, whoName: shooter.name }, [from])
    return
  }

  const at = pigeonPose(hit, t).position
  const multiplier = Math.min(MAX_SHOT_MULTIPLIER, 1 + STREAK_STEP * score.shotStreak)
  const longBonus = Math.min(LONG_SHOT_MAX_BONUS, (Math.max(0, bestT - LONG_SHOT_FROM) / LONG_SHOT_SPAN) * LONG_SHOT_MAX_BONUS)
  const runBonus = shooter.speed >= RUNNING_SPEED ? RUNNING_BONUS : 0
  const points = Math.round(POINTS_HIT * multiplier * (1 + longBonus) * (1 + runBonus) * (hit.golden ? GOLDEN_MULTIPLIER : 1))
  score.score += points
  score.hits += 1
  score.shotStreak += 1

  // The fall is tracked at the pigeon's feet, which hang below the canopy centre
  hit.phase = PigeonPhase.Falling
  hit.t0 = t
  hit.sx = at.x
  hit.sy = Math.max(0, at.y - CANOPY_CENTRE * PIGEON_SCALE)
  hit.sz = at.z
  hit.owner = shooter.address
  pigeonsDirty = true

  broadcast({ kind: 'hit', who: shooter.address, whoName: shooter.name, points, multiplier, slot: hit.slot, x: at.x, y: at.y, z: at.z })
}

function awardCatch(p: Player, pg: PigeonWire) {
  const s = p.score
  const multiplier = Math.min(MAX_CATCH_MULTIPLIER, 1 + STREAK_STEP * s.catchStreak)
  const points = Math.round(POINTS_CATCH * multiplier * (pg.golden ? GOLDEN_MULTIPLIER : 1))
  s.score += points
  s.catches += 1
  s.catchStreak += 1
  scoresDirty = true
  broadcast({ kind: 'catch', who: p.address, whoName: p.name, points, multiplier, slot: pg.slot, x: pg.sx, y: 0, z: pg.sz })
}

function awardGrab(p: Player, pg: PigeonWire) {
  const s = p.score
  const points = Math.round(POINTS_GRAB * (pg.golden ? GOLDEN_MULTIPLIER : 1))
  s.score += points
  s.grabs += 1
  scoresDirty = true
  const owner = players.get(pg.owner)
  const stolen = pg.owner !== '' && pg.owner !== p.address
  broadcast({
    kind: stolen ? 'steal' : 'grab',
    who: p.address,
    whoName: p.name,
    other: pg.owner,
    otherName: owner?.name ?? '',
    points,
    slot: pg.slot,
    x: pg.sx,
    y: 0,
    z: pg.sz
  })
}
