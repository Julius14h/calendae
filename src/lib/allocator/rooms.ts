import type { Resource } from '../../components/scheduler'
import type { Class } from '../roster/types'

// The real Baycrest room inventory, from docs/redcap/Calendae Info.xlsx's
// "Rules" sheet (Room Name / Max Capacity / Room Needs / Pick when),
// refined in conversation:
//   - Virtual split into 3 concurrent rooms (Zoom 1/2/3), matching the same
//     workbook's "Time Blocks" sheet, which tracks three separate Zoom slots
//     historically — not the "Rules" sheet's single "Virtual" room.
//   - The old single "OAT" (which the "Time Blocks" sheet separately flags
//     as currently unusable for programming at all) is replaced entirely by
//     two new rooms, Outdoor 1 and Outdoor 2.
// Room Needs strings are copied verbatim from the Class Profile survey's
// own room_needs choice labels (see parseClassProfileCsv.ts) so matching is
// a plain string-equality check, no translation table needed.
export const REAL_ROOMS: Resource[] = [
  { id: 'gym', title: 'Gym', roomNeeds: ['Gym/ weight-room equipment'] },
  { id: 'pool', title: 'Pool', roomNeeds: ['Pool'] },
  {
    id: 'ara',
    title: 'ARA',
    maxCapacity: 15,
    // Screen/projector added per the user directly (not in the "Rules"
    // sheet's own Room Needs column) — both ARA and CAS actually have one.
    roomNeeds: ['Barre or stable wall support', 'Mirrors', 'No specific room features required', 'Tables/desks', 'Audio system/ speakers', 'Screen/projector'],
  },
  {
    id: 'cas',
    title: 'CAS',
    maxCapacity: 30,
    roomNeeds: ['Barre or stable wall support', 'No specific room features required', 'Tables/desks', 'Audio system/ speakers', 'Screen/projector'],
  },
  { id: 'zoom1', title: 'Zoom 1', maxCapacity: 50, roomNeeds: ['Virtual (e.g. Zoom)'] },
  { id: 'zoom2', title: 'Zoom 2', maxCapacity: 50, roomNeeds: ['Virtual (e.g. Zoom)'] },
  { id: 'zoom3', title: 'Zoom 3', maxCapacity: 50, roomNeeds: ['Virtual (e.g. Zoom)'] },
  { id: 'outdoor1', title: 'Outdoor 1', roomNeeds: ['Outdoor space'] },
  { id: 'outdoor2', title: 'Outdoor 2', roomNeeds: ['Outdoor space'] },
]

/** The literal room_needs tag that marks a room as one of the Zoom rooms — used by allocate.ts to apply the shared-admin buffer across all of them collectively. */
export const VIRTUAL_ROOM_TAG = 'Virtual (e.g. Zoom)'

/** Every Zoom booking (across any of the 3 Zoom rooms) needs at least this much gap from every other one — the same person manages the Zoom setup/admin for every session, so two sessions starting too close together are impractical even when the "rooms" themselves are technically free. */
export const ZOOM_ADMIN_BUFFER_MINUTES = 15

// The 5 room_needs tags that route to a specific dedicated room (or set of
// rooms) rather than the general-purpose pool — matches the "Rules" sheet's
// "Pick when" column ("Only gym selected", "Only pool selected", etc).
const EXCLUSIVE_NEEDS = ['Pool', 'Gym/ weight-room equipment', VIRTUAL_ROOM_TAG, 'Outdoor space']

function hasNeed(room: Resource, need: string): boolean {
  return (room.roomNeeds ?? []).includes(need)
}

/**
 * Rooms eligible for `klass`, in priority order — the first one free at a
 * given slot wins (see allocate.ts's bookClassOnce). Fully tag-driven (not
 * hardcoded to specific room ids) so it works with whatever `rooms` are
 * actually passed in, including test fixtures using plain untagged rooms.
 *
 * Priority, derived from the "Pick when" column in Calendae Info.xlsx:
 *   - Pool/Gym/Virtual/Outdoor needs are each exclusive to whichever
 *     room(s) carry that exact tag — nothing else can substitute.
 *   - Mirrors routes to whichever room(s) carry that tag, REGARDLESS of
 *     capacity — a >15-person mirrors class still gets booked there;
 *     allocate.ts flags the resulting event as a room-fit mismatch rather
 *     than silently refusing to book it or guessing which constraint
 *     should win (decided in conversation, not assumed).
 *   - Everything else (Barre/Tables/Audio/no-specific-needs/Other/blank)
 *     falls to the general-purpose rooms (any room not exclusively tied to
 *     one of the 4 special needs above), preferring by capacity — larger
 *     rooms first for >15-participant classes, smaller first otherwise —
 *     since the source sheet itself calls this "preference (not strict
 *     rule)", not a hard constraint.
 */
export function getEligibleRooms(klass: Class, rooms: Resource[]): Resource[] {
  const needs = klass.roomNeeds
  const withNeed = (need: string) => rooms.filter((room) => hasNeed(room, need))

  if (needs.includes('Pool')) return withNeed('Pool')
  if (needs.includes('Gym/ weight-room equipment')) return withNeed('Gym/ weight-room equipment')
  if (needs.includes(VIRTUAL_ROOM_TAG)) return withNeed(VIRTUAL_ROOM_TAG)
  if (needs.includes('Outdoor space')) return withNeed('Outdoor space')
  if (needs.includes('Mirrors')) return withNeed('Mirrors')

  const generalPurpose = rooms.filter((room) => !EXCLUSIVE_NEEDS.some((need) => hasNeed(room, need)))
  const preferLargerFirst = klass.maxParticipation != null && klass.maxParticipation > 15
  return [...generalPurpose].sort((a, b) => {
    const capA = a.maxCapacity ?? Infinity
    const capB = b.maxCapacity ?? Infinity
    return preferLargerFirst ? capB - capA : capA - capB
  })
}
