import { describe, expect, it } from 'vitest'

import { summariseLuck, type LuckRecord } from '../src/lib/sim/luck'

const game = (turn: number | null, piecesInHand = 0, supportersInHand = 0, piecesPrized = 0): LuckRecord => ({
  turn,
  piecesInHand,
  supportersInHand,
  piecesPrized,
})

describe('summariseLuck', () => {
  it('gives the turn by which each share of games has the board', () => {
    // Ten games: turns 1..8, with the last two never getting there.
    const records = [1, 2, 2, 3, 3, 3, 4, 5, null, null].map((t) => game(t))
    const at = Object.fromEntries(summariseLuck(records).percentiles.map((p) => [p.share, p.turn]))
    expect(at[0.1]).toBe(1)
    expect(at[0.25]).toBe(2)
    expect(at[0.5]).toBe(3)
    expect(at[0.75]).toBe(5)
    // The unluckiest tenth never get there by the last turn played.
    expect(at[0.9]).toBeNull()
  })

  it('groups games by what the deal gave them', () => {
    const records = [game(2, 3), game(2, 4), game(5, 0), game(null, 0)]
    const hand = summariseLuck(records).factors.find((f) => f.name.includes('opening hand'))!
    const none = hand.buckets.find((b) => b.label === '0')!
    const many = hand.buckets.find((b) => b.label === '3 or more')!
    expect(none.share).toBe(0.5)
    expect(none.reached).toBe(0.5)
    expect(many.share).toBe(0.5)
    expect(many.median).toBe(2)
    // Buckets with no games are left out.
    expect(hand.buckets.map((b) => b.label)).toEqual(['0', '3 or more'])
  })
})
