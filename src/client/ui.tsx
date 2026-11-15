import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import { engine, PointerLock } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlatform } from '@dcl/sdk/platform'
import { MAX_CATCH_MULTIPLIER, MAX_SHOT_MULTIPLIER, PLAYER_COLOURS, STREAK_STEP } from '../shared/config'
import { room } from '../shared/messages'
import { RoundPhase } from '../shared/phases'
import {
  COSMETICS,
  Cosmetic,
  CosmeticKind,
  feathersFromUnspent,
  GUN_ORDER,
  GUNS,
  gunOf,
  hasCosmetic,
  MAX_HELD_PERKS,
  PERK_ORDER,
  PERKS,
  PerkId,
  xpForLevel
} from '../shared/rules'
import { firePerk, noteUiPress, perkReady, reloadLeft } from './shooting'
import { getMyAddress, liveToasts } from './state'
import { activePerks, game, serverAlive, serverNow } from './store'

// ---------------------------------------------------------------------------
// The HUD, in Pixel Golf's look (design: the "Pigeon Shooter UI" canvas).
// Pale cards with a white rim, small bold capital labels, tinted chips, round
// white icon buttons, the blue LV pill, and Lato.
//
// In the round: the round card on the right, the running perks top centre,
// score pops in the middle, and the perk tray bottom right (a big perk button
// above the right thumb on a phone). In the break: results, the shop and this
// week's board. Any time: the locker (gun paint, tracers, titles).
// ---------------------------------------------------------------------------

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(GameUi)
}

// Lato (SIL OFL, assets/fonts), with the built-in face as the fallback (the mobile app)
const FONT_REGULAR = 'assets/fonts/Lato-Regular.ttf'
const FONT_BOLD = 'assets/fonts/Lato-Bold.ttf'

// Pixel Golf's colours
const NAVY = Color4.create(0.118, 0.204, 0.259, 1)
const GREY = Color4.create(0.337, 0.388, 0.435, 1)
const BLUE = Color4.create(0.075, 0.533, 0.722, 1)
const BLUE_INK = Color4.create(0.059, 0.435, 0.592, 1)
const PALE_BLUE = Color4.create(0.839, 0.949, 0.988, 1)
const PALE = Color4.create(0.957, 0.969, 0.976, 0.95)
const WHITE = Color4.White()
const RIM = Color4.create(0.788, 0.827, 0.859, 1)
const LINE = Color4.create(0.835, 0.863, 0.886, 1)
const GREEN = Color4.create(0.165, 0.525, 0.106, 1)
const GREEN_INK = Color4.create(0.137, 0.439, 0.102, 1)
const PALE_GREEN = Color4.create(0.886, 0.957, 0.882, 1)
const GOLD_FILL = Color4.create(1, 0.953, 0.8, 1)
const GOLD_RIM = Color4.create(0.91, 0.725, 0.227, 1)
const GOLD_INK = Color4.create(0.478, 0.322, 0, 1)
const GOLD_DARK = Color4.create(0.361, 0.239, 0, 1)
const DISABLED = Color4.create(0.541, 0.588, 0.627, 1)
const RED_INK = Color4.create(0.702, 0.149, 0.118, 1)
const CLEAR = Color4.create(0, 0, 0, 0)

const ICON = {
  trophy: 'assets/Images/ui/icon-trophy.png',
  feather: 'assets/Images/ui/icon-feather.png',
  close: 'assets/Images/ui/icon-close.png',
  lock: 'assets/Images/ui/icon-lock.png'
}
const perkIcon = (id: string) => 'assets/Images/ui/perk-' + id + '.png'
const gunIcon = (id: string) => 'assets/Images/ui/gun-' + id + '.png'

