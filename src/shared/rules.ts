import { Vector3 } from '@dcl/sdk/math'

// ---------------------------------------------------------------------------
// The round economy, guns, perks, cosmetics, levels, Golden Hour and the week.
// Shared by the server (which decides) and the scenes (which show it), so both
// read the same numbers. Every balance number in the game outside config.ts is
// here, so tuning is one file.
// ---------------------------------------------------------------------------

// ===========================================================================
// Budget and Feathers
// ===========================================================================

/** Everyone gets this to spend, however last round went (GDD H2-05) */
export const BUDGET_BASE = 300

/** Last round's score becomes next round's budget, on a curve so a big score helps but doesn't snowball */
export function budgetFromScore(score: number): number {
  const s = Math.max(0, score)
  const first = Math.min(s, 2000) * 0.75
  const second = Math.max(0, Math.min(s, 6000) - 2000) * 0.35
  return Math.round(BUDGET_BASE + first + second)
}

/** Budget left unspent when a round starts turns into Feathers at this rate, capped per round */
export const FEATHER_RATE = 0.05
export const FEATHERS_PER_ROUND_CAP = 100
/** A round played alone converts at half rate, so farming an empty arena is slow */
export const SOLO_FEATHER_FACTOR = 0.5

export function feathersFromUnspent(unspent: number, solo: boolean): number {
  const f = Math.min(FEATHERS_PER_ROUND_CAP, Math.floor(Math.max(0, unspent) * FEATHER_RATE))
  return solo ? Math.floor(f * SOLO_FEATHER_FACTOR) : f
}

// ===========================================================================
// Guns. Each trades one strength for another, so the free pistol can still win.
// ===========================================================================

export type GunId = 'pistol' | 'shotgun' | 'sniper'

export type Gun = {
  id: GunId
  name: string
  price: number
  blurb: string
  model: string
  /** seconds between shots (the server ignores faster ones) */
  cooldown: number
  /** hit sphere radius around a canopy, per pellet */
  radius: number
  range: number
  /** pellet directions as [degrees off the aim, degrees round it] */
  pellets: [number, number][]
  /** one shot pops every parachute along its line */
  pierce: boolean
  /** hand placement: position in the right-hand anchor and scale */
  hold: { x: number; y: number; z: number; scale: number }
}

export const GUNS: Record<GunId, Gun> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    price: 0,
    blurb: 'Accurate all-rounder. Free every round.',
    model: 'assets/Models/Pistol/PS_Pistol.glb',
    cooldown: 0.35,
    radius: 3.0,
    range: 250,
    pellets: [[0, 0]],
    pierce: false,
    hold: { x: 0.05, y: 0.1, z: -0.05, scale: 1.2 }
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    price: 500,
    blurb: 'Wide spread, short range. Pops crowded volleys.',
    model: 'assets/Models/Shotgun/PS_Shotgun.glb',
    cooldown: 0.9,
    radius: 2.4,
    range: 80,
    pellets: [
      [0, 0],
      [4.5, 0],
      [4.5, 60],
      [4.5, 120],
      [4.5, 180],
      [4.5, 240],
      [4.5, 300]
    ],
    pierce: false,
    hold: { x: 0.05, y: 0.1, z: -0.05, scale: 1.1 }
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    price: 700,
    blurb: 'Slow, long, pierces every chute in its line.',
    model: 'assets/Models/Sniper/PS_Sniper.glb',
    cooldown: 1.6,
    radius: 1.8,
    range: 400,
    pellets: [[0, 0]],
    pierce: true,
    hold: { x: 0.05, y: 0.1, z: -0.05, scale: 1.0 }
  }
}

export const GUN_ORDER: GunId[] = ['pistol', 'shotgun', 'sniper']

export function gunOf(id: string): Gun {
  return GUNS[id as GunId] ?? GUNS.pistol
}

