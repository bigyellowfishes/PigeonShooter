import { getPlayer } from '@dcl/sdk/players'
import { GameEvent } from '../shared/messages'

// Small client-side store the HUD reads every frame.

export type Toast = { text: string; colour: [number, number, number]; until: number; big: boolean }

export const toasts: Toast[] = []

let myAddress = ''

export function getMyAddress(): string {
  if (!myAddress) {
    const me = getPlayer()
    if (me?.userId) myAddress = me.userId.toLowerCase()
  }
  return myAddress
}

export function getMyName(): string {
  return getPlayer()?.name ?? ''
}

export function pushToast(text: string, colour: [number, number, number] = [1, 1, 1], seconds = 2.2, big = false) {
  toasts.push({ text, colour, until: Date.now() + seconds * 1000, big })
  while (toasts.length > 4) toasts.shift()
}

export function liveToasts(): Toast[] {
  const now = Date.now()
  while (toasts.length && toasts[0].until < now) toasts.shift()
  return toasts
}

const GOLD: [number, number, number] = [1, 0.85, 0.2]
const GREEN: [number, number, number] = [0.45, 1, 0.45]
const RED: [number, number, number] = [1, 0.45, 0.4]
const GREY: [number, number, number] = [0.85, 0.85, 0.85]

function mult(m: number): string {
  return m > 1.01 ? '  x' + (Math.round(m * 10) / 10).toString() : ''
}

// Turn a server event into the toasts this player should see
export function onGameEvent(e: GameEvent) {
  const me = getMyAddress()
  const mine = e.who === me
  switch (e.kind) {
    case 'hit':
      if (mine) pushToast('POP! +' + e.points + mult(e.multiplier), GOLD, 1.8, true)
      break
    case 'miss':
      if (mine) pushToast('Miss', GREY, 0.8)
      break
    case 'catch':
      if (mine) pushToast('CAUGHT! +' + e.points + mult(e.multiplier), GREEN, 2.2, true)
      break
    case 'grab':
      if (mine) pushToast('Grabbed +' + e.points, GREEN, 1.8)
      break
    case 'steal':
      if (mine) pushToast('Stole from ' + e.otherName + '! +' + e.points, GREEN, 2.2, true)
      else if (e.other === me) pushToast(e.whoName + ' stole your pigeon!', RED, 2.5, true)
      break
    case 'lost':
      if (mine) pushToast('It landed! Grab it before someone else does', RED, 2)
      break
    case 'roundStart':
      pushToast('GO! Pop the parachutes!', GOLD, 2.5, true)
      break
    case 'roundEnd':
      pushToast("Time's up!", GOLD, 2.5, true)
      break
  }
}