const PERK_CHIP: Record<string, Color4> = {
  blue: PALE_BLUE,
  green: PALE_GREEN,
  gold: GOLD_FILL,
  grey: Color4.create(0.9, 0.92, 0.94, 1),
  orange: Color4.create(1, 0.92, 0.84, 1)
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------
const ui = {
  locker: false,
  lockerTab: 'paint' as CosmeticKind,
  picked: '' as string,
  board: false,
  phoneTab: 'shop' as 'results' | 'shop' | 'week'
}

let phone: boolean | undefined
function onPhone(): boolean {
  if (phone !== undefined) return phone
  let p: string | null = null
  try {
    p = getPlatform()
  } catch {
    p = null
  }
  if (p) phone = p === 'mobile'
  return phone ?? false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(n: number): string {
  const s = String(Math.abs(Math.round(n)))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return (n < 0 ? '-' : '') + out
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return Math.floor(s / 60) + ':' + (s % 60).toString().padStart(2, '0')
}

function longWait(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d > 0) return d + 'd ' + h + 'h'
  if (h > 0) return h + 'h ' + mm.toString().padStart(2, '0') + 'm'
  return mm + 'm'
}

function rgb(c: [number, number, number], a = 1): Color4 {
  return Color4.create(c[0], c[1], c[2], a)
}

function press(fn: () => void) {
  return () => {
    noteUiPress()
    fn()
  }
}

// Labels get an explicit width (as Pixel Golf's do): roughly Lato's average glyph width
function textWidth(value: string, size: number, bold?: boolean): number {
  return Math.ceil(value.length * size * (bold ? 0.56 : 0.52)) + 4
}

type TextOpts = { bold?: boolean; color?: Color4; align?: 'middle-left' | 'middle-center' | 'middle-right'; width?: number | string; height?: number }

function T(value: string, size: number, o: TextOpts = {}) {
  return (
    <Label
      value={value}
      fontSize={size}
      font="sans-serif"
      fontSrc={o.bold ? FONT_BOLD : FONT_REGULAR}
      color={o.color ?? NAVY}
      textAlign={o.align ?? 'middle-left'}
      uiTransform={{ width: (o.width ?? textWidth(value, size, o.bold)) as any, height: o.height ?? Math.round(size * 1.35) }}
    />
  )
}

function caps(value: string, color: Color4 = GREY, width?: number) {
  return T(value, 11, { bold: true, color, width })
}

function icon(src: string, w: number, h: number = w) {
  return <UiEntity uiTransform={{ width: w, height: h }} uiBackground={{ textureMode: 'stretch', texture: { src } }} />
}

function card(children: (ReactEcs.JSX.Element | null)[], transform: any, key?: string) {
  const kids = children.filter((c) => c !== null) as ReactEcs.JSX.Element[]
  return (
    <UiEntity
      key={key}
      uiTransform={{
        flexDirection: 'column',
        padding: { top: 12, right: 14, bottom: 12, left: 14 },
        borderRadius: 20,
        borderWidth: 3,
        borderColor: WHITE,
        ...transform
      }}
      uiBackground={{ color: PALE }}
    >
      {kids}
    </UiEntity>
  )
}

function roundButton(src: string, onPress: () => void, key: string, size = 36) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ width: size, height: size, justifyContent: 'center', alignItems: 'center', borderRadius: size / 2, borderWidth: 2, borderColor: RIM, margin: { left: 7, right: 7 } }}
      uiBackground={{ color: WHITE }}
      onMouseDown={press(onPress)}
    >
      {icon(src, Math.round(size * 0.56))}
    </UiEntity>
  )
}

function pill(label: string, fill: Color4, ink: Color4, onPress: (() => void) | null, width: number, height = 32, key?: string) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ width, height, justifyContent: 'center', alignItems: 'center', borderRadius: height / 2 }}
      uiBackground={{ color: fill }}
      onMouseDown={onPress ? press(onPress) : undefined}
    >
      {T(label, 13, { bold: true, color: ink, align: 'middle-center', width })}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Data for the HUD
// ---------------------------------------------------------------------------
type Row = { address: string; name: string; colour: number; score: number; hits: number; catches: number; grabs: number }

function results(): Row[] {
  return game.scores.map((s) => ({ ...s })).sort((a, b) => b.score - a.score)
}

function myScore() {
  const me = getMyAddress()
  return game.scores.find((s) => s.address === me)
}

function playing(): boolean {
  return serverAlive() && game.round.phase === RoundPhase.Playing
}

function inBreak(): boolean {
  return serverAlive() && game.round.phase === RoundPhase.Break
}

