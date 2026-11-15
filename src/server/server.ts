import { engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { Storage } from '@dcl/sdk/server'
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
  LAG_COMPENSATION,
  LAUNCH_TIME,
  LONG_SHOT_FROM,
  LONG_SHOT_MAX_BONUS,
  LONG_SHOT_SPAN,
  MAX_CATCH_MULTIPLIER,
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
import { fallDuration, launchProgress, pigeonPose } from '../shared/flight'
import { GameEvent, PigeonWire, room, ScoreWire } from '../shared/messages'
import { PigeonPhase, RoundPhase } from '../shared/phases'
import {
  ArenaPerk,
  ArenaWire,
  BoardEntry,
  BoardWire,
  BUDGET_BASE,
  budgetFromScore,
  cosmeticById,
  CRATE_CHANCE,
  CRATE_FULL_POINTS,
  DECOY_COUNT,
  DECOY_PENALTY,
  DEFAULT_LOOK,
  FAST_CHANCE,
  feathersFromUnspent,
  GOLDEN_HOUR_CHANCE,
  GOLDEN_RUSH_CHANCE,
  goldenHourActive,
  goldenHourStart,
  GUNS,
  gunOf,
  GunId,
  hasCosmetic,
  isPerk,
  KIND_BONUS,
  levelFromXp,
  MAX_ACTIVE_PERKS,
  MAX_HELD_PERKS,
  MeWire,
  PERK_ORDER,
  PERK_SECONDS,
  PerkId,
  perkActive,
  PERKS,
  pelletDirections,
  PigeonKind,
  VOLLEY_EXTRA,
  WEEK_BOARD_SIZE,
  weekEnds,
  weekId,
  ZIGZAG_CHANCE
} from '../shared/rules'

/**
 * The Pigeon Shooter server. Runs only on the Multiplayer Server (see main() in
 * index.ts), never in a player's client. Built the same way as Pixel Golf's
 * ledger: all state lives in memory here and goes out to the scenes as
 * messages; nothing is a synced component. What must outlive the server (each
 * player's level, Feathers and cosmetics, and the weekly scoreboard) is kept in
 * Storage and written at checkpoints: the end of a round and a cosmetic bought.
 *
 * It owns the rounds, the pigeons, every hit, catch and steal, the scores, the
 * shop and the perks. Players report where they are a few times a second; their
 * shots arrive as rays, and the server decides what each one hit.
 */

const TICK_MS = 100 // rule updates
const ROUND_PULSE_MS = 1000 // the round message doubles as the clock and the heartbeat
const PRESENCE_MS = 10000 // a player counts as here this long after their last message
const FORGET_MS = 60000 // and is forgotten this long after it
const MAX_SPEED = 30 // m/s; reported positions moving faster than this are ignored
const PROFILE_RETRY_MS = 30000 // try a failed profile read again after this long
const PROFILE_KEY = 'profile'
const WEEK_KEY = (id: string) => 'week:' + id

// Pigeon slots: the normal ones, then Big Volleys' extras, then the decoys
const VOLLEY_FIRST = PIGEON_COUNT
const DECOY_FIRST = PIGEON_COUNT + VOLLEY_EXTRA
const SLOT_COUNT = DECOY_FIRST + DECOY_COUNT

type Profile = {
  v: number
  xp: number
  feathers: number
  owned: string[]
  paint: string
  trace: string
  title: string
  top3Weeks: string[]
}

type Player = {
  address: string
  name: string
  colour: number
  position: Vector3 | null
  lastPosAt: number
  lastSeen: number
  speed: number
  score: ScoreWire
  // This round's shop
  budget: number
  budgetSet: boolean // has been given a budget for the coming round
  gun: GunId
  perks: PerkId[]
  lastShotAt: number
  // Saved between visits
  profile: Profile
  loaded: boolean
  loading: boolean
  loadFailedAt: number
  profileDirty: boolean
  weekBest: number
  meDirty: boolean
}

const players = new Map<string, Player>()
const pigeons: PigeonWire[] = []
const round = { phase: RoundPhase.Waiting as number, endsAt: 0, round: 0 }
let arenaPerks: ArenaPerk[] = []
let board: BoardWire = { weekId: weekId(Date.now()), entries: [] }
let boardLoaded = false
let boardDirty = false
let lastGolden = false

let pigeonsDirty = true
let scoresDirty = true
let roundDirty = true
let arenaDirty = true
let boardSendDirty = true

const now = () => Date.now()

function emptyProfile(): Profile {
  return { v: 1, xp: 0, feathers: 0, owned: [], paint: DEFAULT_LOOK.paint, trace: DEFAULT_LOOK.trace, title: DEFAULT_LOOK.title, top3Weeks: [] }
}

export function runServer(): void {
  console.log('[SERVER] Pigeon Shooter server starting')

  for (let i = 0; i < SLOT_COUNT; i++) {
    pigeons.push({ slot: i, phase: PigeonPhase.Idle, cannon: 0, seed: 0, t0: 0, sx: 0, sy: 0, sz: 0, owner: '', golden: false })
  }
  lastGolden = goldenHourActive(now())
  void loadBoard(board.weekId)

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
    // Arriving between rounds: everyone gets the base budget to spend
    if (round.phase !== RoundPhase.Playing && !p.budgetSet) {
      p.budget = BUDGET_BASE
      p.budgetSet = true
    }
    if (!p.loaded && !p.loading) void loadProfile(p)
    // Everything a newcomer needs to draw the arena as it is right now
    const to = [p.address]
    sendRound(to)
    void room.send('pigeons', { json: JSON.stringify(pigeons) }, { to })
    void room.send('scores', { json: JSON.stringify(scoreList()) }, { to })
    void room.send('arena', { json: JSON.stringify(arenaWire()) }, { to })
    void room.send('board', { json: JSON.stringify(board) }, { to })
    p.meDirty = true
  })

  room.onMessage('pos', (data, context) => {
    const address = context?.from
    if (!address) return
    const p = getPlayer(address)
    const t = now()
    const pos = Vector3.create(data.x, data.y, data.z)
    if (p.position && p.lastPosAt > 0) {
      const dt = Math.max(0.05, (t - p.lastPosAt) / 1000)
      const speed = Math.hypot(pos.x - p.position.x, pos.z - p.position.z) / dt
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

  room.onMessage('buy', (data, context) => {
    const address = context?.from
    if (!address) return
    handleBuy(getPlayer(address), String(data.item || ''))
  })

  room.onMessage('fire', (data, context) => {
    const address = context?.from
    if (!address) return
    handleFire(getPlayer(address), String(data.perk || ''))
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
      updatePerks(t)
      updatePigeons(t)
      flush(t, lastPulse)
      if (roundDirty || t - lastPulse >= ROUND_PULSE_MS) lastPulse = t
      roundDirty = false
      if (t - lastStatus >= 10000) {
        lastStatus = t
        console.log('[SERVER] status: players=' + present().length + ' round=' + round.round + ' phase=' + round.phase + ' perks=' + arenaPerks.length)
      }
    } catch (e) {
      errors++
      if (errors <= 5) console.error('[SERVER] tick failed: ' + String(e))
    }
  })

  console.log('[SERVER] ready, waiting for players')
}

// Send whatever changed this tick
function flush(t: number, lastPulse: number) {
  if (roundDirty || t - lastPulse >= ROUND_PULSE_MS) sendRound()
  if (pigeonsDirty) {
    pigeonsDirty = false
    void room.send('pigeons', { json: JSON.stringify(pigeons) })
  }
  if (scoresDirty) {
    scoresDirty = false
    void room.send('scores', { json: JSON.stringify(scoreList()) })
  }
  if (arenaDirty) {
    arenaDirty = false
    void room.send('arena', { json: JSON.stringify(arenaWire()) })
  }
  if (boardSendDirty) {
    boardSendDirty = false
    void room.send('board', { json: JSON.stringify(board) })
  }
  for (const p of players.values()) {
    if (!p.meDirty) continue
    p.meDirty = false
    void room.send('me', { json: JSON.stringify(meWire(p)) }, { to: [p.address] })
  }
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
      score: { address: key, name, colour, score: 0, shotStreak: 0, catchStreak: 0, shots: 0, hits: 0, catches: 0, grabs: 0, best: 0 },
      budget: 0,
      budgetSet: false,
      gun: 'pistol',
      perks: [],
      lastShotAt: 0,
      profile: emptyProfile(),
      loaded: false,
      loading: false,
      loadFailedAt: 0,
      profileDirty: false,
      weekBest: 0,
      meDirty: true
    }
    const onBoard = board.entries.find((e) => e.a === key)
    if (onBoard) p.weekBest = onBoard.s
    players.set(key, p)
    refreshLook(p)
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
    if (!p.loaded && !p.loading && p.loadFailedAt > 0 && t - p.loadFailedAt > PROFILE_RETRY_MS && t - p.lastSeen <= PRESENCE_MS) {
      void loadProfile(p)
    }
    if (t - p.lastSeen > FORGET_MS) {
      void saveProfile(p)
      players.delete(p.address)
      scoresDirty = true
    }
  }
}

