/**
 * The site's three looks (see the Designs section of index.css), and which one
 * this browser last picked. The pick is a per-viewer convenience, so storage
 * that is missing or blocked simply means the default.
 */

export const DESIGNS = [
  { id: 'tournament', label: 'Tournament' },
  { id: 'field-guide', label: 'Field Guide' },
  { id: 'pokedex', label: 'Pokédex' },
  { id: 'data-lab', label: 'Data Lab' },
  { id: 'holo', label: 'Holo Foil' },
  // Dark whatever the viewer's system is set to.
  { id: 'midnight', label: 'Midnight', scheme: 'dark' },
] as const

export type Design = (typeof DESIGNS)[number]['id']

const STORAGE_KEY = 'ideal-start-design'

const isDesign = (value: string | null): value is Design =>
  DESIGNS.some((design) => design.id === value)

export function savedDesign(): Design {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return isDesign(saved) ? saved : 'tournament'
  } catch {
    return 'tournament'
  }
}

export function applyDesign(design: Design): void {
  const root = document.documentElement
  root.dataset.design = design
  const entry = DESIGNS.find((d) => d.id === design)
  if (entry && 'scheme' in entry) root.dataset.scheme = entry.scheme
  else delete root.dataset.scheme
  try {
    localStorage.setItem(STORAGE_KEY, design)
  } catch {
    // Not remembered; it still applies for this visit.
  }
}