// ---------------------------------------------------------------------------
// Top centre: the perks running in the arena, and who fired them
// ---------------------------------------------------------------------------
function PerkBanner() {
  const running = activePerks()
  if (running.length === 0) return null
  const me = getMyAddress()
  const t = serverNow()
  const small = onPhone()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: small ? 10 : 16, left: 0 }, width: '100%', justifyContent: 'center', flexDirection: 'row', pointerFilter: 'none' }}>
      {running.map((p) => {
        const perk = PERKS[p.id]
        return (
          <UiEntity
            key={'banner-' + p.id}
            uiTransform={{ height: small ? 34 : 44, flexDirection: 'row', alignItems: 'center', padding: { left: 8, right: 14 }, margin: { left: 5, right: 5 }, borderRadius: small ? 17 : 22, borderWidth: small ? 2 : 3, borderColor: WHITE }}
            uiBackground={{ color: PALE }}
          >
            {small ? null : (
              <UiEntity uiTransform={{ width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', margin: { right: 8 } }} uiBackground={{ color: PERK_CHIP[perk.tint] }}>
                {icon(perkIcon(p.id), 20)}
              </UiEntity>
            )}
            <UiEntity uiTransform={{ flexDirection: 'column', margin: { right: 8 } }}>
              {T(perk.name.toUpperCase(), small ? 12 : 13, { bold: true })}
              {small ? null : T(p.by === me ? 'fired by you' : 'fired by ' + p.byName, 11, { color: GREY })}
            </UiEntity>
            {small ? T(p.by === me ? 'you' : p.byName, 11, { color: GREY }) : null}
            {T(clock(p.end - t), small ? 13 : 15, { bold: true })}
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Score pops and callouts
// ---------------------------------------------------------------------------
function Toasts() {
  const toasts = liveToasts()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: onPhone() ? '30%' : '27%', left: 0 }, width: '100%', flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      {toasts.map((t, i) => (
        <UiEntity
          key={'toast' + i + t.text}
          uiTransform={{ height: t.big ? 52 : 34, padding: { left: t.big ? 22 : 16, right: t.big ? 22 : 16 }, margin: { bottom: 8 }, justifyContent: 'center', alignItems: 'center', borderRadius: t.big ? 26 : 17, borderWidth: t.big ? 3 : 0, borderColor: GOLD_RIM }}
          uiBackground={{ color: t.big ? WHITE : PALE }}
        >
          {T(t.text, t.big ? (onPhone() ? 22 : 28) : 15, { bold: true, color: rgb(t.colour), align: 'middle-center' })}
        </UiEntity>
      ))}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// The round card (Pixel Golf's range card), right side
// ---------------------------------------------------------------------------
function RoundCard() {
  const r = game.round
  const mine = myScore()
  const alive = serverAlive()
  const shotX = Math.min(MAX_SHOT_MULTIPLIER, 1 + STREAK_STEP * (mine?.shotStreak ?? 0))
  const catchX = Math.min(MAX_CATCH_MULTIPLIER, 1 + STREAK_STEP * (mine?.catchStreak ?? 0))
  const timeText = !alive ? '...' : r.phase === RoundPhase.Playing ? clock(r.endsAt - serverNow()) : r.phase === RoundPhase.Break ? clock(r.endsAt - serverNow()) : '-'
  const roundText = !alive ? 'Waking server' : r.phase === RoundPhase.Playing ? 'Round ' + r.round : r.phase === RoundPhase.Break ? 'Next round in' : 'Waiting'
  const gun = gunOf(game.me.gun)
  const reload = reloadLeft()
  const me = game.me

  if (onPhone()) {
    return card(
      [
        <UiEntity key="t" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {T(timeText, 26, { bold: true, width: 80 })}
          {T(fmt(mine?.score ?? 0), 20, { bold: true, align: 'middle-right', width: 90 })}
        </UiEntity>,
        <UiEntity key="m" uiTransform={{ width: '100%', height: 34, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: { left: 10, right: 10 }, margin: { top: 6 }, borderRadius: 12 }} uiBackground={{ color: PALE_BLUE }}>
          {T('Shot x' + shotX, 14, { bold: true, color: BLUE_INK })}
          {T('Catch x' + catchX, 14, { bold: true, color: BLUE_INK, align: 'middle-right' })}
        </UiEntity>
      ],
      { positionType: 'absolute', position: { top: 10, right: 12 }, width: 200, padding: { top: 10, right: 12, bottom: 10, left: 12 }, borderRadius: 18 },
      'roundcard'
    )
  }

  return card(
    [
      game.arena.golden ? (
        <UiEntity key="golden" uiTransform={{ width: '100%', height: 46, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: { left: 12, right: 12 }, margin: { bottom: 10 }, borderRadius: 14, borderWidth: 2, borderColor: GOLD_RIM }} uiBackground={{ color: GOLD_FILL }}>
          <UiEntity uiTransform={{ flexDirection: 'column' }}>
            {caps('GOLDEN HOUR', GOLD_INK)}
            {T('x2 golden birds', 16, { bold: true, color: GOLD_DARK })}
          </UiEntity>
          {T(clock(game.arena.goldenAt + 3600000 - serverNow()), 18, { bold: true, color: GOLD_DARK, align: 'middle-right' })}
        </UiEntity>
      ) : null,
      <UiEntity key="round" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        {T(roundText, 15, { width: 120 })}
        {T(timeText, 26, { bold: true, align: 'middle-right', width: 80 })}
      </UiEntity>,
      <UiEntity key="score" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        {T('Score', 15)}
        {T(fmt(mine?.score ?? 0), 18, { bold: true, align: 'middle-right', width: 100 })}
      </UiEntity>,
      <UiEntity key="streak" uiTransform={{ width: '100%', height: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: { left: 10, right: 10 }, margin: { top: 6 }, borderRadius: 12 }} uiBackground={{ color: PALE_BLUE }}>
        <UiEntity uiTransform={{ flexDirection: 'column' }}>
          {caps('STREAK', BLUE_INK)}
          {T((mine?.shotStreak ?? 0) + ' pops, ' + (mine?.catchStreak ?? 0) + ' catches', 12, { color: GREY })}
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'flex-end' }}>
          {T('Shot x' + shotX, 15, { bold: true, color: BLUE_INK, align: 'middle-right' })}
          {T('Catch x' + catchX, 12, { bold: true, color: BLUE_INK, align: 'middle-right' })}
        </UiEntity>
      </UiEntity>,
      <UiEntity key="gun" uiTransform={{ width: '100%', height: 40, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: { left: 6, right: 8 }, margin: { top: 6 }, borderRadius: 12, borderWidth: 2, borderColor: LINE }} uiBackground={{ color: WHITE }}>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
          {icon(gunIcon(gun.id), 40, 20)}
          <UiEntity uiTransform={{ flexDirection: 'column', margin: { left: 6 } }}>
            {T('GUN', 10, { bold: true, color: GREY })}
            {T(gun.name, 15, { bold: true })}
          </UiEntity>
        </UiEntity>
        {T(reload > 0.05 ? 'reloading' : gun.id === 'pistol' ? 'all-round' : gun.id === 'shotgun' ? 'wide, close' : 'long, pierces', 12, { color: GREY, align: 'middle-right' })}
      </UiEntity>,
      <UiEntity key="level" uiTransform={{ width: '100%', height: 34, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: { top: 8 } }}>
        <UiEntity uiTransform={{ width: 72, height: 34, justifyContent: 'center', alignItems: 'center', borderRadius: 17, borderWidth: 3, borderColor: Color4.create(0.78, 0.863, 0.902, 1) }}>
          <UiEntity uiTransform={{ width: 62, height: 24, justifyContent: 'center', alignItems: 'center', borderRadius: 12 }} uiBackground={{ color: BLUE }}>
            {T(me.ready ? 'LV ' + me.level : 'LV -', 13, { color: WHITE, align: 'middle-center', width: 62 })}
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
          {T('Feathers', 12, { color: GREY })}
          {T(me.ready ? fmt(me.feathers) : '-', 16, { align: 'middle-right', width: 54 })}
        </UiEntity>
      </UiEntity>,
      <UiEntity key="buttons" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: 10 } }}>
        {roundButton(ICON.trophy, () => {
          ui.board = !ui.board
          ui.locker = false
        }, 'b-trophy')}
        {roundButton(ICON.feather, () => {
          ui.locker = !ui.locker
          ui.board = false
          ui.picked = ''
        }, 'b-locker')}
      </UiEntity>
    ],
    { positionType: 'absolute', position: { top: 96, right: 16 }, width: 240 },
    'roundcard'
  )
}

// ---------------------------------------------------------------------------
// Perk tray (desktop, keys 1 2 3) and the big perk button (phone)
// ---------------------------------------------------------------------------
function PerkTray() {
  const held = game.me.perks
  if (!playing()) return null
  const running = activePerks().length

  if (onPhone()) {
    if (held.length === 0) return null
    const ready = perkReady(0)
    return (
      <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 18, bottom: 96 }, flexDirection: 'column', alignItems: 'center' }}>
        <UiEntity
          uiTransform={{ width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: ready ? BLUE : RIM, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: WHITE }}
          onMouseDown={press(() => firePerk(0))}
        >
          {icon(perkIcon(held[0]), 28)}
          {T(PERKS[held[0]].name, 10, { bold: true, color: ready ? NAVY : DISABLED, align: 'middle-center', width: 72 })}
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', margin: { top: 4 } }}>
          {[0, 1, 2].map((i) => (
            <UiEntity key={'dot' + i} uiTransform={{ width: 10, height: 10, borderRadius: 5, margin: { left: 2, right: 2 }, borderWidth: i < held.length ? 0 : 2, borderColor: RIM }} uiBackground={{ color: i < held.length ? BLUE : WHITE }} />
          ))}
        </UiEntity>
        {T(held.length + ' held, tap to fire', 10, { bold: true, color: WHITE, align: 'middle-center', width: 110 })}
      </UiEntity>
    )
  }

  return card(
    [
      <UiEntity key="head" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: { bottom: 8 } }}>
        {caps('YOUR PERKS')}
        {T(running + ' of 3 running in the arena', 12, { color: GREY, align: 'middle-right' })}
      </UiEntity>,
      <UiEntity key="slots" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}>
        {[0, 1, 2].map((i) => {
          const id = held[i]
          if (!id)
            return (
              <UiEntity key={'slot' + i} uiTransform={{ width: 66, height: 64, borderRadius: 14, borderWidth: 2, borderColor: RIM, justifyContent: 'center', alignItems: 'center' }}>
                {T('empty', 11, { color: GREY, align: 'middle-center', width: 60 })}
              </UiEntity>
            )
          const ready = perkReady(i)
          return (
            <UiEntity
              key={'slot' + i}
              uiTransform={{ width: 66, height: 64, borderRadius: 14, borderWidth: 2, borderColor: ready ? BLUE : RIM, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
              uiBackground={{ color: WHITE }}
              onMouseDown={press(() => firePerk(i))}
            >
              <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 3, left: 6 } }}>{T(String(i + 1), 11, { bold: true, color: BLUE_INK })}</UiEntity>
              {icon(perkIcon(id), 22)}
              {T(PERKS[id].name, 11, { bold: true, color: ready ? NAVY : DISABLED, align: 'middle-center', width: 64 })}
            </UiEntity>
          )
        })}
      </UiEntity>
    ],
    { positionType: 'absolute', position: { right: 16, bottom: 16 }, width: 240, padding: { top: 10, right: 12, bottom: 12, left: 12 } },
    'perktray'
  )
}

