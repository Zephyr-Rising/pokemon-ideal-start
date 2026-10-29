import { useEffect, useRef, useState } from 'react'

import { goalIsEmpty, type FieldGoal } from './board/goal'
import type { PlaytestResult } from './sim/playtest'
import type { DeckCard } from './types'
import type { PlaytestRequest, PlaytestResponse } from '../worker/playtest.worker'

export interface PlaytestState {
  result: PlaytestResult | null
  /** Trials completed in the run currently in flight. */
  progress: number
  running: boolean
  error: string | null
}

const DEBOUNCE_MS = 350

/**
 * Runs the turn-1 playtest in a worker, re-running when the deck or goal
 * changes.
 *
 * Edits are debounced: dragging a card across several slots should not start a
 * run per frame. One worker is kept for the life of the component, and a run
 * already in flight is ignored once a newer one is requested, so results can
 * never arrive out of order.
 */
export function usePlaytest(
  cards: DeckCard[],
  goal: FieldGoal,
  trials: number,
  seed: number,
): PlaytestState {
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const [state, setState] = useState<PlaytestState>({
    result: null,
    progress: 0,
    running: false,
    error: null,
  })

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
        setState((current) => ({ ...current, progress: message.done }))
      } else if (message.kind === 'done') {
        setState({ result: message.result, progress: 0, running: false, error: null })
      } else {
        setState({ result: null, progress: 0, running: false, error: message.message })
      }
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (cards.length === 0 || goalIsEmpty(goal)) {
      setState({ result: null, progress: 0, running: false, error: null })
      return
    }

    const timer = setTimeout(() => {
      const worker = workerRef.current
      if (!worker) return
      const id = ++requestId.current
      setState((current) => ({ ...current, running: true, progress: 0, error: null }))
      const request: PlaytestRequest = { id, cards, goal, trials, seed }
      worker.postMessage(request)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [cards, goal, trials, seed])

  return state
}
