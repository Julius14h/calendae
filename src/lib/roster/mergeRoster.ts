import type { InstructorOption, SchedulerEvent, UnplacedClass } from '../../components/scheduler'
import type { ScheduleStateData } from '../schedule/saveState'
import type { RosterWarning } from './buildRoster'
import { normalizeName } from './buildRoster'
import { assignClassTypeColor } from './classTypeColors'
import type { Class, Instructor } from './types'

/**
 * A matched instructor's incoming class turned out to already have a
 * PLACED event under the same (instructor, className), but some other
 * detail (domain/duration/room needs/delivery formats/capacity) disagrees
 * with what the fresh CSV data says — never auto-applied to the placed
 * event (that's the whole point of surfacing it), just visibility for a
 * human to reconcile, same "review list" philosophy as RosterWarning/
 * AllocationWarning. One warning per divergent PLACED instance, not per
 * class — a recurring weekly class produces N placed events across the
 * scheduling window (see allocate.ts's eachWeekWindow), each independently
 * editable (resize/rename), so they can legitimately disagree with each
 * other, let alone with a fresh import.
 */
export interface MergeWarning {
  type: 'class-details-changed'
  eventId: string
  instructorName: string
  className: string
  changes: string[]
}

export interface MergeResult {
  doc: ScheduleStateData
  rosterWarnings: RosterWarning[]
  mergeWarnings: MergeWarning[]
}

function setsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const as = new Set(a ?? [])
  const bs = new Set(b ?? [])
  if (as.size !== bs.size) return false
  for (const v of as) if (!bs.has(v)) return false
  return true
}

function listOrNone(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : 'none'
}

/** Everything that could disagree between an already-placed event and the fresh CSV's own class data for the same (instructor, className) — see MergeWarning's own doc comment for why this is never auto-applied. */
function diffEventAgainstClass(event: SchedulerEvent, klass: Class): string[] {
  const changes: string[] = []
  const eventDurationMinutes = (event.end.getTime() - event.start.getTime()) / 60000
  if ((event.type ?? '') !== klass.classDomain) {
    changes.push(`Domain: ${event.type ?? 'none'} → ${klass.classDomain}`)
  }
  if (eventDurationMinutes !== klass.classDurationMinutes) {
    changes.push(`Duration: ${eventDurationMinutes} → ${klass.classDurationMinutes} min`)
  }
  if (!setsEqual(event.roomNeeds, klass.roomNeeds)) {
    changes.push(`Room needs: ${listOrNone(event.roomNeeds)} → ${listOrNone(klass.roomNeeds)}`)
  }
  if (!setsEqual(event.deliveryFormats, klass.deliveryFormats)) {
    changes.push(`Delivery: ${listOrNone(event.deliveryFormats)} → ${listOrNone(klass.deliveryFormats)}`)
  }
  if ((event.maxParticipation ?? null) !== (klass.maxParticipation ?? null)) {
    changes.push(`Capacity: ${event.maxParticipation ?? 'none'} → ${klass.maxParticipation ?? 'none'}`)
  }
  if ((event.intensity ?? '') !== (klass.intensity ?? '')) {
    changes.push(`Intensity: ${event.intensity ?? 'none'} → ${klass.intensity ?? 'none'}`)
  }
  return changes
}

/**
 * Adds or refreshes `klass` inside `definitions` (mutated in place), keyed
 * by (instructorId, normalizeName(className)) — never appended blindly.
 * This is what keeps a class definition's own id STABLE across repeated
 * merges: regenerateWeek.ts matches an old event back to its definition via
 * `event.classRequestId === definition.id`, so a definition that got
 * silently renumbered on every re-import would break that link. Unlike an
 * already-PLACED event (see diffEventAgainstClass/MergeWarning), a
 * definition itself carries no user edits of its own to protect — it's
 * meant to always reflect the latest roster survey answer, so a genuine
 * change (e.g. Class Profile now says 75 min instead of 60) is applied
 * silently here, the same way a still-unplaced draft already is above.
 */