// How to play: the first round only, bottom left
function HowToPlay() {
  if (onPhone() || !playing() || game.round.round > 1 || (myScore()?.hits ?? 0) > 2) return null
  return card(
    [
      <UiEntity key="h">{caps('HOW TO PLAY')}</UiEntity>,
      <UiEntity key="a">{T('Hold, aim, let go: pop the parachutes', 13)}</UiEntity>,
      <UiEntity key="b">{T('Catch your pigeon before it lands', 13)}</UiEntity>,
      <UiEntity key="c">{T('Grab landed pigeons before rivals do', 13)}</UiEntity>
    ],
    { positionType: 'absolute', position: { left: 16, bottom: 16 }, padding: { top: 10, right: 14, bottom: 10, left: 14 }, borderRadius: 16 },
    'howto'
  )
}

// ---------------------------------------------------------------------------
// Break: results, shop, this week
// ---------------------------------------------------------------------------
function Results(width: number) {
  const rows = results()
  const me = getMyAddress()
  const mine = rows.find((r) => r.address === me)
  return card(
    [
      <UiEntity key="h" uiTransform={{ margin: { bottom: 4 } }}>{caps('RESULTS')}</UiEntity>,
      ...rows.slice(0, 8).map((r, i) => (
        <UiEntity key={'r' + r.address} uiTransform={{ width: '100%', height: 36, flexDirection: 'row', alignItems: 'center', padding: { left: 10, right: 10 }, margin: { bottom: 4 }, borderRadius: 12 }} uiBackground={{ color: r.address === me ? PALE_BLUE : CLEAR }}>
          {T(String(i + 1), 14, { bold: true, width: 18 })}
          <UiEntity uiTransform={{ width: 10, height: 10, borderRadius: 5, margin: { right: 8 } }} uiBackground={{ color: rgb(PLAYER_COLOURS[r.colour % PLAYER_COLOURS.length]) }} />
          {T(r.address === me ? 'You' : r.name, 14, { bold: true, width: width - 190 })}
          {T(r.hits + ' pops, ' + (r.catches + r.grabs) + ' birds', 12, { color: GREY, width: 92, align: 'middle-right' })}
          {T(fmt(r.score), 14, { bold: true, width: 48, align: 'middle-right' })}
        </UiEntity>
      )),
      <UiEntity key="you" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, margin: { top: 6 }, borderRadius: 12 }} uiBackground={{ color: PALE_BLUE }}>
        <UiEntity uiTransform={{ flexDirection: 'column' }}>
          {caps('YOUR SCORE', BLUE_INK)}
          {T("becomes next round's budget", 12, { color: GREY })}
        </UiEntity>
        {T(fmt(mine?.score ?? 0), 18, { bold: true, color: BLUE_INK, align: 'middle-right', width: 70 })}
      </UiEntity>
    ],
    { width, margin: { right: 16 } },
    'results'
  )
}

