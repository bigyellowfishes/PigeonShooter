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

export function pushToast(text: string, colour: [number, number, number] = [0.118, 0.204, 0.259], seconds = 2.2, big = false) {
  toasts.push({ text, colour, until: Date.now() + seconds * 1000, big })
  while (toasts.length > 4) toasts.shift()
}

export function liveToasts(): Toast[] {
  const now = Date.now()
  while (toasts.length && toasts[0].until < now) toasts.shift()
  return toasts
}

const GOLD: [number, number, number] = [0.48, 0.32, 0]
const GREEN: [number, number, number] = [0.14, 0.44, 0.1]
const RED: [number, number, number] = [0.7, 0.15, 0.12]
const GREY: [number, number, number] = [0.34, 0.39, 0.44]
const BLUE: [number, number, number] = [0.06, 0.44, 0.59]

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
    case 'perk':
      pushToast((mine ? 'You fired ' : e.whoName + ' fired ') + e.otherName + '!', BLUE, 2.4, true)
      break
    case 'crate':
      if (mine) pushToast(e.otherName ? 'Crate! Free perk: ' + e.otherName : 'Crate! +' + e.points + ' (perks full)', GREEN, 2.4, true)
      break
    case 'decoy':
      if (mine) pushToast('Decoy! Streak lost' + (e.points < 0 ? ' ' + e.points : ''), RED, 2.2, true)
      break
    case 'feathers':
      if (mine) pushToast('+' + e.points + ' Feathers from your unspent budget', GREEN, 3)
      break
    case 'refused':
      if (mine) pushToast(e.otherName, RED, 2)
      break
    case 'goldenStart':
      pushToast('GOLDEN HOUR! Golden pigeons are worth double', GOLD, 4, true)
      break
    case 'goldenEnd':
      pushToast('Golden Hour is over. Back tomorrow at 19:00 UTC', GOLD, 3)
      break
  }
}
