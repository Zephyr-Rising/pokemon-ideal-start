import type { DeckCard } from '../types'
import { isImplemented } from './effects'
import { MAX_TURNS, summarise, type TurnsOrderResult } from './turns'

/**
 * How much luck moves the turn a board comes together, and which luck.
 *
 * Every game played for "Turns to build" is also a record of its luck: what the
 * opening hand held and what went into the prizes, both settled before a card
 * is played. Grouping games by those shows how much each matters, and the
 * spread of turns across all games shows how far luck alone can move a result.
 */

/** One game's luck and its result. */
export interface LuckRecord {
  /** The board's pieces in the opening seven. */
  piecesInHand: number
  /** Supporters the simulator can play, in the opening seven. */
  supportersInHand: number
  /** The board's pieces in the prizes. */
  piecesPrized: number
  /** The turn it built the board, or null if not by MAX_TURNS. */
  turn: number | null
}

export interface LuckBucket extends TurnsOrderResult {
  label: string
  /** Share of all games that fall in this bucket. */
  share: number
}

export interface LuckFactor {
  name: string
  buckets: LuckBucket[]
}

export interface LuckStat {
  /**
   * The turn by which a given share of games has the board, from the luckiest
   * 10% to the unluckiest; null where that share never gets there by
   * MAX_TURNS.
   */
  percentiles: { share: number; turn: number | null }[]
  factors: LuckFactor[]
}

const SHARES = [0.1, 0.25, 0.5, 0.75, 0.9]

/** What counts as one of the board's pieces, and as a playable Supporter. */
export function luckCounters(relevant: Set<string>) {
  const isPiece = (card: DeckCard) => relevant.has(card.key)
  const isSupporter = (card: DeckCard) => card.tags.includes('supporter') && isImplemented(card)
  return {
    record(hand: DeckCard[], prizes: DeckCard[], turn: number | null): LuckRecord {
      return {
        piecesInHand: hand.filter(isPiece).length,
        supportersInHand: hand.filter(isSupporter).length,
        piecesPrized: prizes.filter(isPiece).length,
        turn,
      }
    },
  }
}

export function summariseLuck(records: LuckRecord[]): LuckStat {
  const total = records.length
  const sorted = records
    .map((record) => record.turn ?? Infinity)
    .sort((a, b) => a - b)
  const percentiles = SHARES.map((share) => {
    // The turn by which at least this share of games has it.
    const at = sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)]
    return { share, turn: at === undefined || at === Infinity ? null : at }
  })

  /** Group by a value, capping the last group ("3 or more"). */
  const factor = (
    name: string,
    value: (record: LuckRecord) => number,
    cap: number,
    unit: (n: number) => string,
  ): LuckFactor => {
    const buckets: LuckBucket[] = []
    for (let n = 0; n <= cap; n++) {
      const inBucket = records.filter((r) => (n === cap ? value(r) >= cap : value(r) === n))
      if (inBucket.length === 0) continue
      const byTurn = Array.from({ length: MAX_TURNS }, (_, i) =>
        inBucket.filter((r) => r.turn === i + 1).length / inBucket.length,
      )
      buckets.push({
        label: n === cap ? `${unit(n)} or more` : unit(n),
        share: inBucket.length / total,
        ...summarise(byTurn),
      })
    }
    return { name, buckets }
  }

  return {
    percentiles,
    factors:
      total === 0
        ? []
        : [
            factor('Board pieces in the opening hand', (r) => r.piecesInHand, 3, String),
            factor('Supporters in the opening hand', (r) => r.supportersInHand, 2, String),
            factor('Board pieces in the prizes', (r) => r.piecesPrized, 2, String),
          ],
  }
}