function Shop(width: number) {
  const me = game.me
  const solo = game.scores.length < 2
  const gunRefund = GUNS[me.gun]?.price ?? 0
  const colW = Math.floor((width - 28 - 20) / 3)
  return card(
    [
      <UiEntity key="head" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <UiEntity uiTransform={{ flexDirection: 'column' }}>
          {caps('SHOP')}
          {T('Budget ' + fmt(me.budget), 20, { bold: true })}
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'flex-end' }}>
          {T('Left unspent when the round starts', 12, { color: GREY, align: 'middle-right' })}
          {T('becomes +' + feathersFromUnspent(me.budget, solo) + ' Feathers', 14, { bold: true, color: GREEN_INK, align: 'middle-right' })}
        </UiEntity>
      </UiEntity>,
      <UiEntity key="gh" uiTransform={{ margin: { top: 10, bottom: 6 } }}>{caps('GUN FOR NEXT ROUND')}</UiEntity>,
      <UiEntity key="guns" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}>
        {GUN_ORDER.map((id) => {
          const g = GUNS[id]
          const on = me.gun === id
          const affordable = g.price <= me.budget + gunRefund
          return (
            <UiEntity
              key={'gun-' + id}
              uiTransform={{ width: colW, flexDirection: 'column', padding: 10, borderRadius: 14, borderWidth: 2, borderColor: on ? BLUE : LINE }}
              uiBackground={{ color: on ? PALE_BLUE : WHITE }}
              onMouseDown={press(() => {
                if (!on && affordable) void room.send('buy', { item: 'gun:' + id })
              })}
            >
              <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                {T(g.name, 16, { bold: true })}
                {T(on ? 'Equipped' : g.price === 0 ? 'Free' : fmt(g.price), 13, { bold: true, color: on ? BLUE_INK : affordable ? NAVY : RED_INK, align: 'middle-right' })}
              </UiEntity>
              {icon(gunIcon(id), 64, 32)}
              {T(g.blurb, 11, { color: GREY, width: colW - 20, height: 30 })}
            </UiEntity>
          )
        })}
      </UiEntity>,
      <UiEntity key="ph" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: { top: 12, bottom: 6 } }}>
        {caps('PERKS: CHANGE THE ROUND FOR EVERYONE')}
        {T('You hold ' + me.perks.length + ' of ' + MAX_HELD_PERKS, 12, { color: GREY, align: 'middle-right' })}
      </UiEntity>,
      ...PERK_ORDER.map((id) => {
        const perk = PERKS[id]
        const held = me.perks.filter((p) => p === id).length
        const can = me.perks.length < MAX_HELD_PERKS && perk.price <= me.budget
        return (
          <UiEntity key={'perk-' + id} uiTransform={{ width: '100%', height: 44, flexDirection: 'row', alignItems: 'center', padding: { left: 10, right: 6 }, margin: { bottom: 6 }, borderRadius: 12, borderWidth: 2, borderColor: LINE }} uiBackground={{ color: WHITE }}>
            {icon(perkIcon(id), 22)}
            <UiEntity uiTransform={{ width: 8 }} />
            {T(perk.name, 14, { bold: true, width: 104 })}
            {T(perk.blurb, 12, { color: GREY, width: width - 300 })}
            {T(fmt(perk.price), 13, { bold: true, width: 44, align: 'middle-right' })}
            <UiEntity uiTransform={{ width: 8 }} />
            {pill(held > 0 ? (can ? 'Buy +1' : 'Held') : 'Buy', can ? BLUE : held > 0 ? GREEN : DISABLED, WHITE, can ? () => void room.send('buy', { item: 'perk:' + id }) : null, 64)}
          </UiEntity>
        )
      })
    ],
    { width, padding: { top: 14, right: 16, bottom: 10, left: 16 }, margin: { right: 16 } },
    'shop'
  )
}

