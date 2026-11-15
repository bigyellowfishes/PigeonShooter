import { Vector3 } from '@dcl/sdk/math'

// ---------------------------------------------------------------------------
// Game tuning. Shared by the server (rules) and the clients (visuals), so both
// always agree. Times are in seconds unless the name says ms.
// ---------------------------------------------------------------------------

// Rounds
export const ROUND_SECONDS = 60
export const BREAK_SECONDS = 15
export const MIN_PLAYERS_TO_START = 1 // GDD: a solo player can play rounds against their own best

// Pigeons
export const PIGEON_COUNT = 8 // cap on pigeons in the arena at once
export const RELAUNCH_MIN = 1.0 // delay before an idle pigeon is fired again
export const RELAUNCH_MAX = 4.0
export const FIRST_LAUNCH_SPREAD = 6.0 // stagger the first volley of a round
export const LAUNCH_TIME = 2.0 // cannon to the start of the circling path
export const LAUNCH_ARC_HEIGHT = 28 // how far above the straight line the launch arc bulges
export const GOLDEN_CHANCE = 0 // 0..1, Golden Hour turns this up later

// Circling flight (pigeons keep circling until shot)
export const ARENA_CENTRE = Vector3.create(256, 0, 256)
export const FLIGHT_RADIUS = 30
export const FLIGHT_RADIUS_WOBBLE = 12
export const FLIGHT_HEIGHT = 46
export const FLIGHT_HEIGHT_WOBBLE = 7
export const FLIGHT_ANGULAR_SPEED = 0.26 // radians per second around the arena

// Falling and landing
export const FALL_START_SPEED = 6 // m/s straight after the parachute is popped
export const FALL_ACCEL = 3 // m/s^2, so a pigeon popped at 46 m takes about 4 s to land
export const CATCH_HEIGHT = 4 // a falling pigeon can be caught below this height
export const CATCH_RADIUS = 3 // horizontal distance from the landing spot that counts as a catch
export const GROUND_SECONDS = 8 // how long a landed pigeon waits to be grabbed
export const GRAB_RADIUS = 2.5 // horizontal distance to grab a landed pigeon

// Shooting
export const HIT_RADIUS = 3.0 // hit sphere around the canopy centre (canopy is about 4.5 m across)
export const MAX_SHOT_DISTANCE = 250
export const SHOT_ORIGIN_TOLERANCE = 8 // how far the reported gun position may be from the server's player position
export const LAG_COMPENSATION = [0, 0.1, 0.2, 0.3] // also test where pigeons were this many seconds ago

// Scoring
export const POINTS_HIT = 100
export const POINTS_CATCH = 150
export const POINTS_GRAB = 75 // a landed pigeon is worth half a catch
export const STREAK_STEP = 0.5 // each hit (or catch) in a row adds this to the multiplier
export const MAX_SHOT_MULTIPLIER = 4
export const MAX_CATCH_MULTIPLIER = 3
export const LONG_SHOT_FROM = 25 // metres; longer shots earn a bonus
export const LONG_SHOT_MAX_BONUS = 0.6 // +60% at 85 m or more
export const LONG_SHOT_SPAN = 60
export const RUNNING_SPEED = 3 // m/s; shooting while moving faster than this
export const RUNNING_BONUS = 0.25 // earns +25%
export const GOLDEN_MULTIPLIER = 2

// Visuals
export const PIGEON_SCALE = 4 // the model is real pigeon size, scaled up for the arena
export const CANOPY_CENTRE = 1.27 // canopy centre above the pigeon's feet, in model units
export const BODY_CENTRE = 0.25 // pigeon body centre above its feet, in model units

// Cannon muzzle positions in scene coordinates, index 0 = Cannon 01
export const CANNONS: { name: string; muzzle: Vector3 }[] = [
  { name: 'Cannon 01', muzzle: Vector3.create(232.26, 15.24, 344.61) },
  { name: 'Cannon 02', muzzle: Vector3.create(191.14, 15.24, 320.86) },
  { name: 'Cannon 03', muzzle: Vector3.create(167.39, 15.24, 279.74) },
  { name: 'Cannon 04', muzzle: Vector3.create(167.39, 15.24, 232.26) },
  { name: 'Cannon 05', muzzle: Vector3.create(191.14, 15.24, 191.14) },
  { name: 'Cannon 06', muzzle: Vector3.create(232.26, 15.24, 167.39) },
  { name: 'Cannon 07', muzzle: Vector3.create(279.74, 15.24, 167.39) },
  { name: 'Cannon 08', muzzle: Vector3.create(320.86, 15.24, 191.14) },
  { name: 'Cannon 09', muzzle: Vector3.create(344.61, 15.24, 232.26) },
  { name: 'Cannon 10', muzzle: Vector3.create(344.61, 15.24, 279.74) },
  { name: 'Cannon 11', muzzle: Vector3.create(320.86, 15.24, 320.86) },
  { name: 'Cannon 12', muzzle: Vector3.create(279.74, 15.24, 344.61) }
]

// Each player gets a bright colour: their popped pigeon's landing shadow and their name in the scoreboard
export const PLAYER_COLOURS: [number, number, number][] = [
  [1.0, 0.27, 0.27],
  [0.25, 0.55, 1.0],
  [0.3, 0.85, 0.35],
  [1.0, 0.78, 0.1],
  [0.75, 0.35, 1.0],
  [1.0, 0.5, 0.15],
  [0.15, 0.85, 0.85],
  [1.0, 0.4, 0.75]
]
