/// <reference lib="webworker" />
import type { FieldGoal } from '../lib/board/goal'
import { playtest, type PlaytestResult } from '../lib/sim/playtest'
import type { DeckCard } from '../lib/types'

/**
 * Runs the turn-1 playtest off the main thread.
 *
 * Thousands of trials, each running a bounded search, is far too slow to block
 * the UI — this is the work the compute layer was kept pure and serialisable
 * for. Progress is streamed so a long run shows movement rather than freezing.
 */
export interface PlaytestRequest {
  id: number
  cards: DeckCard[]
  goal: FieldGoal
  trials: number
  seed: number
  maxNodes?: number
}

export type PlaytestResponse =
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'done'; result: PlaytestResult }
  | { id: number; kind: 'error'; message: string }

self.onmessage = (event: MessageEvent<PlaytestRequest>) => {
  const { id, cards, goal, trials, seed, maxNodes } = event.data
  const post = (message: PlaytestResponse) => self.postMessage(message)

  try {
    const byKey = new Map(cards.map((card) => [card.key, card.label]))
    const result = playtest(cards, goal, (key) => byKey.get(key) ?? key, {
      trials,
      seed,
      maxNodes,
      onProgress: (done, total) => post({ id, kind: 'progress', done, total }),
    })
    post({ id, kind: 'done', result })
  } catch (error) {
    post({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
