import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import { engine, PointerLock } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { isStateSyncronized } from '@dcl/sdk/network'
import { MAX_CATCH_MULTIPLIER, MAX_SHOT_MULTIPLIER, PLAYER_COLOURS, STREAK_STEP } from '../shared/config'
import { PlayerScore, RoundPhase, RoundState } from '../shared/schemas'
import { serverAlive, serverNow } from './clock'
import { getMyAddress, liveToasts } from './state'

// ---------------------------------------------------------------------------
// HUD: score, multiplier and timer at the top; toasts in the middle; the
// scoreboard during the break between rounds; Joel's crosshair while aiming.
// ---------------------------------------------------------------------------

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(GameUi)
}

type ScoreRow = { address: string; name: string; colour: number; score: number; best: number; hits: number; catches: number; grabs: number; shotStreak: number; catchStreak: number }

function scores(): ScoreRow[] {
  const rows: ScoreRow[] = []
  for (const [, s] of engine.getEntitiesWith(PlayerScore)) rows.push({ ...s })
  rows.sort((a, b) => b.score - a.score)
  return rows
}

function round() {
  for (const [, r] of engine.getEntitiesWith(RoundState)) return r
  return null
}

function rgb(c: [number, number, number], a = 1): Color4 {
  return Color4.create(c[0], c[1], c[2], a)
}

function timeLeft(endsAt: number): string {
  const s = Math.max(0, Math.ceil((endsAt - serverNow()) / 1000))
  return Math.floor(s / 60) + ':' + (s % 60).toString().padStart(2, '0')
}

const PANEL = Color4.create(0.05, 0.07, 0.15, 0.72)

const GameUi = () => {
  const r = round()
  const rows = scores()
  const me = getMyAddress()
  const mine = rows.find((s) => s.address === me)
  const alive = serverAlive()
  const isLocked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? false
  const toasts = liveToasts()

  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', pointerFilter: 'none' }}>
      {/* Top bar */}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 12, left: '50%' },
          margin: { left: -230 },
          width: 460,
          height: 64,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: { left: 18, right: 18 },
          pointerFilter: 'none'
        }}
        uiBackground={{ color: PANEL }}
      >
        <Label value={'Score ' + (mine?.score ?? 0)} fontSize={24} color={Color4.White()} uiTransform={{ width: 150, height: 40 }} textAlign="middle-left" />
        <Label
          value={
            !isStateSyncronized()
              ? 'Connecting...'
              : !alive
              ? 'Waking server...'
              : r?.phase === RoundPhase.Playing
              ? timeLeft(Number(r.endsAt))
              : r?.phase === RoundPhase.Break
              ? 'Next ' + timeLeft(Number(r.endsAt))
              : 'Waiting'
          }
          fontSize={28}
          color={Color4.create(1, 0.85, 0.2, 1)}
          uiTransform={{ width: 150, height: 40 }}
          textAlign="middle-center"
        />
        <Label
          value={
            'Shot x' +
            Math.min(MAX_SHOT_MULTIPLIER, 1 + STREAK_STEP * (mine?.shotStreak ?? 0)) +
            '  Catch x' +
            Math.min(MAX_CATCH_MULTIPLIER, 1 + STREAK_STEP * (mine?.catchStreak ?? 0))
          }
          fontSize={15}
          color={Color4.create(0.8, 0.9, 1, 1)}
          uiTransform={{ width: 130, height: 40 }}
          textAlign="middle-right"
        />
      </UiEntity>

      {/* Toasts */}
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: '28%', left: '50%' },
          margin: { left: -300 },
          width: 600,
          flexDirection: 'column',
          alignItems: 'center',
          pointerFilter: 'none'
        }}
      >
        {toasts.map((t, i) => (
          <Label
            key={'toast' + i + t.text}
            value={t.text}
            fontSize={t.big ? 34 : 22}
            color={rgb(t.colour)}
            uiTransform={{ width: 600, height: t.big ? 46 : 32 }}
            textAlign="middle-center"
          />
        ))}
      </UiEntity>

      {/* Scoreboard during the break */}
      {r?.phase === RoundPhase.Break && rows.length > 0 && (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: 96, left: '50%' },
            margin: { left: -220 },
            width: 440,
            flexDirection: 'column',
            padding: 16,
            pointerFilter: 'none'
          }}
          uiBackground={{ color: PANEL }}
        >
          <Label value={'Round ' + r.round + ' results'} fontSize={26} color={Color4.create(1, 0.85, 0.2, 1)} uiTransform={{ height: 40 }} textAlign="middle-center" />
          {rows.slice(0, 8).map((s, i) => (
            <UiEntity key={'row' + s.address} uiTransform={{ flexDirection: 'row', height: 32, justifyContent: 'space-between' }}>
              <Label
                value={i + 1 + '. ' + s.name + (s.address === me ? ' (you)' : '')}
                fontSize={19}
                color={rgb(PLAYER_COLOURS[s.colour % PLAYER_COLOURS.length])}
                uiTransform={{ width: 250 }}
                textAlign="middle-left"
              />
              <Label value={s.hits + ' pops  ' + (s.catches + s.grabs) + ' birds'} fontSize={14} color={Color4.Gray()} uiTransform={{ width: 110 }} textAlign="middle-right" />
              <Label value={String(s.score)} fontSize={19} color={Color4.White()} uiTransform={{ width: 60 }} textAlign="middle-right" />
            </UiEntity>
          ))}
          {mine && (
            <Label value={'Your best this session: ' + mine.best} fontSize={15} color={Color4.Gray()} uiTransform={{ height: 28 }} textAlign="middle-center" />
          )}
        </UiEntity>
      )}

      {/* Crosshair while aiming */}
      {isLocked && (
        <UiEntity
          uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
        >
          <UiEntity
            uiTransform={{ width: 48, height: 48, pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/images/crosshair.png' } }}
          />
        </UiEntity>
      )}
    </UiEntity>
  )
}
