import type { ClassTypeOption } from '../../components/scheduler'

// Same palette eventColor.ts falls back to for unregistered types — reused
// here so any classType list this produces matches what auto-coloring would
// have picked anyway.
export const CLASS_TYPE_PALETTE = [
  '#4f6df5',
  '#4f9d6c',
  '#c98a4b',
  '#c76f94',
  '#4a9aa8',
  '#8778c9',
  '#c26b6b',
  '#3f9d90',
  '#c2a23f',
  '#7b7ed6',
]

/**
 * Appends a ClassTypeOption (cycling through CLASS_TYPE_PALETTE, continuing
 * from wherever `existing` left off) for every name in `newDomainNames` not
 * already present in `existing` — existing entries are returned untouched,
 * never recolored or reordered. Used both by a fresh Generate (`existing =
 * []`) and by mergeRosterIntoSchedule (`existing` = the currently loaded
 * classTypes), so a merge never reassigns a color already in use.
 */
export function assignClassTypeColor(existing: ClassTypeOption[], newDomainNames: string[]): ClassTypeOption[] {
  const existingNames = new Set(existing.map((ct) => ct.name))
  const additions: ClassTypeOption[] = []
  let nextIndex = existing.length
  for (const name of newDomainNames) {
    if (existingNames.has(name) || additions.some((a) => a.name === name)) continue
    additions.push({ name, color: CLASS_TYPE_PALETTE[nextIndex % CLASS_TYPE_PALETTE.length] })
    nextIndex++
  }
  return [...existing, ...additions]
}
