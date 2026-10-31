import { useCallback, useEffect, useRef, useState } from 'react'

import { goalIsEmpty, type FieldGoal } from './board/goal'
import type { ProgressPreview } from './sim/preview'
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
  /** The run in flight's totals so far, for a preview of how it is shaping up. */
  preview: ProgressPreview | null
}

const idle = { progress: 0, total: 0, startedAt: null, running: false, error: null, preview: null }

export type PlaytestState = SimulationControl<ResultOf['board']>
export type TurnsState = SimulationControl<ResultOf['turns']>

/** A run's inputs, to tell whether the result on show still matches the board. */
interface RunInputs {
  cards: DeckCard[]
  goal: FieldGoal
  trials: number
  seed: number
}

export interface SimulationControl<R> extends SimulationState<R> {
  /**
   * The deck, board or number of games has changed since the run on show (or
   * in flight) started, so its figures describe a different board.
   */
  stale: boolean
  /**
   * Start a run on the board as it is now, stopping one still going. Pass
   * `trials` to run a different number of games than the picker holds, for
   * "play fewer games" while its new value has not landed yet; and
   * `onlyTrials` to play just those deals — a shared game, replayed.
   */
  search: (options?: { trials?: number; onlyTrials?: number[] }) => void
  /** The deals the run on show was limited to; null for a full run. */
  only: number[] | null
  /**
   * Which run the result on show came from. Updates within a run keep it, so
   * what a viewer picked in the results (an example game) survives them.
   */
  runId: number
}

/**
 * Runs a simulation in a worker when asked to — the Search button — rather than
 * on every edit: building a board takes several placements, and a run started
 * after each one spent the machine on boards nobody wanted played out.
 *
 * One worker is kept for the life of the component, and a run already in
 * flight is ignored once a newer one is requested, so results can never
 * arrive out of order.
 */
export function useSimulation<M extends SimulationMode>(
  mode: M,
  cards: DeckCard[],
  goal: FieldGoal,
  trials: number,
  seed: number,
): SimulationControl<ResultOf[M]> {
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)
  // The inputs of the last run started.
  const [ran, setRan] = useState<RunInputs | null>(null)
  const [state, setState] = useState<SimulationState<ResultOf[M]>>({ result: null, ...idle })
  const [runId, setRunId] = useState(0)

  // Whether the worker is partway through a run.
  const busy = useRef(false)

  /**
   * A fresh worker. A run cannot be interrupted from outside — the worker is
   * busy until it finishes — so a run that is no longer wanted is stopped by
   * replacing the worker. Queuing behind it instead left the new run's clock
   * ticking while nothing visibly happened, then every game seemingly finished
   * at once.
   */
  const spawn = useCallback(() => {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../worker/playtest.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    busy.current = false

    worker.onmessage = (event: MessageEvent<PlaytestResponse>) => {
      const message = event.data
      // A result from a superseded run is discarded rather than flashed up.
      if (message.id !== requestId.current) return

      if (message.kind === 'progress') {
        setState((current) => ({
          ...current,
          progress: message.done,
          total: message.total,
          preview: message.preview ?? current.preview,
        }))
      } else if (message.kind === 'partial') {
        setRunId(message.id)
        // Shown as the result, still running: the panels mark it as updating.
        setState((current) => ({ ...current, result: message.result as ResultOf[M] }))
      } else if (message.kind === 'done') {
        busy.current = false
        setRunId(message.id)
        setState({ result: message.result as ResultOf[M], ...idle })
      } else {
        busy.current = false
        setState({ result: null, ...idle, error: message.message })
      }
    }
    return worker
  }, [])

  useEffect(() => {
    spawn()
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [spawn])

  const [only, setOnly] = useState<number[] | null>(null)
  const search = useCallback(
    (options?: { trials?: number; onlyTrials?: number[] }) => {
      if (cards.length === 0 || goalIsEmpty(goal)) return
      const runTrials = options?.trials ?? trials
      const onlyTrials = options?.onlyTrials
      setOnly(onlyTrials ?? null)
      // Stop a run still going rather than queue behind it.
      const worker = busy.current ? spawn() : workerRef.current
      if (!worker) return
      busy.current = true
      const id = ++requestId.current
      setRan({ cards, goal, trials: runTrials, seed })
      setState((current) => ({
        ...current,
        running: true,
        progress: 0,
        total: runTrials,
        startedAt: performance.now(),
        error: null,
        preview: null,
      }))
      const request: PlaytestRequest = { id, mode, cards, goal, trials: runTrials, seed, onlyTrials }
      worker.postMessage(request)
    },
    [mode, cards, goal, trials, seed, spawn],
  )

  const stale =
    ran !== null &&
    (ran.cards !== cards || ran.goal !== goal || ran.trials !== trials || ran.seed !== seed)

  return { ...state, stale, search, only, runId }
}

/** The turn-1 board playtest. */
export const usePlaytest = (
  cards: DeckCard[],
  goal: FieldGoal,
  trials: number,
  seed: number,
): PlaytestState => useSimulation('board', cards, goal, trials, seed)

/** How many turns the board takes. */
export const useTurns = (
  cards: DeckCard[],
  goal: FieldGoal,
  trials: number,
  seed: number,
): TurnsState => useSimulation('turns', cards, goal, trials, seed)