function upsertClassDefinition(definitions: Class[], klass: Class, instructorId: number, nextId: () => number): void {
  const normalizedClassName = normalizeName(klass.className)
  const existingIndex = definitions.findIndex(
    (d) => d.instructorId === instructorId && normalizeName(d.className) === normalizedClassName,
  )
  const updated: Class = { ...klass, id: existingIndex === -1 ? nextId() : definitions[existingIndex].id, instructorId }
  if (existingIndex === -1) {
    definitions.push(updated)
  } else {
    definitions[existingIndex] = updated
  }
}

function unplacedClassFrom(klass: Class, instructorId: number, instructorName: string, id: string = crypto.randomUUID()): UnplacedClass {
  return {
    id,
    title: klass.className,
    type: klass.classDomain,
    durationMinutes: klass.classDurationMinutes,
    instructorId,
    instructorName,
    roomNeeds: klass.roomNeeds.length > 0 ? klass.roomNeeds : undefined,
    deliveryFormats: klass.deliveryFormats,
    maxParticipation: klass.maxParticipation ?? undefined,
    intensity: klass.intensity,
  }
}

/**
 * Merges buildRoster()'s output into the CURRENTLY LOADED schedule, instead
 * of replacing it (see buildDocumentFromRoster in SchedulerPage.tsx, which
 * always starts from zero). Never touches an existing InstructorOption's own
 * fields — this can only ADD a brand-new instructor or ADD a new unplaced
 * class to an existing one. Newly-confident classes land in
 * `doc.unplacedClasses` for manual placement (never auto-allocated — the
 * allocator has no notion of an already hand-edited schedule); ambiguous
 * instructor identity and changed-but-already-placed class details become
 * review items instead of being silently guessed at.
 *
 * Instructor identity: matched by normalizeName() only (no email — a loaded
 * schedule's InstructorOption never carries one, see its own doc comment).
 * Zero matches -> new instructor. Exactly one match, or several disambiguated
 * by a single clear claimed-class-name overlap winner -> confident, merge
 * silently. Multiple candidates with no clear winner (tie, or nobody
 * overlaps at all) -> genuinely ambiguous, represented as `unclaimed-class-
 * profile` RosterWarnings (the exact shape buildRoster.ts already produces
 * for its own orphaned-row case) so the existing review -> Book ->
 * PendingBookingActions "possible match" flow handles resolution verbatim,
 * with no new UI needed for this rare case.
 */
