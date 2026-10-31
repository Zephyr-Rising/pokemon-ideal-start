/**
 * The running totals a simulation reports alongside its progress, so the page
 * can draw how the result is shaping up before the run finishes.
 *
 * Only counts the run keeps anyway, copied: a few numbers per report, against
 * games that each take milliseconds to search, so it costs the run nothing it
 * would notice.
 */
export type ProgressPreview =
  /** Games that first built the board on each turn, [0] being turn 1, per turn order. */
  | { kind: 'turns'; first: number[]; second: number[] }
  /** Games that built the board, per turn order. */
  | { kind: 'board'; first: number; second: number }

/** How far through a run its full result starts being shown, updating as games finish. */
export const PARTIAL_FROM = 0.8

/** The shape of every simulation's progress callback. */
export type OnProgress = (done: number, total: number, preview?: ProgressPreview) => void
