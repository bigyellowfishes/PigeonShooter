// Plain enums with no SDK imports, so the shared maths can be tested outside the engine

export enum PigeonPhase {
  Idle = 0, // hidden, waiting to be fired (t0 = when it may launch)
  Launch = 1, // flying out of a cannon (t0 = launch time)
  Flying = 2, // circling under its parachute (t0 = when circling started)
  Falling = 3, // parachute shot off, dropping (t0 = when it was hit, s* = where)
  Landed = 4 // on the ground, anyone can grab it (t0 = when it landed, s* = where)
}

export enum RoundPhase {
  Waiting = 0, // no players yet
  Playing = 1,
  Break = 2 // scoreboard between rounds
}