function scoreList(): ScoreWire[] {
  return [...players.values()].map((p) => p.score)
}

function level(p: Player): number {
  return levelFromXp(p.profile.xp)
}

/** What other players see of someone: their level, gun and cosmetics */
function refreshLook(p: Player) {
  const s = p.score
  s.level = level(p)
  s.gun = p.gun
  s.paint = p.profile.paint
  s.trace = p.profile.trace
  s.title = p.profile.title
  scoresDirty = true
}

function meWire(p: Player): MeWire {
  return {
    ready: p.loaded,
    budget: p.budget,
    gun: p.gun,
    perks: p.perks,
    lastShotAt: p.lastShotAt,
    xp: p.profile.xp,
    level: level(p),
    feathers: p.profile.feathers,
    owned: p.profile.owned,
    paint: p.profile.paint,
    trace: p.profile.trace,
    title: p.profile.title,
    top3Weeks: p.profile.top3Weeks.length,
    weekBest: p.weekBest
  }
}

// ---------------------------------------------------------------------------
// Saved profiles. Anything earned before the saved profile loads is kept in
// memory and added on top once it does, and nothing is written until then, so
// a slow or failed read never overwrites a real save with an empty one.
// ---------------------------------------------------------------------------
async function loadProfile(p: Player) {
  p.loading = true
  try {
    const stored = await Storage.player.get<Profile>(p.address, PROFILE_KEY)
    const earned = p.profile
    const base: Profile = stored ? { ...emptyProfile(), ...stored } : emptyProfile()
    base.xp += earned.xp
    base.feathers += earned.feathers
    for (const id of earned.owned) if (base.owned.indexOf(id) < 0) base.owned.push(id)
    for (const w of earned.top3Weeks) if (base.top3Weeks.indexOf(w) < 0) base.top3Weeks.push(w)
    p.profile = base
    p.loaded = true
    p.profileDirty = earned.xp > 0 || earned.feathers > 0 || earned.owned.length > 0 || earned.top3Weeks.length > 0
    refreshLook(p)
    p.meDirty = true
  } catch (e) {
    p.loadFailedAt = now()
    console.log('[SERVER] profile read failed for ' + p.address + ': ' + String(e))
  }
  p.loading = false
}