/** The directions a gun's pellets fly for one aim direction. Fixed patterns, so the server and the scene agree. */
export function pelletDirections(aim: Vector3, gun: Gun): Vector3[] {
  const d = Vector3.normalize(aim)
  const up = Math.abs(d.y) > 0.95 ? Vector3.create(1, 0, 0) : Vector3.create(0, 1, 0)
  const right = Vector3.normalize(Vector3.cross(up, d))
  const up2 = Vector3.cross(d, right)
  return gun.pellets.map(([off, round]) => {
    if (off === 0) return d
    const a = (off * Math.PI) / 180
    const r = (round * Math.PI) / 180
    const side = Vector3.add(Vector3.scale(right, Math.cos(r)), Vector3.scale(up2, Math.sin(r)))
    return Vector3.normalize(Vector3.add(Vector3.scale(d, Math.cos(a)), Vector3.scale(side, Math.sin(a))))
  })
}

// ===========================================================================
// Perks. Each changes the round for everyone in the arena. You buy them in the
// break, hold up to 3, and fire them whenever you like during the round. At most
// 3 are active in the arena at once, and the same perk can't run twice at once.
// ===========================================================================

export type PerkId = 'windy' | 'slow' | 'bigvolleys' | 'decoys' | 'goldenrush'

export type Perk = { id: PerkId; name: string; price: number; blurb: string; tint: 'blue' | 'green' | 'gold' | 'grey' | 'orange' }

export const PERKS: Record<PerkId, Perk> = {
  windy: { id: 'windy', name: 'Windy', price: 400, blurb: 'Every parachute drifts for 20 s', tint: 'blue' },
  slow: { id: 'slow', name: 'Slow Chutes', price: 400, blurb: 'Pigeons fly and fall at half speed', tint: 'green' },
  bigvolleys: { id: 'bigvolleys', name: 'Big Volleys', price: 600, blurb: 'The cannons fire 6 extra pigeons', tint: 'orange' },
  decoys: { id: 'decoys', name: 'Decoys', price: 500, blurb: 'Grey decoys join: popping one breaks your streak', tint: 'grey' },
  goldenrush: { id: 'goldenrush', name: 'Golden Rush', price: 800, blurb: 'A third of new pigeons are golden, x2', tint: 'gold' }
}

export const PERK_ORDER: PerkId[] = ['windy', 'slow', 'bigvolleys', 'decoys', 'goldenrush']

export const PERK_SECONDS = 20
export const MAX_ACTIVE_PERKS = 3
export const MAX_HELD_PERKS = 3

/** A perk running in the arena (server ms) */
export type ArenaPerk = { id: PerkId; by: string; byName: string; start: number; end: number }

export function isPerk(id: string): id is PerkId {
  return id in PERKS
}

// Windy: parachutes drift together on a gust, each with its own sway
export const WIND_STRENGTH = 12 // metres of drift at full gust
export const WIND_SWAY = 4
const WIND_RAMP = 3 // seconds to build up and die down

function smooth01(u: number): number {
  const x = Math.max(0, Math.min(1, u))
  return x * x * (3 - 2 * x)
}

/** How far a flying pigeon is blown at serverMs. Zero when no Windy is running. */
export function windOffset(perks: ArenaPerk[], seed: number, serverMs: number): Vector3 {
  let x = 0
  let z = 0
  let y = 0
  for (const p of perks) {
    if (p.id !== 'windy' || serverMs < p.start || serverMs > p.end) continue
    const ramp = smooth01((serverMs - p.start) / 1000 / WIND_RAMP) * smooth01((p.end - serverMs) / 1000 / WIND_RAMP)
    const t = (serverMs - p.start) / 1000
    const dir = ((p.start % 3600) / 3600) * Math.PI * 2 // each gust blows its own way
    const phase = (seed % 1000) / 159
    const gust = WIND_STRENGTH * (0.65 + 0.35 * Math.sin(0.7 * t + phase))
    const sway = WIND_SWAY * Math.sin(1.3 * t + phase * 2)
    x += ramp * (Math.cos(dir) * gust - Math.sin(dir) * sway)
    z += ramp * (Math.sin(dir) * gust + Math.cos(dir) * sway)
    y += ramp * 1.5 * Math.sin(0.9 * t + phase)
  }
  return Vector3.create(x, y, z)
}