export function mergeRosterIntoSchedule(currentDoc: ScheduleStateData, newInstructors: Instructor[]): MergeResult {
  const instructors: InstructorOption[] = [...currentDoc.instructors]
  const unplacedClasses: UnplacedClass[] = [...currentDoc.unplacedClasses]
  const classDefinitions: Class[] = [...currentDoc.classDefinitions]
  const rosterWarnings: RosterWarning[] = []
  const mergeWarnings: MergeWarning[] = []
  const newDomainNames: string[] = []

  // Every id already in use, including ones minted earlier in THIS run —
  // ids from buildRoster()'s own Instructor[] are never reused here (they're
  // just per-run positions, see buildRoster.ts's own doc comment); a merged-
  // in brand-new instructor always gets the next real InstructorOption id.
  let nextInstructorId = instructors.length > 0 ? Math.max(...instructors.map((i) => i.id)) + 1 : 1
  // Same idea, for classDefinitions' own ids (see upsertClassDefinition).
  let nextClassDefinitionId = classDefinitions.length > 0 ? Math.max(...classDefinitions.map((c) => c.id)) + 1 : 1
  const nextClassDefinitionIdFn = () => nextClassDefinitionId++

  // Original-case, deduplicated-by-normalized-name class titles this
  // instructor is already known to have — from placed events AND from
  // still-unplaced entries (an Unschedule'd class can sit in either, or
  // both, at once; both need checking, independently, not if/else). No
  // `classes` list exists on InstructorOption itself (unlike the roster
  // layer's own Instructor), so this has to be derived from what's actually
  // on the calendar/drawer right now.
  function knownClasses(instructorId: number): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const event of currentDoc.events) {
      if (event.instructorId !== instructorId) continue
      const key = normalizeName(event.title)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(event.title)
    }
    for (const unplaced of unplacedClasses) {
      if (unplaced.instructorId !== instructorId) continue
      const key = normalizeName(unplaced.title)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(unplaced.title)
    }
    return result
  }

  /** Scores each candidate by how many of `incoming`'s claimed class names it already known to have; returns the single unambiguous highest-overlap candidate, or null if there's a tie (including an all-zero tie) — genuinely ambiguous either way. */
  function resolveByOverlap(candidates: InstructorOption[], incoming: Instructor): InstructorOption | null {
    const incomingNames = new Set(incoming.classes.map((c) => normalizeName(c.className)))
    const scored = candidates.map((candidate) => ({
      candidate,
      overlap: knownClasses(candidate.id).filter((name) => incomingNames.has(normalizeName(name))).length,
    }))
    const maxOverlap = Math.max(...scored.map((s) => s.overlap))
    if (maxOverlap === 0) return null
    const winners = scored.filter((s) => s.overlap === maxOverlap)
    return winners.length === 1 ? winners[0].candidate : null
  }

  for (const incoming of newInstructors) {
    const candidates = instructors.filter((i) => normalizeName(i.name) === normalizeName(incoming.name))

    if (candidates.length === 0) {
      const id = nextInstructorId++
      instructors.push({
        id,
        name: incoming.name,
        availability: incoming.availability,
        maxSessionsPerWeek: incoming.maxSessionsPerWeek,
        maxSessionsPerDay: incoming.maxSessionsPerDay,
        consecutiveComfort: incoming.consecutiveComfort,
        preferredGapMinutes: incoming.preferredGapMinutes,
        blockedOutDates: incoming.blockedOutDates,
        anythingElse: incoming.anythingElse,
      })
      for (const klass of incoming.classes) {
        newDomainNames.push(klass.classDomain)
        unplacedClasses.push(unplacedClassFrom(klass, id, incoming.name))
        upsertClassDefinition(classDefinitions, klass, id, nextClassDefinitionIdFn)
      }
      continue
    }

    const matched = candidates.length === 1 ? candidates[0] : resolveByOverlap(candidates, incoming)

    if (!matched) {
      for (const klass of incoming.classes) {
        rosterWarnings.push({
          type: 'unclaimed-class-profile',
          instructorName: incoming.name,
          className: klass.className,
          classDomain: klass.classDomain,
          classDurationMinutes: klass.classDurationMinutes,
          roomNeeds: klass.roomNeeds,
          deliveryFormats: klass.deliveryFormats ?? [],
          possibleInstructors: candidates.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            classes: knownClasses(candidate.id),
          })),
        })
      }
      continue
    }

    for (const klass of incoming.classes) {
      upsertClassDefinition(classDefinitions, klass, matched.id, nextClassDefinitionIdFn)

      const normalizedClassName = normalizeName(klass.className)
      const matchingPlaced = currentDoc.events.filter(
        (event) => event.instructorId === matched.id && normalizeName(event.title) === normalizedClassName,
      )
      for (const event of matchingPlaced) {
        const changes = diffEventAgainstClass(event, klass)
        if (changes.length > 0) {
          mergeWarnings.push({ type: 'class-details-changed', eventId: event.id, instructorName: matched.name, className: klass.className, changes })
        }
      }

      let matchedUnplacedCount = 0
      for (let i = 0; i < unplacedClasses.length; i++) {
        const candidate = unplacedClasses[i]
        if (candidate.instructorId !== matched.id || normalizeName(candidate.title) !== normalizedClassName) continue
        matchedUnplacedCount++
        // Still just a draft, nothing user-facing confirmed yet — safe to
        // silently refresh in place, unlike a placed event.
        unplacedClasses[i] = unplacedClassFrom(klass, matched.id, matched.name, candidate.id)
      }

      if (matchingPlaced.length === 0 && matchedUnplacedCount === 0) {
        newDomainNames.push(klass.classDomain)
        unplacedClasses.push(unplacedClassFrom(klass, matched.id, matched.name))
      }
    }
  }

  return {
    doc: {
      ...currentDoc,
      instructors,
      unplacedClasses,
      classDefinitions,
      classTypes: assignClassTypeColor(currentDoc.classTypes, newDomainNames),
    },
    rosterWarnings,
    mergeWarnings,
  }
}