async function saveProfile(p: Player) {
  if (!p.loaded || !p.profileDirty) return
  p.profileDirty = false
  try {
    const ok = await Storage.player.set(p.address, PROFILE_KEY, p.profile)
    if (!ok) {
      p.profileDirty = true
      console.log('[SERVER] profile write not saved for ' + p.address)
    }
  } catch (e) {
    p.profileDirty = true
    console.log('[SERVER] profile write failed for ' + p.address + ': ' + String(e))
  }
}

// ---------------------------------------------------------------------------
// The weekly scoreboard: each player's best single round this week
// ---------------------------------------------------------------------------
async function loadBoard(id: string) {
  try {
    const stored = await Storage.get<BoardWire>(WEEK_KEY(id))
    if (board.weekId !== id) return
    if (stored && Array.isArray(stored.entries)) {
      // Keep anything scored while the read was in flight
      const merged = new Map<string, BoardEntry>()
      for (const e of stored.entries) merged.set(e.a, e)
      for (const e of board.entries) {
        const old = merged.get(e.a)
        if (!old || e.s > old.s) merged.set(e.a, e)
      }
      board.entries = sortBoard([...merged.values()])
      for (const p of players.values()) {
        const mine = board.entries.find((e) => e.a === p.address)
        if (mine && mine.s > p.weekBest) {
          p.weekBest = mine.s
          p.meDirty = true
        }
      }
      boardSendDirty = true
    }
    boardLoaded = true
  } catch (e) {
    console.log('[SERVER] weekly board read failed: ' + String(e))
    boardLoaded = true // play on; the next write merges over whatever is stored
  }
}