function boardPlace() {
  const me = getMyAddress()
  const entries = game.board.entries
  const at = entries.findIndex((e) => e.a === me)
  return { entries, at }
}

function Week(width: number, key = 'week') {
  const { entries, at } = boardPlace()
  const t = serverNow()
  const rival = at > 0 ? entries[at - 1] : null
  const mine = at >= 0 ? entries[at] : null
  const goldenIn = game.arena.goldenAt - t
  return card(
    [
      <UiEntity key="h" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        {caps('THIS WEEK')}
        {T('resets in ' + longWait(game.arena.weekEnds - t), 12, { color: GREY, align: 'middle-right' })}
      </UiEntity>,
      <UiEntity key="place" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: { left: 12, right: 12, top: 8, bottom: 8 }, margin: { top: 8 }, borderRadius: 14 }} uiBackground={{ color: PALE_BLUE }}>
        <UiEntity uiTransform={{ flexDirection: 'column' }}>
          {caps('YOUR PLACE', BLUE_INK)}
          {T(mine ? 'best round ' + fmt(mine.s) : 'score a round to get on the board', 12, { color: GREY })}
        </UiEntity>
        {T(at >= 0 ? '#' + (at + 1) : '-', 26, { bold: true, color: BLUE_INK, align: 'middle-right', width: 60 })}
      </UiEntity>,
      rival && mine ? (
        <UiEntity key="rival" uiTransform={{ width: '100%', flexDirection: 'column', padding: { left: 12, right: 12, top: 8, bottom: 8 }, margin: { top: 8 }, borderRadius: 14, borderWidth: 2, borderColor: LINE }} uiBackground={{ color: WHITE }}>
          {caps('RIVAL JUST ABOVE YOU')}
          {T('#' + at + ' ' + rival.n + ', ' + fmt(rival.s), 15, { bold: true })}
          {T(fmt(rival.s - mine.s + 1) + ' more in one round passes them', 12, { color: GREY })}
        </UiEntity>
      ) : null,
      <UiEntity key="top" uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: 6 } }}>
        {entries.slice(0, 5).map((e, i) => (
          <UiEntity key={'w' + e.a} uiTransform={{ width: '100%', height: 28, flexDirection: 'row', alignItems: 'center', padding: { left: 4, right: 4 } }}>
            {T('#' + (i + 1), 13, { bold: true, color: GREY, width: 26 })}
            {T(e.n, 13, { width: width - 150 })}
            {T('LV ' + e.lv, 11, { color: GREY, width: 40 })}
            {T(fmt(e.s), 13, { bold: true, width: 50, align: 'middle-right' })}
          </UiEntity>
        ))}
      </UiEntity>,
      <UiEntity key="golden" uiTransform={{ width: '100%', height: 46, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: { left: 12, right: 12 }, margin: { top: 8 }, borderRadius: 14, borderWidth: 2, borderColor: GOLD_RIM }} uiBackground={{ color: GOLD_FILL }}>
        <UiEntity uiTransform={{ flexDirection: 'column' }}>
          {caps('GOLDEN HOUR', GOLD_INK)}
          {T('every day, 19:00 UTC', 12, { color: GOLD_DARK })}
        </UiEntity>
        {T(game.arena.golden ? 'on now' : 'in ' + longWait(goldenIn), 17, { bold: true, color: GOLD_DARK, align: 'middle-right', width: 90 })}
      </UiEntity>
    ],
    { width },
    key
  )
}

