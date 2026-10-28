/**
 * In-place edits to the pasted decklist text.
 *
 * The decklist the player pasted stays the source of truth — their formatting,
 * ordering and section headers are preserved, and only the one line being
 * changed is rewritten. Rebuilding the list from parsed data would be simpler
 * but would quietly discard everything we did not model.
 */

const COUNT_PREFIX = /^(\s*)(\d+)(\s+)(.*)$/
/** `Pokémon: 21`, `Trainer: 24`, `Total Cards: 60` */
const SECTION_HEADER = /^(\s*[^\d][^:]*:\s*)(\d+)(\s*)$/

/**
 * Change the count on the decklist line matching `rawLine` by `delta`.
 *
 * Dropping to zero removes the line entirely. Section header totals are
 * recomputed so the list stays self-consistent — a stale `Pokémon: 21` after an
 * edit is worse than no header at all.
 */
export function adjustLineCount(text: string, rawLine: string, delta: number): string {
  const lines = text.split('\n')
  const target = lines.findIndex((line) => line.trim() === rawLine.trim())
  if (target === -1) return text

  const match = COUNT_PREFIX.exec(lines[target])
  if (!match) return text

  const next = Number.parseInt(match[2], 10) + delta
  if (next <= 0) lines.splice(target, 1)
  else lines[target] = `${match[1]}${next}${match[3]}${match[4]}`

  return retotalSections(lines).join('\n')
}

/** Recompute each `Name: N` header from the card lines beneath it. */
function retotalSections(lines: string[]): string[] {
  const out = [...lines]
  let headerAt = -1
  let total = 0

  const flush = () => {
    if (headerAt === -1) return
    const header = SECTION_HEADER.exec(out[headerAt])
    if (header) out[headerAt] = `${header[1]}${total}${header[3]}`
  }

  for (let i = 0; i < out.length; i++) {
    const line = out[i]
    if (SECTION_HEADER.test(line)) {
      flush()
      // "Total Cards: 60" style footers span every section, so they are left
      // alone rather than being reset to the last section's count.
      headerAt = /total/i.test(line) ? -1 : i
      total = 0
      continue
    }
    const match = COUNT_PREFIX.exec(line)
    if (match) total += Number.parseInt(match[2], 10)
  }
  flush()

  return out
}