function sortBoard(entries: BoardEntry[]): BoardEntry[] {
  return entries.sort((a, b) => b.s - a.s).slice(0, WEEK_BOARD_SIZE)
}

async function saveBoard() {
  if (!boardDirty || !boardLoaded) return
  boardDirty = false
  const snapshot: BoardWire = { weekId: board.weekId, entries: board.entries.slice() }
  try {
    const ok = await Storage.set(WEEK_KEY(snapshot.weekId), snapshot)
    if (!ok) boardDirty = true
  } catch (e) {
    boardDirty = true
    console.log('[SERVER] weekly board write failed: ' + String(e))
  }
}

/** Monday 00:00 UTC: the top 3 of the week that ended count towards the golden trim, and a new board starts */
async function rollWeek(t: number) {
  const id = weekId(t)
  if (id === board.weekId) return
  const ended = board
  console.log('[SERVER] week ' + ended.weekId + ' ended; new week ' + id)
  for (const e of ended.entries.slice(0, 3)) {
    const online = players.get(e.a)
    if (online && online.loaded) {
      if (online.profile.top3Weeks.indexOf(ended.weekId) < 0) {
        online.profile.top3Weeks.push(ended.weekId)
        online.profileDirty = true
        online.meDirty = true
      }
      continue
    }
    try {
      const stored = await Storage.player.get<Profile>(e.a, PROFILE_KEY)
      const prof: Profile = stored ? { ...emptyProfile(), ...stored } : emptyProfile()
      if (prof.top3Weeks.indexOf(ended.weekId) < 0) {
        prof.top3Weeks.push(ended.weekId)
        await Storage.player.set(e.a, PROFILE_KEY, prof)
      }
    } catch (err) {
      console.log('[SERVER] could not record a weekly top 3 for ' + e.a + ': ' + String(err))
    }
  }
  board = { weekId: id, entries: [] }
  boardLoaded = false
  for (const p of players.values()) {
    p.weekBest = 0
    p.meDirty = true
  }
  boardSendDirty = true
  arenaDirty = true
  await loadBoard(id)
}