function BreakScreen() {
  if (!inBreak()) return null
  const r = game.round
  const header = (
    <UiEntity key="hdr" uiTransform={{ width: '100%', justifyContent: 'center', flexDirection: 'row', margin: { bottom: 14 } }}>
      <UiEntity uiTransform={{ height: 52, flexDirection: 'row', alignItems: 'center', padding: { left: 22, right: 22 }, borderRadius: 26, borderWidth: 3, borderColor: WHITE }} uiBackground={{ color: PALE }}>
        {T('Round ' + r.round + ' over', 20, { bold: true })}
        <UiEntity uiTransform={{ width: 2, height: 24, margin: { left: 16, right: 16 } }} uiBackground={{ color: RIM }} />
        {T('Next round in', 15, { color: GREY })}
        <UiEntity uiTransform={{ width: 8 }} />
        {T(clock(r.endsAt - serverNow()), 22, { bold: true, color: BLUE_INK, width: 56 })}
      </UiEntity>
    </UiEntity>
  )

  if (onPhone()) {
    const tabs: [typeof ui.phoneTab, string][] = [
      ['results', 'Results'],
      ['shop', 'Shop'],
      ['week', 'This week']
    ]
    return (
      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 8, left: 0 }, width: '100%', flexDirection: 'column', alignItems: 'center' }}>
        <UiEntity uiTransform={{ flexDirection: 'row', margin: { bottom: 8 } }}>
          {tabs.map(([id, label]) => (
            <UiEntity key={'pt' + id} uiTransform={{ margin: { left: 4, right: 4 } }}>
              {pill(label + (id === 'shop' ? '' : ''), ui.phoneTab === id ? BLUE : WHITE, ui.phoneTab === id ? WHITE : NAVY, () => (ui.phoneTab = id), 110, 34)}
            </UiEntity>
          ))}
          <UiEntity uiTransform={{ margin: { left: 8 } }}>{pill(clock(r.endsAt - serverNow()), PALE, BLUE_INK, null, 60, 34)}</UiEntity>
        </UiEntity>
        {ui.phoneTab === 'results' ? Results(420) : ui.phoneTab === 'shop' ? Shop(600) : Week(360, 'week-phone')}
      </UiEntity>
    )
  }

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 20, left: 0 }, width: '100%', flexDirection: 'column', alignItems: 'center' }}>
      {header}
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {Results(300)}
        {Shop(560)}
        {Week(290)}
      </UiEntity>
    </UiEntity>
  )
}

// The weekly board on its own, from the trophy button during a round
function BoardPanel() {
  if (!ui.board || inBreak()) return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 96, right: 272 }, flexDirection: 'column', alignItems: 'flex-end' }}>
      {Week(290, 'week-panel')}
      <UiEntity uiTransform={{ margin: { top: 6 } }}>{pill('Close', WHITE, NAVY, () => (ui.board = false), 80, 30)}</UiEntity>
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// The locker: Pixel Golf's pro shop panel, centred
// ---------------------------------------------------------------------------
function worn(kind: CosmeticKind): string {
  return kind === 'paint' ? game.me.paint : kind === 'trace' ? game.me.trace : game.me.title
}