// Slow Chutes: time runs at this rate for flying pigeons while it's on
export const SLOW_RATE = 0.5

/** Seconds lost to Slow Chutes between two server times (flying pigeons move on effective time) */
export function slowedSeconds(perks: ArenaPerk[], fromMs: number, toMs: number): number {
  let lost = 0
  for (const p of perks) {
    if (p.id !== 'slow') continue
    const a = Math.max(fromMs, p.start)
    const b = Math.min(toMs, p.end)
    if (b > a) lost += ((b - a) / 1000) * (1 - SLOW_RATE)
  }
  return lost
}

export function perkActive(perks: ArenaPerk[], id: PerkId, serverMs: number): boolean {
  return perks.some((p) => p.id === id && serverMs >= p.start && serverMs < p.end)
}

// Big Volleys and Decoys use their own pigeon slots, after the normal ones
export const VOLLEY_EXTRA = 6
export const DECOY_COUNT = 4
export const DECOY_PENALTY = 50

// ===========================================================================
// Pigeon variety
// ===========================================================================
export enum PigeonKind {
  Normal = 0,
  Fast = 1,
  ZigZag = 2
}
export const FAST_CHANCE = 0.15
export const ZIGZAG_CHANCE = 0.15
export const KIND_BONUS = 1.5 // fast and zig-zag pigeons are worth more
export const CRATE_CHANCE = 0.07 // a crate pigeon drops a free perk to whoever collects it
export const CRATE_FULL_POINTS = 100 // collected with 3 perks already held: points instead

// Golden pigeons
export const GOLDEN_HOUR_CHANCE = 0.15
export const GOLDEN_RUSH_CHANCE = 0.35

// ===========================================================================
// Golden Hour: every day 19:00 to 20:00 UTC
// ===========================================================================
export const GOLDEN_HOUR_UTC = 19
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

export function goldenHourActive(ms: number): boolean {
  return new Date(ms).getUTCHours() === GOLDEN_HOUR_UTC
}

/** When the next Golden Hour starts (or the current one started, if it's on) */
export function goldenHourStart(ms: number): number {
  const day = Math.floor(ms / DAY) * DAY
  const today = day + GOLDEN_HOUR_UTC * HOUR
  if (ms < today + HOUR) return today
  return today + DAY
}

// ===========================================================================
// The week: the scoreboard resets every Monday 00:00 UTC
// ===========================================================================
export function weekStart(ms: number): number {
  const day = Math.floor(ms / DAY) * DAY
  const dow = new Date(day).getUTCDay() // 0 Sunday
  const sinceMonday = (dow + 6) % 7
  return day - sinceMonday * DAY
}

export function weekId(ms: number): string {
  const d = new Date(weekStart(ms))
  const m = d.getUTCMonth() + 1
  const dd = d.getUTCDate()
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd
}

export function weekEnds(ms: number): number {
  return weekStart(ms) + 7 * DAY
}

export const WEEK_BOARD_SIZE = 50
export const TOP3_FOR_GOLDEN_TRIM = 3

// ===========================================================================
// Levels: from every point you score, forever
// ===========================================================================
export function xpForLevel(level: number): number {
  return 500 * (level - 1) * level
}

export function levelFromXp(xp: number): number {
  let lv = 1
  while (xpForLevel(lv + 1) <= xp && lv < 99) lv++
  return lv
}

// ===========================================================================
// Cosmetics: status, never power. Unlocked by level, bought with Feathers, or
// earned (the golden trim and the Ace title: weekly top 3, three times).
// ===========================================================================
export type CosmeticKind = 'paint' | 'trace' | 'title'

export type Cosmetic = {
  id: string
  kind: CosmeticKind
  name: string
  colour: [number, number, number]
  level?: number
  cost?: number
  earned?: 'top3x3'
}

const hex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255
]