function recordWeekScore(p: Player) {
  const s = p.score.score
  if (s <= 0) return
  if (s > p.weekBest) {
    p.weekBest = s
    p.meDirty = true
  }
  const e = board.entries.find((x) => x.a === p.address)
  if (e) {
    if (s <= e.s && e.n === p.name) return
    e.s = Math.max(e.s, s)
    e.n = p.name
    e.lv = level(p)
  } else {
    board.entries.push({ a: p.address, n: p.name, s, lv: level(p) })
  }
  board.entries = sortBoard(board.entries)
  boardDirty = true
  boardSendDirty = true
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
  const here = present()
  const solo = here.length < 2
  for (const p of players.values()) {
    // The budget wipes: whatever is left becomes Feathers
    const here_ = here.indexOf(p) >= 0
    if (here_ && p.budget > 0) {
      const f = feathersFromUnspent(p.budget, solo)
      if (f > 0) {
        p.profile.feathers += f
        p.profileDirty = true
        broadcast({ kind: 'feathers', who: p.address, whoName: p.name, points: f }, [p.address])
      }
    }
    p.budget = 0
    p.budgetSet = false
    p.lastShotAt = 0
    p.meDirty = true
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
  arenaPerks = []
  arenaDirty = true
  for (const pg of pigeons) {
    pg.phase = PigeonPhase.Idle
    pg.owner = ''
    pg.t0 = pg.slot < PIGEON_COUNT ? t + Math.random() * FIRST_LAUNCH_SPREAD * 1000 : t + 1e9
  }
  pigeonsDirty = true
  console.log('[SERVER] round ' + round.round + ' started with ' + here.length + ' player(s)')
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
  arenaPerks = []
  arenaDirty = true
  const here = present()
  for (const p of players.values()) {
    const s = p.score
    if (s.score > s.best) s.best = s.score
    if (s.score > 0) {
      p.profile.xp += s.score
      p.profileDirty = true
      recordWeekScore(p)
    }
    // Next round's budget from this round's score; guns and unfired perks go back
    if (here.indexOf(p) >= 0) {
      p.budget = budgetFromScore(s.score)
      p.budgetSet = true
    }
    p.gun = 'pistol'
    p.perks = []
    refreshLook(p)
    p.meDirty = true
    void saveProfile(p)
  }
  scoresDirty = true
  void saveBoard()
  void rollWeek(t)
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
// Shop and perks
// ---------------------------------------------------------------------------
function refuse(p: Player, why: string) {
  broadcast({ kind: 'refused', who: p.address, otherName: why }, [p.address])
}

function handleBuy(p: Player, item: string) {
  p.lastSeen = now()
  const [kind, ...rest] = item.split(':')
  const id = rest.join(':')
  const shopOpen = round.phase !== RoundPhase.Playing

  if (kind === 'gun') {
    const gun = GUNS[id as GunId]
    if (!gun) return
    if (!shopOpen) return refuse(p, 'The shop opens between rounds')
    if (p.gun === gun.id) return
    // Swapping guns refunds the one you had
    const refund = GUNS[p.gun].price
    if (p.budget + refund < gun.price) return refuse(p, 'Not enough budget')
    p.budget = p.budget + refund - gun.price
    p.gun = gun.id
    refreshLook(p)
    p.meDirty = true
    return
  }

  if (kind === 'perk') {
    if (!isPerk(id)) return
    const perk = PERKS[id]
    if (!shopOpen) return refuse(p, 'The shop opens between rounds')
    if (p.perks.length >= MAX_HELD_PERKS) return refuse(p, 'You can hold 3 perks')
    if (p.budget < perk.price) return refuse(p, 'Not enough budget')
    p.budget -= perk.price
    p.perks.push(perk.id)
    p.meDirty = true
    return
  }

  if (kind === 'cos' || kind === 'wear') {
    const c = cosmeticById(id)
    if (!c) return
    if (!p.loaded) return refuse(p, 'Still loading your locker')
    const lv = level(p)
    const owned = hasCosmetic(c, p.profile.owned, lv, p.profile.top3Weeks.length)
    if (!owned) {
      if (kind === 'wear' || !c.cost) return refuse(p, c.earned ? 'Earned in the weekly top 3' : 'Unlocks at level ' + (c.level ?? 1))
      if (p.profile.feathers < c.cost) return refuse(p, 'Not enough Feathers')
      p.profile.feathers -= c.cost
      p.profile.owned.push(c.id)
    }
    if (c.kind === 'paint') p.profile.paint = c.id
    else if (c.kind === 'trace') p.profile.trace = c.id
    else p.profile.title = c.id
    p.profileDirty = true
    refreshLook(p)
    p.meDirty = true
    void saveProfile(p)
  }
}

function handleFire(p: Player, id: string) {
  p.lastSeen = now()
  if (!isPerk(id)) return
  const t = now()
  if (round.phase !== RoundPhase.Playing) return
  const at = p.perks.indexOf(id)
  if (at < 0) return
  const running = arenaPerks.filter((x) => t < x.end)
  if (running.length >= MAX_ACTIVE_PERKS) return refuse(p, '3 perks are already running')
  if (running.some((x) => x.id === id)) return refuse(p, PERKS[id].name + ' is already running')
  p.perks.splice(at, 1)
  p.meDirty = true
  const end = Math.min(t + PERK_SECONDS * 1000, round.endsAt)
  arenaPerks.push({ id, by: p.address, byName: p.name, start: t, end })
  arenaDirty = true
  // Big Volleys and Decoys start their pigeons straight away, staggered
  if (id === 'bigvolleys') {
    for (let i = VOLLEY_FIRST; i < DECOY_FIRST; i++) {
      const pg = pigeons[i]
      if (pg.phase === PigeonPhase.Idle) pg.t0 = t + (i - VOLLEY_FIRST) * 350
    }
  }
  if (id === 'decoys') {
    for (let i = DECOY_FIRST; i < SLOT_COUNT; i++) {
      const pg = pigeons[i]
      if (pg.phase === PigeonPhase.Idle) pg.t0 = t + (i - DECOY_FIRST) * 600
    }
  }
  console.log('[SERVER] ' + p.name + ' fired ' + id)
  broadcast({ kind: 'perk', who: p.address, whoName: p.name, other: id, otherName: PERKS[id].name })
}

function updatePerks(t: number) {
  const before = arenaPerks.length
  arenaPerks = arenaPerks.filter((x) => t < x.end)
  if (arenaPerks.length !== before) {
    arenaDirty = true
    // Decoys vanish when their perk ends
    if (!perkActive(arenaPerks, 'decoys', t)) {
      for (let i = DECOY_FIRST; i < SLOT_COUNT; i++) {
        const pg = pigeons[i]
        if (pg.phase === PigeonPhase.Launch || pg.phase === PigeonPhase.Flying) {
          pg.phase = PigeonPhase.Idle
          pg.t0 = t + 1e9
          pigeonsDirty = true
        }
      }
    }
  }
  const golden = goldenHourActive(t)
  if (golden !== lastGolden) {
    lastGolden = golden
    arenaDirty = true
    broadcast({ kind: golden ? 'goldenStart' : 'goldenEnd' })
  }
}

function arenaWire(): ArenaWire {
  const t = now()
  return { perks: arenaPerks, golden: goldenHourActive(t), goldenAt: goldenHourStart(t), weekId: board.weekId, weekEnds: weekEnds(t) }
}

// ---------------------------------------------------------------------------
// Pigeons
// ---------------------------------------------------------------------------
function slotKind(slot: number): 'normal' | 'volley' | 'decoy' {
  if (slot >= DECOY_FIRST) return 'decoy'
  if (slot >= VOLLEY_FIRST) return 'volley'
  return 'normal'
}

function setIdle(pg: PigeonWire, t: number) {
  pg.phase = PigeonPhase.Idle
  pg.owner = ''
  const kind = slotKind(pg.slot)
  const quick = kind !== 'normal'
  const min = quick ? 0.5 : RELAUNCH_MIN
  const max = quick ? 1.5 : RELAUNCH_MAX
  pg.t0 = t + (min + Math.random() * (max - min)) * 1000
  pigeonsDirty = true
}

function goldenChance(t: number): number {
  if (perkActive(arenaPerks, 'goldenrush', t)) return GOLDEN_RUSH_CHANCE
  if (goldenHourActive(t)) return GOLDEN_HOUR_CHANCE
  return GOLDEN_CHANCE
}

function launch(pg: PigeonWire, t: number) {
  const decoy = slotKind(pg.slot) === 'decoy'
  pg.phase = PigeonPhase.Launch
  pg.cannon = Math.floor(Math.random() * CANNONS.length)
  pg.seed = Math.floor(Math.random() * 2147483647)
  pg.t0 = t
  pg.owner = ''
  pg.slow = false
  pg.decoy = decoy
  pg.golden = !decoy && Math.random() < goldenChance(t)
  const r = Math.random()
  pg.kind = decoy ? PigeonKind.Normal : r < FAST_CHANCE ? PigeonKind.Fast : r < FAST_CHANCE + ZIGZAG_CHANCE ? PigeonKind.ZigZag : PigeonKind.Normal
  pg.crate = !decoy && !pg.golden && Math.random() < CRATE_CHANCE
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
      const kind = slotKind(pg.slot)
      if (kind === 'volley' && !perkActive(arenaPerks, 'bigvolleys', t)) {
        pg.t0 = t + 1e9
        continue
      }
      if (kind === 'decoy' && !perkActive(arenaPerks, 'decoys', t)) {
        pg.t0 = t + 1e9
        continue
      }
      launch(pg, t)
    } else if (pg.phase === PigeonPhase.Launch) {
      const progress = launchProgress(pg, t, arenaPerks)
      if (progress >= LAUNCH_TIME) {
        // Hand over to Flying at the same spot: circling time starts where the launch ended
        pg.phase = PigeonPhase.Flying
        pg.t0 = t - Math.round((progress - LAUNCH_TIME) * 1000)
        pigeonsDirty = true
      }
    } else if (pg.phase === PigeonPhase.Falling) {
      const landAfter = fallDuration(pg.sy, !!pg.slow)
      const pose = pigeonPose(pg, t, arenaPerks)
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

function canBeShot(pg: PigeonWire, t: number): boolean {
  if (pg.phase === PigeonPhase.Flying) return true
  return pg.phase === PigeonPhase.Launch && launchProgress(pg, t, arenaPerks) >= LAUNCH_TIME
}

/** How far along a ray a pigeon's canopy is, now or a moment ago (to allow for lag); -1 if missed */
function rayHit(origin: Vector3, dir: Vector3, pg: PigeonWire, t: number, radius: number, range: number): number {
  let best = -1
  for (const back of LAG_COMPENSATION) {
    const pose = pigeonPose(pg, t - back * 1000, arenaPerks)
    const d = raySphere(origin, dir, pose.position, radius)
    if (d >= 0 && d <= range && (best < 0 || d < best)) best = d
  }
  return best
}

function handleShot(from: string, data: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }) {
  const t = now()
  if (round.phase !== RoundPhase.Playing) return
  const shooter = getPlayer(from)
  shooter.lastSeen = t
  const gun = gunOf(shooter.gun)
  if (t - shooter.lastShotAt < gun.cooldown * 1000 * 0.8) return // faster than the gun fires
  shooter.lastShotAt = t
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
  const aim = Vector3.create(data.dx / len, data.dy / len, data.dz / len)

  // What each pellet hit. A pellet pops the nearest parachute it meets; the sniper's
  // round goes on through every parachute in its line.
  const hits = new Map<number, number>() // slot -> distance
  for (const dir of pelletDirections(aim, gun)) {
    const along: { pg: PigeonWire; d: number }[] = []
    for (const pg of pigeons) {
      if (!canBeShot(pg, t) || hits.has(pg.slot)) continue
      const d = rayHit(origin, dir, pg, t, gun.radius, gun.range)
      if (d >= 0) along.push({ pg, d })
    }
    along.sort((a, b) => a.d - b.d)
    for (const h of gun.pierce ? along : along.slice(0, 1)) hits.set(h.pg.slot, h.d)
  }

  if (hits.size === 0) {
    score.shotStreak = 0
    broadcast({ kind: 'miss', who: shooter.address, whoName: shooter.name }, [from])
    return
  }

  const ordered = [...hits.entries()].sort((a, b) => a[1] - b[1])
  const slowNow = perkActive(arenaPerks, 'slow', t)
  for (const [slot, dist] of ordered) {
    const hit = pigeons[slot]
    const at = pigeonPose(hit, t, arenaPerks).position

    if (hit.decoy) {
      // A decoy: no points, the streak breaks, and it vanishes in a puff
      score.shotStreak = 0
      const penalty = Math.min(score.score, DECOY_PENALTY)
      score.score -= penalty
      hit.phase = PigeonPhase.Idle
      hit.t0 = t + 1e9
      pigeonsDirty = true
      broadcast({ kind: 'decoy', who: shooter.address, whoName: shooter.name, points: -penalty, slot, x: at.x, y: at.y, z: at.z })
      continue
    }

    const multiplier = Math.min(MAX_SHOT_MULTIPLIER, 1 + STREAK_STEP * score.shotStreak)
    const longBonus = Math.min(LONG_SHOT_MAX_BONUS, (Math.max(0, dist - LONG_SHOT_FROM) / LONG_SHOT_SPAN) * LONG_SHOT_MAX_BONUS)
    const runBonus = shooter.speed >= RUNNING_SPEED ? RUNNING_BONUS : 0
    const kindBonus = hit.kind === PigeonKind.Fast || hit.kind === PigeonKind.ZigZag ? KIND_BONUS : 1
    const points = Math.round(POINTS_HIT * multiplier * (1 + longBonus) * (1 + runBonus) * kindBonus * (hit.golden ? GOLDEN_MULTIPLIER : 1))
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
    hit.slow = slowNow
    pigeonsDirty = true

    broadcast({ kind: 'hit', who: shooter.address, whoName: shooter.name, points, multiplier, slot: hit.slot, x: at.x, y: at.y, z: at.z })
  }
  scoresDirty = true
}

function pigeonValue(pg: PigeonWire): number {
  const kindBonus = pg.kind === PigeonKind.Fast || pg.kind === PigeonKind.ZigZag ? KIND_BONUS : 1
  return kindBonus * (pg.golden ? GOLDEN_MULTIPLIER : 1)
}

/** A crate pigeon gives whoever collects it a free perk (points instead if they already hold 3) */
function openCrate(p: Player, pg: PigeonWire): number {
  if (!pg.crate) return 0
  if (p.perks.length >= MAX_HELD_PERKS) {
    broadcast({ kind: 'crate', who: p.address, whoName: p.name, points: CRATE_FULL_POINTS }, [p.address])
    return CRATE_FULL_POINTS
  }
  const id = PERK_ORDER[Math.floor(Math.random() * PERK_ORDER.length)]
  p.perks.push(id)
  p.meDirty = true
  broadcast({ kind: 'crate', who: p.address, whoName: p.name, other: id, otherName: PERKS[id].name }, [p.address])
  return 0
}

function awardCatch(p: Player, pg: PigeonWire) {
  const s = p.score
  const multiplier = Math.min(MAX_CATCH_MULTIPLIER, 1 + STREAK_STEP * s.catchStreak)
  const points = Math.round(POINTS_CATCH * multiplier * pigeonValue(pg)) + openCrate(p, pg)
  s.score += points
  s.catches += 1
  s.catchStreak += 1
  scoresDirty = true
  broadcast({ kind: 'catch', who: p.address, whoName: p.name, points, multiplier, slot: pg.slot, x: pg.sx, y: 0, z: pg.sz })
}

function awardGrab(p: Player, pg: PigeonWire) {
  const s = p.score
  const points = Math.round(POINTS_GRAB * pigeonValue(pg)) + openCrate(p, pg)
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