function Locker() {
  if (!ui.locker) return null
  const me = game.me
  const kind = ui.lockerTab
  const list = COSMETICS.filter((c) => c.kind === kind)
  const wearing = worn(kind)
  const ringed = ui.picked || wearing
  const sel: Cosmetic = list.find((c) => c.id === ringed) ?? list[0]
  const has = (c: Cosmetic) => hasCosmetic(c, me.owned, me.level, me.top3Weeks)
  const selOwn = has(sel)

  let confirmLabel = 'Wearing'
  let confirmFill = DISABLED
  let note = 'Wearing now'
  let action: (() => void) | null = null
  if (!me.ready) {
    confirmLabel = 'Loading your locker...'
    note = ''
  } else if (sel.id !== wearing) {
    if (selOwn) {
      confirmLabel = 'Wear it'
      confirmFill = BLUE
      note = 'You own this'
      action = () => void room.send('buy', { item: 'wear:' + sel.id })
    } else if (sel.cost) {
      const ok = sel.cost <= me.feathers
      confirmLabel = ok ? 'Buy for ' + fmt(sel.cost) + ' Feathers' : 'Need ' + fmt(sel.cost - me.feathers) + ' more Feathers'
      confirmFill = ok ? GREEN : DISABLED
      note = fmt(sel.cost) + ' Feathers'
      if (ok) action = () => void room.send('buy', { item: 'cos:' + sel.id })
    } else if (sel.earned) {
      confirmLabel = 'Top 3 in a week, 3 times'
      note = 'Earned, never bought (' + me.top3Weeks + ' of 3)'
    } else {
      confirmLabel = 'Unlocks at LV ' + sel.level
      note = 'Reach level ' + sel.level + ' (' + fmt(Math.max(0, xpForLevel(sel.level ?? 1) - me.xp)) + ' points to go)'
    }
  }

  const tabs: [CosmeticKind, string][] = [
    ['paint', 'Gun paint'],
    ['trace', 'Tracers'],
    ['title', 'Titles']
  ]
  const W = 400
  const cell = Math.floor((W - 32 - 30) / 4)

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: onPhone() ? 10 : 70, left: '50%' }, margin: { left: -W / 2 }, width: W }}>
      {card(
        [
          <UiEntity key="h" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {T('Locker', 22, { bold: true })}
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center' }}>
              <UiEntity uiTransform={{ height: 30, flexDirection: 'row', alignItems: 'center', padding: { left: 10, right: 12 }, borderRadius: 15 }} uiBackground={{ color: PALE_GREEN }}>
                {icon(ICON.feather, 16)}
                <UiEntity uiTransform={{ width: 6 }} />
                {T((me.ready ? fmt(me.feathers) : '-') + ' Feathers', 14, { bold: true, color: GREEN_INK })}
              </UiEntity>
              {roundButton(ICON.close, () => (ui.locker = false), 'close', 32)}
            </UiEntity>
          </UiEntity>,
          <UiEntity key="tabs" uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { top: 12 } }}>
            {tabs.map(([id, label]) => (
              <UiEntity key={'tab' + id}>
                {pill(label, kind === id ? BLUE : WHITE, kind === id ? WHITE : NAVY, () => {
                  ui.lockerTab = id
                  ui.picked = ''
                }, 116, 36)}
              </UiEntity>
            ))}
          </UiEntity>,
          <UiEntity key="preview" uiTransform={{ width: '100%', height: 84, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', margin: { top: 12 }, borderRadius: 16, borderWidth: 2, borderColor: LINE }} uiBackground={{ color: WHITE }}>
            <UiEntity uiTransform={{ width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: NAVY }} uiBackground={{ color: rgb(sel.colour) }} />
            <UiEntity uiTransform={{ flexDirection: 'column', margin: { left: 16 } }}>
              {caps(kind === 'paint' ? 'GUN PAINT' : kind === 'trace' ? 'TRACER' : 'TITLE ABOVE YOUR NAME')}
              {T(sel.name, 18, { bold: true })}
              {T(note, 12, { color: GREY })}
            </UiEntity>
          </UiEntity>,
          <UiEntity key="grid" uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', margin: { top: 12 } }}>
            {list.map((c, i) => {
              const own = has(c)
              let tag = 'Owned'
              let tagInk = GREEN_INK
              if (c.id === wearing) {
                tag = 'Wearing'
                tagInk = BLUE_INK
              } else if (!own && c.earned) {
                tag = 'Earned'
                tagInk = GREY
              } else if (!own && c.cost) {
                tag = fmt(c.cost)
                tagInk = NAVY
              } else if (!own) {
                tag = 'LV ' + c.level
                tagInk = GREY
              }
              return (
                <UiEntity
                  key={'c' + c.id}
                  uiTransform={{ width: cell, height: 74, flexDirection: 'column', justifyContent: 'center', alignItems: 'center', margin: { right: i % 4 === 3 ? 0 : 10, bottom: 10 }, borderRadius: 14, borderWidth: 3, borderColor: c.id === ringed ? BLUE : LINE }}
                  uiBackground={{ color: WHITE }}
                  onMouseDown={press(() => (ui.picked = c.id === wearing ? '' : c.id))}
                >
                  <UiEntity uiTransform={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: NAVY }} uiBackground={{ color: rgb(c.colour) }} />
                  {T(tag, 11, { bold: true, color: tagInk, align: 'middle-center', width: cell - 6 })}
                </UiEntity>
              )
            })}
          </UiEntity>,
          <UiEntity key="confirm" uiTransform={{ width: '100%', margin: { top: 2 } }}>
            {pill(confirmLabel, confirmFill, WHITE, action, W - 34, 44)}
          </UiEntity>,
          <UiEntity key="foot" uiTransform={{ width: '100%', margin: { top: 8 } }}>
            {T('Cosmetics never change a round. Feathers come from budget you leave unspent.', 12, { color: GREY, align: 'middle-center', width: W - 34 })}
          </UiEntity>
        ],
        { width: W, padding: 16, borderRadius: 22 },
        'locker'
      )}
    </UiEntity>
  )
}

// ---------------------------------------------------------------------------
// Crosshair while aiming
// ---------------------------------------------------------------------------
function Crosshair() {
  const locked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? false
  if (!locked || !playing()) return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 48, height: 48, pointerFilter: 'none' }} uiBackground={{ textureMode: 'stretch', texture: { src: 'assets/Images/crosshair.png' } }} />
    </UiEntity>
  )
}

const GameUi = () => {
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', pointerFilter: 'none' }}>
      <PerkBanner />
      <Toasts />
      <RoundCard />
      <PerkTray />
      <HowToPlay />
      <BreakScreen />
      <BoardPanel />
      <Locker />
      <Crosshair />
    </UiEntity>
  )
}