export const COSMETICS: Cosmetic[] = [
  { id: 'paint:navy', kind: 'paint', name: 'Navy', colour: hex('#2B4A7A'), level: 1 },
  { id: 'paint:red', kind: 'paint', name: 'Red', colour: hex('#E8453C'), level: 3 },
  { id: 'paint:sky', kind: 'paint', name: 'Sky', colour: hex('#3F8CFF'), level: 5 },
  { id: 'paint:grass', kind: 'paint', name: 'Grass', colour: hex('#4DB84A'), level: 8 },
  { id: 'paint:pink', kind: 'paint', name: 'Bubblegum', colour: hex('#FF7AC8'), cost: 200 },
  { id: 'paint:mint', kind: 'paint', name: 'Mint', colour: hex('#7FE0C4'), cost: 250 },
  { id: 'paint:midnight', kind: 'paint', name: 'Midnight', colour: hex('#20232A'), cost: 300 },
  { id: 'paint:gold', kind: 'paint', name: 'Golden trim', colour: hex('#F2C230'), earned: 'top3x3' },

  { id: 'trace:yellow', kind: 'trace', name: 'Yellow', colour: hex('#FFE14D'), level: 1 },
  { id: 'trace:white', kind: 'trace', name: 'White', colour: hex('#FFFFFF'), level: 4 },
  { id: 'trace:red', kind: 'trace', name: 'Red', colour: hex('#FF5A4F'), cost: 100 },
  { id: 'trace:blue', kind: 'trace', name: 'Blue', colour: hex('#4FB3FF'), cost: 100 },
  { id: 'trace:green', kind: 'trace', name: 'Green', colour: hex('#6BE36B'), cost: 150 },
  { id: 'trace:purple', kind: 'trace', name: 'Purple', colour: hex('#B06BFF'), cost: 200 },
  { id: 'trace:orange', kind: 'trace', name: 'Orange', colour: hex('#FF9A3D'), cost: 200 },
  { id: 'trace:pink', kind: 'trace', name: 'Pink', colour: hex('#FF8FD1'), cost: 250 },

  { id: 'title:none', kind: 'title', name: 'No title', colour: hex('#F4F7F9'), level: 1 },
  { id: 'title:rookie', kind: 'title', name: 'Rookie', colour: hex('#D6F2FC'), level: 2 },
  { id: 'title:sharpshooter', kind: 'title', name: 'Sharpshooter', colour: hex('#FFE58A'), level: 10 },
  { id: 'title:thief', kind: 'title', name: 'Pigeon Thief', colour: hex('#FFC9C4'), cost: 400 },
  { id: 'title:ace', kind: 'title', name: 'Ace', colour: hex('#F2C230'), earned: 'top3x3' }
]

export const DEFAULT_LOOK = { paint: 'paint:navy', trace: 'trace:yellow', title: 'title:none' }

export function cosmeticById(id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.id === id)
}

/** Whether a player has a cosmetic: bought, unlocked by level, or earned */
export function hasCosmetic(c: Cosmetic, owned: string[], level: number, top3Weeks: number): boolean {
  if (owned.indexOf(c.id) >= 0) return true
  if (c.earned === 'top3x3') return top3Weeks >= TOP3_FOR_GOLDEN_TRIM
  if (c.cost) return false
  return (c.level ?? 1) <= level
}

// ===========================================================================
// What the server sends each player about themselves ('me' message, JSON)
// ===========================================================================
export type MeWire = {
  ready: boolean // the saved profile has loaded
  budget: number
  gun: GunId
  perks: PerkId[]
  lastShotAt: number
  xp: number
  level: number
  feathers: number
  owned: string[]
  paint: string
  trace: string
  title: string
  top3Weeks: number
  weekBest: number
}

/** The arena: running perks and the clock for Golden Hour and the week ('arena' message, JSON) */
export type ArenaWire = {
  perks: ArenaPerk[]
  golden: boolean
  goldenAt: number
  weekId: string
  weekEnds: number
}

/** The weekly scoreboard ('board' message, JSON) */
export type BoardEntry = { a: string; n: string; s: number; lv: number }
export type BoardWire = { weekId: string; entries: BoardEntry[] }
