import { useEffect, useRef, useState } from 'react'

import { goalIsEmpty, type FieldGoal } from './board/goal'
import type { DeckCard } from './types'
import type {
  PlaytestRequest,
  PlaytestResponse,
  ResultOf,
  SimulationMode,
} from '../worker/playtest.worker'

export interface SimulationState<R> {
  result: R | null
  /** Trials completed in the run currently in flight. */
  progress: number
  /** Trials the run in flight will play. */
  total: number
  /** When the run in flight started, from `performance.now()`. */
  startedAt: number | null
  running: boolean
  error: string | null
}

const idle = { progress: 0, total: 0, startedAt: null, running: false, error: null }

export type PlaytestState = SimulationState<ResultOf['board']>
export type TurnsState = SimulationState<ResultOf['turns']>

const DEBOUNCE_MS = 350

/**
 * Runs a simulation in a worker, re-running when the deck or goal changes.
 *
 * Edits are debounced: dragging a card across several slots should not start a
 * run per frame. One worker is kept for the life of the component, and a run
 * already in flight is ignored once a newer one is requested, so results can
 * never arrive out of order.
 *
 * While `enabled` is false nothing runs, so a tab that is not showing costs
 * nothing. Coming back to it re-runs only if its inputs changed meanwhile.
 */
export function useSimulation<M extends SimulationMode>(
  mode: M,
  cards: DeckCard[],
  goal: FieldGoal,
  trials: number,
  seed: number,
  enabled = true,
): SimulationState<ResultOf[M]> {
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)
  // The inputs of the last run started, to skip a re-run on returning to a tab.
  const lastRun = useRef<{ cards: DeckCard[]; goal: FieldGoal; trials: number; seed: number } | null>(
    null,
  )
  const [state, setState] = useState<SimulationState<ResultOf[M]>>({ result: null, ...idle })

  useEffect(() => {
    const worker = new Worker(new URL('../worker/playtest.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<PlaytestResponse>) => {
      const message = event.data
      // A result from a superseded run is discarded rather than flashed up.
      if (message.id !== requestId.current) return

      if (message.kind === 'progress') {
        setState((current) => ({ ...current, progress: message.done, total: message.total }))
      } else if (message.kind === 'done') {
        setState({ result: message.result as ResultOf[M], ...idle })
      } else {
        setState({ result: null, ...idle, error: message.message })
      }
    }

    return () => {
      worker.terminate()
      workerRef.current = null
      // The worker is gone, so whatever it was running will never report back.
      lastRun.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (cards.length === 0 || goalIsEmpty(goal)) {
      lastRun.current = null
      setState({ result: null, ...idle })
      return
    }
    const last = lastRun.current
    if (
      last &&
      last.cards === cards &&
      last.goal === goal &&
      last.trials === trials &&
      last.seed === seed
    ) {
      return
    }

    const timer = setTimeout(() => {
      const worker = workerRef.current
      if (!worker) return
      const id = ++requestId.current
      lastRun.current = { cards, goal, trials, seed }
      setState((current) => ({
        ...current,
        running: true,
        progress: 0,
        total: trials,
        startedAt: performance.now(),
        error: null,
      }))
      const request: PlaytestRequest = { id, mode, cards, goal, trials, seed }
      worker.postMessage(request)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [mode, cards, goal, trials, seed, enabled])

  return state
}

/** The turn-1 board playtest. */
export const usePlaytest = (
  cards: DeckCard[],
  goal: FieldGoal,
  trials: number,
  seed: number,
  enabled = true,
): PlaytestState => useSimulation('board', cards, goal, trials, seed, enabled)

/** How many turns the board takes. */
export const useTurns = (
  cards: DeckCard[],
  goal: FieldGoal,
  trials: number,
  seed: number,
  enabled = true,
): TurnsState => useSimulation('turns', cards, goal, trials, seed, enabled)
