/// <reference lib="webworker" />
import type { FieldGoal } from '../lib/board/goal'
import { playtest, type PlaytestResult } from '../lib/sim/playtest'
import { turnsTest, type TurnsResult } from '../lib/sim/turns'
import type { DeckCard } from '../lib/types'

/**
 * Runs the simulations off the main thread: the turn-1 playtest, or how many
 * turns a board takes.
 *
 * Thousands of trials, each running a bounded search, is far too slow to block
 * the UI — this is the work the compute layer was kept pure and serialisable
 * for. Progress is streamed so a long run shows movement rather than freezing.
 */
export type SimulationMode = 'board' | 'turns'

export interface ResultOf {
  board: PlaytestResult
  turns: TurnsResult
}

export interface PlaytestRequest {
  id: number
  mode: SimulationMode
  cards: DeckCard[]
  goal: FieldGoal
  trials: number
  seed: number
  maxNodes?: number
}

export type PlaytestResponse =
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'done'; result: PlaytestResult | TurnsResult }
  | { id: number; kind: 'error'; message: string }

self.onmessage = (event: MessageEvent<PlaytestRequest>) => {
  const { id, mode, cards, goal, trials, seed, maxNodes } = event.data
  const post = (message: PlaytestResponse) => self.postMessage(message)

  try {
    const byKey = new Map(cards.map((card) => [card.key, card.label]))
    const labelFor = (key: string) => byKey.get(key) ?? key
    const options = {
      trials,
      seed,
      maxNodes,
      onProgress: (done: number, total: number) => post({ id, kind: 'progress', done, total }),
    }
    const result =
      mode === 'turns' ? turnsTest(cards, goal, labelFor, options) : playtest(cards, goal, labelFor, options)
    post({ id, kind: 'done', result })
  } catch (error) {
    post({ id, kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
