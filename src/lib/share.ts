import type { FieldGoal } from './board/goal'
import { cardDbMeta } from './card-db'

/**
 * Share and diagnostic codes: a setup — deck, board, tab, games, seed — or one
 * game of it, as a string to paste somewhere and import again.
 *
 * Every game is seeded: it depends only on the deck, the board, the run's seed,
 * its deal number and its turn order. So a code reproduces it exactly, on any
 * machine running the same card data. Boards name cards by their place in the
 * card database, so a code records which data it was made with and warns when
 * imported against different data.
 */

export type ShareTab = 'turns' | 'board'

export interface SharePayload {
  v: 1
  /** The card data the code was made with. */
  db: string
  deck: string
  goal: FieldGoal
  tab: ShareTab
  games: number
  seed: number
  /** One game of the run: its deal and turn order. Absent for a whole setup. */
  game?: { trial: number; goingFirst: boolean }
}

/** This build's card data, short. */
export const cardDataVersion = (): string => cardDbMeta.sourceSha256.tcgdex.slice(0, 12)

const PREFIX = 'IS1-'
const PLAIN_PREFIX = 'IS0-'

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): Uint8Array => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** The payload as a code: compressed where the browser can, plain otherwise. */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  if (typeof CompressionStream === 'undefined') return PLAIN_PREFIX + toBase64Url(bytes)
  return PREFIX + toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))
}

/** A code back into its payload; throws with a readable message if it is not one. */
export async function decodeShare(code: string): Promise<SharePayload> {
  const text = code.trim()
  let bytes: Uint8Array
  try {
    if (text.startsWith(PREFIX)) {
      bytes = await pipe(fromBase64Url(text.slice(PREFIX.length)), new DecompressionStream('deflate-raw'))
    } else if (text.startsWith(PLAIN_PREFIX)) {
      bytes = fromBase64Url(text.slice(PLAIN_PREFIX.length))
    } else {
      throw new Error('prefix')
    }
  } catch {
    throw new Error('That is not an Ideal Start code.')
  }
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as SharePayload
  if (payload.v !== 1 || typeof payload.deck !== 'string' || !payload.goal) {
    throw new Error('That code is from a version of Ideal Start this one cannot read.')
  }
  return payload
}
