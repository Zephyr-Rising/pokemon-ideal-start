import type { ParsedLine } from './types'

/**
 * A PTCG Live card line: `<count> <name> <SET> <number>`, e.g. `4 Grookey TWM 14`.
 *
 * Ported from `Decklist Transformer.ipynb` Cell 4 and widened: real exports carry
 * set codes that start with a digit (`Mew ex 30C 66`), which the original
 * `[A-Z]{2,4}` pattern rejected, silently swallowing the code into the card name.
 * A set code must still contain at least one letter — see `looksLikeSetCode` —
 * so a stray trailing number can't be mistaken for one.
 */
const CARD_LINE = /^(\d+)\s+(.+?)\s+([A-Z0-9]{2,6})\s+(\d+[a-z]?)$/

/** `4 Professor's Research` — some exports omit the printing entirely. */
const COUNT_NAME_ONLY = /^(\d+)\s+(.+)$/

/** Section headers: `Pokémon: 21`, `Trainer: 24`, `Total Cards: 60`. */
const SECTION_HEADER = /^[^\d].*:\s*\d+\s*$/

const looksLikeSetCode = (token: string): boolean => /[A-Z]/.test(token)

export interface ParseResult {
  lines: ParsedLine[]
  /** Non-empty, non-header lines that could not be parsed. */
  badLines: string[]
}

export function parseDecklist(text: string): ParseResult {
  const lines: ParsedLine[] = []
  const badLines: string[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (raw === '' || SECTION_HEADER.test(raw)) continue

    const full = CARD_LINE.exec(raw)
    if (full && looksLikeSetCode(full[3])) {
      lines.push({
        count: Number.parseInt(full[1], 10),
        name: full[2].trim(),
        set: full[3],
        num: full[4],
        raw,
      })
      continue
    }

    // Keep printing-less lines: they still resolve by name, and even if they
    // don't, their copies must count toward the 60.
    const partial = COUNT_NAME_ONLY.exec(raw)
    if (partial) {
      lines.push({
        count: Number.parseInt(partial[1], 10),
        name: partial[2].trim(),
        set: '',
        num: '',
        raw,
      })
      continue
    }

    badLines.push(raw)
  }

  return { lines, badLines }
}
