*Work in progress · grown from `gdd-template.md`*
*Doc: `▓▓▓▓▓▓▓▓▓▓` · every section written and signed off · still to fill: contact, Why this game, pigeon asset licence, test phone, two build questions in §9 · ⚑ submission bar: covered · full doc: covered*

# Pigeon Shooter

**Decentraland Creator Success Program**

| | |
|---|---|
| Public experience title | Pigeon Shooter. IP & [Content Policy](https://decentraland.org/content/) self-check: clear (own name and art; the pigeons are Decentraland's own pigeons; clay shooting as an activity is not owned; no animal is harmed). The pigeon is the one from Decentraland's Genesis Plaza asset pack, wearing our own helmet, goggles, backpack and parachute. TBD: confirming the licence for that asset pack |
| Deployment target | bigyellowfishes.dcl.eth, our studio World. Every push to the Testing branch publishes automatically from GitHub. TBD: whether Pigeon Shooter moves to its own World NAME before launch (Pixel Golf deploys to pixelgolf.dcl.eth) |
| Studio / team name | Big Yellow Fishes (4 people, full time) |
| Date | 2026-11-13 |
| Contact (Discord + email) | TBD: same Discord and email as the Pixel Golf GDD, to paste in |

---

## 0. TL;DR

| | |
|---|---|
| **Player promise** | Clay pigeon shooting for the party-game crowd: you pop the parachutes on cannon-fired pigeons, then race rivals to catch them before they land. |
| **Primary player** | For players who already enjoy party games, arriving alone or with friends, looking for quick competitive rounds they can drop into on a phone. |
| **Current status** | Idea. No playable build yet; a first greybox of aim, release and catch is the next step. |
| **Requested round** | v0 (vertical slice) |
| **Live at end of the round** | A player drops into 60-second rounds in our World, pops parachutes, catches and steals pigeons, spends each round's score on guns and perks, and climbs the weekly scoreboard. |

---

## 1. Player Promise

**One-line promise**

> Clay pigeon shooting for the party-game crowd: you pop the parachutes on cannon-fired pigeons, then race rivals to catch them before they land.

**One familiar comparison.** It's like the Shooting Range in Wii Play, but you run around the arena and race rivals to catch what you hit.

**Why this game.** TBD: the same reason as in the Pixel Golf GDD, to paste in

---

## 2. First Minutes & How to Play

| Time | Player experience |
|---|---|
| **0–5 seconds after control** | You spawn on the arena rim, facing in. A cannon booms, a pigeon on a parachute floats across the middle of your screen, and other players are already sprinting under falling pigeons. |
| **5–10 seconds** | You hold, drag onto the parachute and let go. Pop: the pigeon glows your colour and drops towards a shadow on the ground. The goal is clear: pop parachutes, catch pigeons. |
| **10–60 seconds** | You sprint to the shadow and catch it. Points and a multiplier pop up. A rival grabs a pigeon you missed, and their name flashes over it. |
| **1–3 minutes** | The round ends on a scoreboard with your place. Your score becomes your budget for the next round: in the break you buy a shotgun, a sniper or a perk, and whatever you don't spend turns into Feathers. |
| **3–10 minutes** | A rival fires Windy and every parachute starts drifting; you answer with Slow Chutes. A crate pigeon drops a free perk, and fast and zig-zag pigeons join. You choose between spending to win this round and banking Feathers for a cosmetic, and you climb the weekly scoreboard. |
| **Natural stopping point** | The exit board shows your place on the weekly scoreboard, the rival just above you, and the time of tomorrow's Golden Hour. |

[HYPOTHESIS H1-04]

**Player-facing How to Play**

- Hold, aim, release: pop the parachutes
- Catch falling pigeons for bonus points
- Grab landed pigeons before rivals do

---

## 3. Core Loop

| # | Step (verb) | What the player does (Player input → what they see or hear → what changes) | Why do it again? |
|---|---|---|---|
| 1 | Run | You run anywhere inside a circular arena. Cannons all around the edge fire pigeons out across the whole arena. Each pigeon floats on a little parachute. | Pigeons come from every side, so the best spot keeps changing. |
| 2 | Aim | You hold a finger on the screen and drag to aim at a pigeon's parachute. Everyone shoots at the same pigeons. [HYPOTHESIS H1-02] | Every pigeon is a race against the other players. |
| 3 | Shoot | You let go of the screen to fire → you shoot the parachute, not the pigeon, and the pigeon starts to drop. A hit scores points, and several in a row build a multiplier. Far, fast and mid-run shots score more. [HYPOTHESIS H1-01] | Harder shots score more. |
| 4 | Catch | You run under the falling pigeon and collect it before it lands → catching scores points too, with its own multiplier for catches in a row. Only you can catch it in the air: it glows in your colour while it falls. Once it lands, anyone can grab it. [HYPOTHESIS H1-03] | A catch is a bonus on top of the shot, so every hit becomes a chase. |
| 5 | Steal | If a pigeon lands, anyone can grab it, the shooter included. A landed pigeon is worth half a catch, and the shooter keeps the points for the hit. | A dropped pigeon is still up for grabs, so nobody stops running. |

| | |
|---|---|
| **One complete loop takes** | 60 seconds: one timed round. The round ends on a scoreboard, and your score becomes your budget for the next round. Everyone gets a flat base budget plus a share of last round's score on a curve, so a newcomer or last place can always afford something. [HYPOTHESIS H2-05] In a short break you spend it on a gun and on perks. Guns trade one strength for another, so the free pistol can still win: the pistol is accurate and all-round, the shotgun fires a wide close-range spread for crowded volleys, and the sniper fires one slow, long shot that pops every parachute in its line. Perks change the round for everyone in the arena, such as Windy, Slow Chutes, Big Volleys, Decoys and Golden Rush. You fire them whenever you like during the round, at most 3 are active in the arena at once, and the banner names who fired each one. Crate pigeons drop free perks mid-round. When the next round starts, the budget wipes: whatever you did not spend turns into Feathers, which you keep and spend on cosmetics. |
| **Decision, challenge, or expression** | Where to stand, which pigeon to go for, when to risk a long shot you probably cannot catch, and whether to chase your own drop or a landed pigeon. In the break: which gun and perks to buy, and how much to bank as Feathers. Mid-round: when to fire a perk so it hurts your rivals more than you. |
| **Shortest satisfying visit / typical session** | TBD: measuring it once the shooting is playable. Target: 1 round (about 1 minute) / 3 to 5 rounds (5 to 8 minutes). |
| **Why repetition 10 differs from repetition 1** | Every round has a different mix of guns and perks, fired by different players at different moments. Plus pigeon variety (fast ones, zig-zaggers) and the other players: with shared pigeons, no two rounds play the same. [HYPOTHESIS H2-01] |

**Pillars**

1. Every shot is a race
2. A hit feels huge
3. Run and gun

---

## 4. Why Players Come Back

### 4.1 The next-day (D1) sentence

> "A player who enjoyed their first session returns the next day (D1) because Hook 1, Golden Hour, fills the sky with double-point golden pigeons at 19:00 UTC every day. TBD: confirming the best time from the dashboard once players arrive." [HYPOTHESIS H2-02]

### 4.2 The progression chain

> **Repeatable action → persistent reward → new capability, status, or social role → new decision or challenge**

| Moment | What persists or has been built? | What becomes possible next? | How can another player tell? |
|---|---|---|---|
| **End of first session** | Your level, your first Feathers, and a place on this week's scoreboard | Your first cosmetic, tomorrow's Golden Hour and the rival just above you on the weekly scoreboard | Level shown above your name; your scoreboard entry is public |
| **End of first week** | A gun colour unlocked by level and cosmetics bought with Feathers | You know your style and buy for it: a sniper player saves for Slow Chutes, a shotgun player for Big Volleys. Once leagues exist, the Monday reset can promote you | Your gun colour and cosmetics are visible in the arena, plus a league badge once leagues exist |
| **Week 3+: what takes more than two weeks?** | Golden gun trim, earned by finishing in the weekly top 3 three times | A title above your name, and a place in the top league once leagues exist | The golden trim is visible from across the arena |

Regular players are rewarded with status everyone can see, never with power: gun colours, cosmetics, a golden trim and a title above their name. None of it changes a round, and round purchases wipe every round, so nothing bought carries into the next one.

You come back for Golden Hour and the sky is gold. Your sniper shot pops two parachutes from across the arena, and the player who stole from you on Monday is now one place below you on the scoreboard. Your gun has the colour you unlocked at level 8. Monday wipes the weekly scores, but your level, Feathers, cosmetics and colour stay.

Currency: two kinds. Your round budget comes from your last round's score, is spent on guns and perks in the break, and wipes when the next round starts. Whatever you leave unspent turns into Feathers, which persist and buy cosmetics only, so banking trades this round's edge for status. Main abuse risk: farming an empty arena alone, so solo rounds convert to fewer Feathers, the conversion is capped per round, and nothing can be traded.

### 4.3 Two return hooks

| Selected hook | Exact trigger or timing | What the player anticipates | Reminder channel + no-reminder fallback |
|---|---|---|---|
| **1.** Recurring scheduled event: Golden Hour | Every day at 19:00 UTC, for one hour, golden pigeons worth double points join every round | A full arena and the best scores of the day | Daily Event listing on decentraland.org; fallback: a countdown at spawn and on the exit board |
| **2.** Weekly leaderboard reset / small leagues | The weekly scoreboard resets every Monday at 00:00 UTC. Once there are enough weekly players, it splits into leagues of about 20, where the top 3 move up and the bottom 3 move down | A fresh start and a top-3 place within reach, plus the named rival just above you | Community post on reset day; fallback: the exit board shows your scoreboard place and the reset countdown |

[HYPOTHESIS H2-02] [HYPOTHESIS H2-03]

---

## 5. Social by Design

| | |
|---|---|
| **The repeatable social loop** | Player A pops a parachute but misses the catch → Player B sprints to the landing spot and grabs the pigeon → the steal moves points between them and flashes B's name to A → A wants revenge in the next round. [HYPOTHESIS H2-04] |
| **The disappearance test** | The race breaks: with no rivals, shared pigeons are just targets and steals vanish. Solo rounds against your best score and the weekly scoreboard would remain. |
| **From strangers to a group** | There are no groups or teams to join: it is every player for themselves, 1v1v1 up to the arena maximum. Everyone in the arena is in the same round, in the same role, and each player has a colour, so a newcomer just starts shooting. |
| **Recognition & continuity** | You first learn a name when it flashes over a pigeon someone stole from you. Rivalries persist on the weekly scoreboard, where the player who stole from you is one place above or below. |
| **Quiet hours & player counts** | When few people are online, a solo player can play rounds against their own best score, which still counts for the weekly scoreboard. Social play becomes viable at 2 players (our social threshold); the ideal group is 6 to 8; the v1 tested maximum is 12 players. There is one arena and rounds start on a fixed cycle, so everyone present plays the same round, and Golden Hour gathers players at one time. TBD: these counts are estimates until the Week 2 playtest. |
| **Drop-in / drop-out** | A late arrival joins the current round straight away and scores from their first shot. Nobody depends on anyone else, so a player leaving changes nothing for the rest. |
| **Visible play (the bystander test)** | You see parachutes pop and players sprinting to where the pigeons will land. |
| **Shareable play (the memorable moment)** | Diving under a golden pigeon in the last second to steal the round. |
| **Bring-a-friend** | The moment a stranger steals the round from you, you want your friend here for the rematch. With them in the arena, every steal is personal and the scoreboard settles who is best. |

---

## 6. Mobile-First

**Every core-loop verb on touch.**

| Core-loop verb | How it works with touch controls |
|---|---|
| Run | Left-thumb joystick, the client default |
| Aim | Hold and drag on the right half of the screen to move the aim |
| Shoot | Lift the finger to fire [HYPOTHESIS H1-02] |
| Catch | Run into the falling pigeon; contact collects it, no button |
| Steal | Run over a landed pigeon; contact collects it, no button |
| Fire a perk | Tap the perk button above the right thumb; a tap fires the perk, not a shot. It greys out while 3 perks are active |

**UI plan.** During a round the screen shows your score, multiplier and the timer at the top, a banner with the active perks and who fired them, and one perk button. The shop, scoreboard and weekly scoreboard appear only in the break between rounds.

**Performance.** Target: 60fps on recommended desktop hardware and 30fps on TBD: naming the team's test phone before the Week 4 mobile playtest, in the mobile client, both at 12 players, our v1 tested maximum. The main risk is many pigeons in the air with effects; we move pigeons on scripted arcs, not physics, reuse pigeon objects, and cap the number in the air.

**Desktop-only dependencies.** None planned. TBD: confirming in the first phone test (H1-02) that letting go after a drag fires on the mobile client, and checking the [Desktop vs Mobile Feature Gap tracker](https://github.com/decentraland/godot-explorer/issues/2402). If it does not, a tap-to-fire button is the fallback, with no redesign.

---

## 7. World, Look & Story

**Story / world.** The Pigeon Arena is a sunny pixel stadium in the Pixel Arcade family, where cannons around the rim launch pigeons on parachutes for sport. Nobody hurts a bird here: you pop the parachute, and the pigeon is the prize.

**Visual direction.** A circular arena ringed with cannons, in the Pixel Golf style. Pigeons float on little parachutes; players shoot the parachutes, never the pigeons. Each player has a bright colour: a pigeon you hit glows in it, and a shadow circle in your colour marks where it will land, so you can read the catch on a small phone screen. The pigeons are Decentraland's own pigeons dressed as stunt pilots: a little white flight helmet with a racing stripe in the team colour and gold stars, goggles pushed up on top, and a backpack on a harness. The parachute clips to the backpack, in red and white panels, and breaks away and tumbles off when it is shot. Golden pigeons wear a gold helmet and a gold-and-white parachute, so they stand out from across the arena. The cannons are cartoon cannons that squash, stretch and puff smoke when they fire. Visual signature: a bright sky full of tiny parachuting Decentraland pigeons, with the score popping up where a parachute pops.

---

## 8. Audience & Comparables

**Primary player + arrival context.** For players who already enjoy party games, arriving alone or with friends, looking for quick competitive rounds they can drop into on a phone.

**How the first group arrives.** The first groups come from Pixel Arcade and Pixel Golf players and the Big Yellow Fishes community, gathered by the daily Golden Hour Event listing. Because two players are enough to start, one daily shared hour is enough overlap to reach the threshold.

**Deliberately not for.** Players looking for realistic shooting or long solo sessions.

### Comparables

| | Comparable A, outside Decentraland: Wii Play, Shooting Range | Comparable B, outside Decentraland: Mario Party 8 |
|---|---|---|
| What we observed works | Point and shoot needs no teaching. Clay pigeons score more if you hit them early, so timing matters. Two players race for the same targets with colour-coded crosshairs. | Short four-player free-for-all minigames anyone can pick up. The fun is beating the people next to you. |
| What does not fit our audience or context, and why | Two players at most, on one sofa. You stand still and only aim. A fixed set of rounds, then nothing brings you back. | Long dice-board sessions where luck often decides the winner. Many minigames you only want to play once. Everyone has to be in one room. |
| What we will do differently | Up to 12 players moving around an arena; you run to catch what you hit; Golden Hour and the weekly scoreboard give a reason to return. | No board and no dice: skill decides every 60-second round. One minigame played deep, not dozens played once. Strangers to play against at any hour. |

---

## 9. 4 Week Plan (v1 scope)

Team: 4 people, full time.

| Week | What is playable / done |
|---|---|
| 1: Prototype definition | Greybox arena with one cannon: hold, aim, release, catch, playable solo on desktop and checked on a phone |
| 2: Core interaction + first-group test | Full 60-second round with a ring of cannons, shared pigeons, steals and a scoreboard; playtest at 2 players, our social threshold |
| 3: Core systems refinement | Round budget and shop; three guns (pistol, shotgun, sniper); arena perks fired mid-round with a cap of 3, and perk crates; Feathers from unspent budget and a first set of cosmetics; fast and zig-zag pigeons; levels; Pixel Golf art pass |
| 4: Playable prototype, final design direction (mobile playtest) | Golden Hour and the weekly scoreboard working; mobile playtest at 8 to 12 players; performance pass; final look locked |

**Progress (as of 13 November)**

- **Arena:** the full stadium at final scale, with all 12 cannons. Each cannon bobs while idle and fires with a cartoon squash and stretch when it launches a pigeon.
- **Pigeons:** the stunt-pilot pigeon from §7, animated to dangle under the canopy, flap while falling and sit on the ground. The parachute pops open, sways, and breaks away when shot. The golden version is ready for Golden Hour but switched off.
- **Shooting:** hold, aim and release, with the view switching to first person while you aim. A shotgun model sits in the player's hand, and a tracer line shows where each shot went.
- **Pigeon flight:** pigeons launch from the cannons, circle above the arena until shot, fall, sit on the ground for 5 seconds, then launch again.
- **Publishing:** every push to the Testing branch publishes to the World. A new version only appears in the desktop app after Decentraland converts its models, which can take hours when Decentraland's queue is busy; the web viewer shows it straight away.
- **Not built yet:** catching, stealing, scoring and multipliers, timed rounds and the scoreboard, the shop and budget, the pistol and sniper, perks, Feathers and cosmetics, levels, Golden Hour and the weekly scoreboard.

**Open questions from the build**

- In the build, pigeons circle overhead until someone shoots them. TBD: confirming that, or having unshot pigeons drift down and land.
- The build gives everyone the shotgun, while §3 makes the pistol the free gun. TBD: which gun every player starts with.
- The hit area (a 2.5 m sphere) is smaller than the drawn parachute (about 4.5 m across), so shots at the edge of the canopy miss. TBD: sizing the hit area to the canopy, which is also the mobile fallback in the top risk.
- The pigeon is painted from the arena's colour palette for now, because the original pigeon texture is not in our files yet.

**What keeps the experience changing after launch**

- Without building a new level, we can change or rotate the pigeon mix and the perks on sale (wind, golden rush) every week.
- If an update is skipped, daily Golden Hour and the Monday scoreboard reset still create variation.
- If progression resets or creates a power gap, levels, Feathers, cosmetics and gun colours persist; a new or returning player can compete meaningfully within 1 minute through the first round, because round purchases wipe every round, everyone gets a base budget, and persistent rewards are cosmetic.
- One player behaviour that would change what we build next: if players chase steals more than shots, we rebalance points towards popping parachutes.

**Not building in v1**

1. Private rooms for friend groups. The first cut to come back in v2 if v1 hits its numbers.
2. Paid cosmetics or Decentraland wearables; v1 cosmetics are bought with Feathers only.
3. A second arena.

Standing non-goal: never teams, because every player is everyone's rival.

**Top risk + fallback.** Running, aiming and catching at once may be too hard with two thumbs on a phone. Fallback: on mobile, larger parachute hit areas and a wider catch radius; if that is not enough, tap-to-fire on a button.

