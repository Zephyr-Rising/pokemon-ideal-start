/**
 * Normalise a card name for matching: delete apostrophes, ASCII-fold, lowercase,
 * collapse every run of non-alphanumerics to a single space.
 *
 * Ported from `Decklist Transformer.ipynb` Cell 3. The apostrophe handling is
 * load-bearing, not cosmetic: the card database writes curly apostrophes
 * ("Ciphermaniac\u2019s Codebreaking") while PTCG Live exports write straight ones,
 * so without this the two never match.
 */
export function norm(s: string): string {
  return s
    .replace(/['\u2018\u2019\u02bc]/g, '') // apostrophes are deleted, not spaced
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics: Pok\u00e9 -> Poke
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
