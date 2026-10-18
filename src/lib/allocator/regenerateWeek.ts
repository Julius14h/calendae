import type { InstructorOption, Resource, SchedulerEvent, UnplacedClass } from '../../components/scheduler'
import { DEFAULT_DAY_END_HOUR, DEFAULT_DAY_START_HOUR } from '../../components/scheduler'
import { normalizeName } from '../roster/buildRoster'
import type { Class, ConsecutiveComfort, Instructor } from '../roster/types'
import type { ScheduleStateData } from '../schedule/saveState'
import { allocate, eachWeekWindow } from './allocate'
import { getEligibleRooms } from './rooms'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

// How many weeks apart consecutive occurrences of each pattern fall,
// counted from the series' own anchor (its earliest occurrence) — see
// dueRecurringEvents. "Monthly" is deliberately every 4 weeks, not true
// calendar-month semantics (which would need to handle "5th Monday of the
// month" edge cases this weekly time-slot grid has no clean answer for).
const RECURRENCE_CADENCE_WEEKS: Record<'weekly' | 'biweekly' | 'monthly', number> = {
  weekly: 1,
  biweekly: 2,
  monthly: 4,
}

export type ManualEventPolicy = 'preserve' | 'reposition' | 'delete'
export type OverflowPolicy = 'force-place' | 'archive-to-bin'

export interface RegenerateWeekOptions {
  /** Start of the date range to rebuild — the user's own choice (see GenerateModal.tsx), not assumed to fall on a Monday. Internally split into Monday-Sunday windows (see eachWeekWindow) so pin-exclusion and old-event matching stay correctly scoped to one calendar week at a time, exactly like a single-week run always was. */
  rangeStart: Date
  /** End of the date range (exclusive) — must be after `rangeStart`. */
  rangeEnd: Date
  /** What to do with a class that still can't be placed after a normal search. */
  overflowPolicy: OverflowPolicy
  /** What to do with an event that has no roster class definition behind it at all (created via "Create Event" or the review modal's "Book" flow — see isManualEvent's own doc comment). */
  manualEventPolicy: ManualEventPolicy
  /** Whether to also attempt placing whatever's already sitting in the Classes Bin, not just each week's own events. */
  includeBinItems: boolean
}

interface CarriedFields {
  note?: string
  color?: string
  title: string
}

function classKey(instructorId: number, className: string): string {
  return `${instructorId}::${normalizeName(className)}`
}

/**
 * True for an event with no roster class definition behind it at all —
 * confirmed by reading NewEventDrawer.tsx's handleCreate and Scheduler.tsx's
 * commitPendingBooking (the review-modal "Book" flow): neither ever sets
 * `classRequestId`. Also true for an event whose `classRequestId` no longer
 * resolves to anything (a stale id from before this feature existed, or a
 * negative ephemeral id from a previous regenerate's own reposition/bin
 * placement) — this makes regenerateWeek resilient against old saves
 * instead of crashing, and correctly keeps treating a once-repositioned
 * event as manual on every later regenerate too, since it never gained a
 * real roster definition.
 */
function resolveDefinition(
  event: SchedulerEvent,
  definitionById: Map<number, Class>,
  definitionByKey: Map<string, Class>,
): Class | undefined {
  if (event.classRequestId != null) {
    const byId = definitionById.get(event.classRequestId)
    if (byId) return byId
  }
  return definitionByKey.get(classKey(event.instructorId, event.title))
}

/** Builds the "effective" class definition fed into the placement search for an already-existing roster-backed event: instructor/duration/room-needs/delivery/capacity come from the event's OWN current fields when it diverges from the stored definition (a deliberate hand correction, carried forward as an input to where it gets re-placed — see this module's own doc comment on the field-preservation split), falling back to the definition's own value when the event never had one. `classDomain`/`className` always come from the stable definition, not the event — a rename is pure metadata (see CarriedFields), not something that should change matching identity. */
function effectiveDefinitionFor(event: SchedulerEvent, definition: Class): Class {
  return {
    id: definition.id,
    classDomain: definition.classDomain,
    instructorId: event.instructorId,
    className: definition.className,
    classDurationMinutes: (event.end.getTime() - event.start.getTime()) / 60000,
    roomNeeds: event.roomNeeds ?? definition.roomNeeds,
    maxParticipation: event.maxParticipation ?? definition.maxParticipation,
    deliveryFormats: event.deliveryFormats ?? definition.deliveryFormats,
    intensity: event.intensity ?? definition.intensity,
  }
}

/** An ad-hoc, one-off class definition built straight from an event/UnplacedClass's own fields — used for a repositioned manual event or a Classes Bin item, neither of which has (or needs) a real persisted classDefinitions entry. Always gets a negative `id` (see nextEphemeralId) so it's never mistaken for a real one on a later run. */
/**
 * `id` must be a negative number, unique within this one regenerateWeek
 * call (see its own local `nextEphemeralId` counter) — this is what
 * `addEvent` writes onto the resulting event as its `classRequestId`, and
 * how that event gets matched back to its `CarriedFields` afterward (see
 * overridesById). It never needs to stay unique BEYOND this one call: a
 * negative id can never collide with a real persisted classDefinitions
 * entry (those start at 1), so any later regenerateWeek run correctly finds
 * no match for it and falls back to treating the event as manual (see
 * resolveDefinition) — exactly right, since a repositioned/bin-placed event
 * never gained a real roster definition of its own.
 */
function classFromEvent(event: SchedulerEvent, id: number): Class {
  return {
    id,
    classDomain: event.type ?? '',
    instructorId: event.instructorId,
    className: event.title,
    classDurationMinutes: (event.end.getTime() - event.start.getTime()) / 60000,
    roomNeeds: event.roomNeeds ?? [],
    maxParticipation: event.maxParticipation ?? null,
    deliveryFormats: event.deliveryFormats,
    intensity: event.intensity,
  }
}

function classFromUnplaced(item: UnplacedClass, id: number): Class {
  return {
    id,
    classDomain: item.type ?? '',
    instructorId: item.instructorId,
    className: item.title,
    classDurationMinutes: item.durationMinutes,
    roomNeeds: item.roomNeeds ?? [],
    maxParticipation: item.maxParticipation ?? null,
    deliveryFormats: item.deliveryFormats,
    intensity: item.intensity,
  }
}

/** Picks a room for a force-placed class — the same eligibility order allocate() itself uses, falling back to the very first room in the list when nothing is eligible at all, since "place it anyway" must always succeed somewhere. */
function pickForcedRoom(klass: Class, rooms: Resource[]): Resource {
  return getEligibleRooms(klass, rooms)[0] ?? rooms[0]
}

/** The instructor's own earliest declared-availability start time somewhere in this week, falling back to Monday at `dayStartHour` if they declared none at all that week — "place it anyway" must always succeed, even in the worst case. */
function pickForcedStart(instructor: InstructorOption, weekStart: Date): Date {
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const day = new Date(weekStart.getTime() + dayOffset * DAY_MS)
    const dayName = day.toLocaleDateString('en-US', { weekday: 'long' })
    const block = instructor.availability.find((a) => a.day === dayName)
    if (block) {
      const start = new Date(day)
      start.setHours(Math.floor(block.startMinutes / 60), block.startMinutes % 60, 0, 0)
      return start
    }
  }
  const fallback = new Date(weekStart)
  fallback.setHours(DEFAULT_DAY_START_HOUR, 0, 0, 0)
  return fallback
}

/** Constructs a real, placed event bypassing every conflict check — the one intentional exception to "never double-book" in this whole codebase, reserved for the explicit "force-place as a last resort" choice (see RegenerateWeekOptions.overflowPolicy). Visibility isn't this function's job: SchedulerPage.tsx's own live-derived `instructorConflictIssues`/`roomConflictIssues` recompute from `events` on every render, so a force-placed conflict is automatically flagged the moment this event lands in the doc. */
function forcePlace(klass: Class, instructor: InstructorOption, rooms: Resource[], weekStart: Date): SchedulerEvent {
  const room = pickForcedRoom(klass, rooms)
  const start = pickForcedStart(instructor, weekStart)
  const end = new Date(start.getTime() + klass.classDurationMinutes * 60000)
  return {
    id: crypto.randomUUID(),
    resourceId: room.id,
    instructorId: instructor.id,
    instructorName: instructor.name,
    // Only a REAL persisted definition earns a classRequestId — an
    // ephemeral (negative) id is never meaningful past this one run, so
    // leaving it off correctly keeps this event classified as "manual" on
    // any later regenerate (see resolveDefinition).
    classRequestId: klass.id > 0 ? klass.id : undefined,
    title: klass.className,
    type: klass.classDomain,
    start,
    end,
    roomNeeds: klass.roomNeeds,
    deliveryFormats: klass.deliveryFormats,
    maxParticipation: klass.maxParticipation ?? undefined,
    intensity: klass.intensity,
  }
}

function unplacedClassFrom(klass: Class, instructorName: string, carried: CarriedFields | undefined): UnplacedClass {
  return {
    id: crypto.randomUUID(),
    title: carried?.title ?? klass.className,
    type: klass.classDomain,
    durationMinutes: klass.classDurationMinutes,
    instructorId: klass.instructorId,
    instructorName,
    roomNeeds: klass.roomNeeds.length > 0 ? klass.roomNeeds : undefined,
    deliveryFormats: klass.deliveryFormats,
    maxParticipation: klass.maxParticipation ?? undefined,
    intensity: klass.intensity,
    note: carried?.note,
  }
}

/** Monday at midnight of the week containing `date` — same convention as allocate.ts's own (unexported) getWeekStart, needed here to find a recurrence anchor's own week for the cadence math below. */
function mondayOf(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  const diffFromMonday = (result.getDay() + 6) % 7 // getDay(): 0 = Sunday ... 6 = Saturday
  result.setDate(result.getDate() - diffFromMonday)
  return result
}

/**
 * For every recurring series (grouped by `recurrence.seriesId`) found
 * anywhere in `doc.events` — not just this week, since a series' anchor
 * (its earliest occurrence, which defines the day-of-week/time/room/
 * instructor/etc. template every later occurrence copies) may sit weeks or
 * months before the range currently being regenerated — determines whether
 * `weekStart`/`weekEnd` is "due" a fresh occurrence per that series' own
 * cadence (see RECURRENCE_CADENCE_WEEKS), and builds one if so. Returns
 * only the NEWLY CREATED occurrences; an existing one already covering this
 * week is left for the normal partitioning step below to find and treat as
 * pinned (see regenerateOneWeek), not duplicated here.
 */
function dueRecurringEvents(doc: ScheduleStateData, weekStart: Date, weekEnd: Date): SchedulerEvent[] {
  const seriesEvents = new Map<string, SchedulerEvent[]>()
  for (const event of doc.events) {
    if (!event.recurrence) continue
    const list = seriesEvents.get(event.recurrence.seriesId)
    if (list) list.push(event)
    else seriesEvents.set(event.recurrence.seriesId, [event])
  }

  const created: SchedulerEvent[] = []
  for (const occurrences of seriesEvents.values()) {
    const anchor = occurrences.reduce((earliest, e) => (e.start < earliest.start ? e : earliest))
    const anchorWeekStart = mondayOf(anchor.start)
    const weeksBetween = Math.round((weekStart.getTime() - anchorWeekStart.getTime()) / WEEK_MS)
    if (weeksBetween < 0) continue // before the series even started

    const cadence = RECURRENCE_CADENCE_WEEKS[anchor.recurrence!.pattern]
    if (weeksBetween % cadence !== 0) continue // not due this week

    const alreadyCovered = occurrences.some((e) => e.start >= weekStart && e.start < weekEnd)
    if (alreadyCovered) continue

    // "After N occurrences" — evaluated against how many already exist right
    // now (the anchor counts as the first), so it self-corrects if
    // occurrences were ever added/removed by hand rather than drifting from
    // some separately-tracked count.
    const endCondition = anchor.recurrence!.end
    if (endCondition?.type === 'after-occurrences' && occurrences.length >= endCondition.count) continue

    const dayOffset = (anchor.start.getDay() + 6) % 7 // 0 = Monday ... 6 = Sunday
    const start = new Date(weekStart)
    start.setDate(start.getDate() + dayOffset)
    start.setHours(anchor.start.getHours(), anchor.start.getMinutes(), anchor.start.getSeconds(), anchor.start.getMilliseconds())

    // "Ends on a date" — this occurrence's own date must fall on or before
    // it (the end date's whole day still counts, hence endOfDay).
    if (endCondition?.type === 'on-date') {
      const endOfDay = new Date(endCondition.date)
      endOfDay.setHours(23, 59, 59, 999)
      if (start > endOfDay) continue
    }

    const occurrenceEnd = new Date(start.getTime() + (anchor.end.getTime() - anchor.start.getTime()))

    created.push({
      id: crypto.randomUUID(),
      resourceId: anchor.resourceId,
      instructorId: anchor.instructorId,
      instructorName: anchor.instructorName,
      title: anchor.title,
      type: anchor.type,
      start,
      end: occurrenceEnd,
      roomNeeds: anchor.roomNeeds,
      deliveryFormats: anchor.deliveryFormats,
      intensity: anchor.intensity,
      maxParticipation: anchor.maxParticipation,
      note: anchor.note,
      color: anchor.color,
      recurrence: anchor.recurrence,
      // Never carries the anchor's own classRequestId (even if the anchor
      // is itself roster-backed) or `pinned` — a fresh occurrence isn't the
      // same roster booking as the anchor (see resolveDefinition's own doc
      // comment on why that matters for future regenerates), and it's
      // already protected via `recurrence` alone, same reasoning as
      // Duplicate never copying either of those two fields.
    })
  }
  return created
}

/**
 * A "never ends" recurring series only actually keeps producing occurrences
 * for as far into the future as SOMETHING calls dueRecurringEvents for that
 * week — regenerateOneWeek only ever does that for whatever date range the
 * user explicitly ran Generate/Regenerate over, so navigating the calendar
 * PAST the last range anyone ever regenerated used to make a "forever"
 * series simply stop, with nothing wrong having happened and no error to
 * see — confirmed live: regenerate weeks 1-6, then just click through to
 * week 7 onward with no further regenerate, and the series vanishes there,
 * exactly matching the reported "keep changing weeks, eventually it
 * doesn't get scheduled".
 *
 * This is the fix: called from SchedulerPage.tsx whenever the visible date
 * range changes (see its own onDateChange, which already fires on every
 * navigation AND on mount) — silently backfills any recurring series that's
 * due somewhere in the newly-visible range, with none of regenerateOneWeek's
 * other behavior (no reshuffling non-recurring events, no manual-event
 * policy, no bin interaction, no overflow handling) — just keeping "forever"
 * series alive as you browse, nothing else. Deliberately NOT pushed onto the
 * undo stack (see useHistoryState's own `setSilently`) — it's not an edit
 * the user made, so Undo shouldn't have to click through it.
 *
 * `rangeStart`/`rangeEnd` are snapped OUT to the nearest full Monday-Sunday
 * weeks before doing anything else — a real, confirmed bug: the visible
 * calendar range this is fed (see SchedulerPage.tsx's onDateChange) reflects
 * the UI's OWN day-of-week convention (this app's week view labels itself
 * "Sun–Sat", e.g. "September 6–12" with Monday the 7th as the first real
 * day column), which does NOT match the allocator's own hardcoded Monday-
 * Sunday week model that every cadence/anchor computation in
 * dueRecurringEvents assumes. Feeding a Sunday-starting range straight into
 * eachWeekWindow made it split off a spurious ONE-DAY sliver window ending
 * exactly at Monday — dueRecurringEvents happily treated that sliver as
 * "not yet covered" (the anchor's own Monday-noon start doesn't fall before
 * a Monday-midnight boundary) and created a duplicate occurrence on the
 * Sunday, every time that week was viewed. Confirmed live via a debug trace
 * of actual event counts across a Next-then-Previous click before this fix
 * existed. Only this function snaps the range — NOT regenerateWeek itself,
 * whose own date range is a deliberate user choice via GenerateModal
 * (defaulting to Monday-aligned already); silently expanding an
 * intentionally partial user-chosen range would be a different, unrequested
 * behavior change.
 */
export function fillDueRecurringOccurrences(doc: ScheduleStateData, rangeStart: Date, rangeEnd: Date): ScheduleStateData {
  const snappedStart = mondayOf(rangeStart)
  const lastVisibleMoment = new Date(rangeEnd.getTime() - 1)
  const snappedEnd = new Date(mondayOf(lastVisibleMoment).getTime() + WEEK_MS)

  let events = doc.events
  for (const { weekStart, weekEnd } of eachWeekWindow(snappedStart, snappedEnd)) {
    const due = dueRecurringEvents({ ...doc, events }, weekStart, weekEnd)
    if (due.length > 0) events = [...events, ...due]
  }
  return events === doc.events ? doc : { ...doc, events }
}

/** Which occurrences of a series a recurrence-settings edit (Repeat/Ends, including turning it off) applies to — see applyRecurrenceEdit. */
export type RecurrenceEditScope = 'all' | 'this-and-following'

/**
 * Applies a change to `eventId`'s own `recurrence` field — a new pattern/end,
 * or `undefined` to stop repeating — across the rest of its series, per
 * `scope`. EventPopover.tsx only ever calls this (rather than a plain
 * `onEdit({ recurrence })`) when the event being edited is NOT its series'
 * own anchor (the earliest occurrence, which is what dueRecurringEvents
 * reads for cadence/end going forward) — editing the anchor itself needs no
 * scope choice, since "all" and "this and following" are the same thing
 * there (nothing earlier exists to leave behind). A no-op (returns `doc`
 * unchanged) if `eventId` doesn't resolve to a recurring event at all.
 *
 * 'all': every occurrence sharing this event's own seriesId gets the new
 * recurrence value verbatim, same seriesId kept — already-placed occurrences
 * don't move; only the going-forward cadence/end used to generate MORE of
 * them changes.
 *
 * 'this-and-following': splits the series at this event's own start time.
 * This event and every later occurrence get the new value under a brand new
 * seriesId (so they become their own independent series, with this event as
 * its own new anchor). Earlier occurrences keep their OLD recurrence, except
 * their own `end` is capped to the day before this event's start — so
 * fillDueRecurringOccurrences/regenerateWeek stop generating anything past
 * the split point for the old series, which would otherwise land right on
 * top of whatever the new series now generates there.
 */
export function applyRecurrenceEdit(
  doc: ScheduleStateData,
  eventId: string,
  newRecurrence: SchedulerEvent['recurrence'],
  scope: RecurrenceEditScope,
): ScheduleStateData {
  const target = doc.events.find((e) => e.id === eventId)
  if (!target?.recurrence) return doc

  const seriesId = target.recurrence.seriesId
  const seriesEvents = doc.events.filter((e) => e.recurrence?.seriesId === seriesId)
  const anchor = seriesEvents.reduce((earliest, e) => (e.start < earliest.start ? e : earliest))

  if (scope === 'all' || anchor.id === target.id) {
    const events = doc.events.map((e) =>
      e.recurrence?.seriesId === seriesId ? { ...e, recurrence: newRecurrence && { ...newRecurrence, seriesId } } : e,
    )
    return { ...doc, events }
  }

  const dayBeforeTarget = new Date(target.start.getTime() - DAY_MS)
  dayBeforeTarget.setHours(23, 59, 59, 999)
  const newSeriesId = newRecurrence ? crypto.randomUUID() : undefined
  const events = doc.events.map((e) => {
    if (e.recurrence?.seriesId !== seriesId) return e
    if (e.start.getTime() >= target.start.getTime()) {
      return { ...e, recurrence: newRecurrence && { ...newRecurrence, seriesId: newSeriesId! } }
    }
    return { ...e, recurrence: { ...e.recurrence!, end: { type: 'on-date' as const, date: dayBeforeTarget } } }
  })
  return { ...doc, events }
}

/**
 * Rebuilds ONE calendar week (`weekStart` through `weekEnd`, both already
 * resolved by the caller — see `regenerateWeek` below) "as if for the first
 * time" from each instructor's own persisted class definitions
 * (`doc.classDefinitions` — see saveState.ts's own doc comment on why these
 * are kept around now), while holding every PINNED event — and every
 * occurrence of a recurring series, treated identically (see
 * dueRecurringEvents) — in that week exactly where it is and planning
 * everything else around it. A recurring series that's due this week but
 * has no occurrence yet gets one created fresh, copying its anchor's own
 * room/time-of-day/instructor/etc. Every other week's events pass through
 * completely untouched.
 *
 * The "as-if-for-the-first-time" pool is always the FULL set of class
 * definitions, not just ones that already had an event this week — a class
 * that previously failed to place (or was never attempted) gets a fresh
 * shot every time this runs, which is what makes this self-healing. A
 * definition is excluded only when a PINNED event this week already covers
 * it (no reason to also try booking a duplicate).
 *
 * Field-preservation split (settled in conversation): `note`/`color`/title
 * always carry over onto whatever new event replaces an old one — pure
 * metadata, never touched by placement. Instructor/duration/room-needs/
 * delivery/capacity carry over as OVERRIDES to the effective class
 * definition fed into the search (see effectiveDefinitionFor) — so a hand
 * correction still influences room/time selection — but the resulting
 * room/time itself is never locked; that's what pinning is for.
 *
 * Manually-created events (no class definition behind them at all — see
 * resolveDefinition) are governed by `manualEventPolicy` instead of being
 * silently rebuilt or discarded.
 */
function regenerateOneWeek(
  doc: ScheduleStateData,
  weekStart: Date,
  weekEnd: Date,
  { overflowPolicy, manualEventPolicy, includeBinItems }: Omit<RegenerateWeekOptions, 'rangeStart' | 'rangeEnd'>,
): ScheduleStateData {

  const definitionById = new Map(doc.classDefinitions.map((d) => [d.id, d] as const))
  const definitionByKey = new Map(doc.classDefinitions.map((d) => [classKey(d.instructorId, d.className), d] as const))
  const instructorById = new Map(doc.instructors.map((i) => [i.id, i] as const))

  // Fresh occurrences for any recurring series that's due this week but
  // doesn't have one yet — computed from `doc.events` as it stands BEFORE
  // this week's own processing, then folded into the same list the
  // partition loop below reads, so they're treated as pinned exactly like
  // an existing occurrence would be (see the widened check just below).
  const recurrenceFillEvents = dueRecurringEvents(doc, weekStart, weekEnd)
  const eventsForThisRun = [...doc.events, ...recurrenceFillEvents]

  const outsideWeek: SchedulerEvent[] = []
  const pinnedThisWeek: SchedulerEvent[] = []
  const manualThisWeek: SchedulerEvent[] = []
  const rosterBackedByDefinitionId = new Map<number, SchedulerEvent>()

  for (const event of eventsForThisRun) {
    if (event.start < weekStart || event.start >= weekEnd) {
      outsideWeek.push(event)
      continue
    }
    // Every occurrence of a recurring series is held in place exactly like
    // an explicitly pinned event — see recurrence's own doc comment on
    // Scheduler.types.ts for why this is a deliberate behavioral overlap,
    // not a separate mechanism.
    if (event.pinned || event.recurrence) {
      pinnedThisWeek.push(event)
      continue
    }
    const definition = resolveDefinition(event, definitionById, definitionByKey)
    if (!definition) {
      manualThisWeek.push(event)
    } else {
      rosterBackedByDefinitionId.set(definition.id, event)
    }
  }

  const excludedDefinitionIds = new Set<number>()
  for (const event of pinnedThisWeek) {
    const definition = resolveDefinition(event, definitionById, definitionByKey)
    if (definition) excludedDefinitionIds.add(definition.id)
  }

  const poolByInstructor = new Map<number, Class[]>()
  const overridesById = new Map<number, CarriedFields>()
  function addToPool(klass: Class) {
    const list = poolByInstructor.get(klass.instructorId)
    if (list) list.push(klass)
    else poolByInstructor.set(klass.instructorId, [klass])
  }

  // The full roster, minus whatever's already pinned this week — the "as
  // if for the first time" pool.
  // A class already sitting in the Classes Bin (e.g. one Generate couldn't
  // place, or one Add New brought in) is represented by that bin entry
  // instead of its definition — the bin entry carries the user's own edits,
  // and attempting both would try (and could book) the same class twice.
  // Without includeBinItems, it stays put in the bin rather than also being
  // auto-booked behind its back.
  const binClassKeys = new Set(doc.unplacedClasses.map((item) => classKey(item.instructorId, item.title)))
  for (const definition of doc.classDefinitions) {
    if (excludedDefinitionIds.has(definition.id)) continue
    if (binClassKeys.has(classKey(definition.instructorId, definition.className))) continue
    const oldEvent = rosterBackedByDefinitionId.get(definition.id)
    const effective = oldEvent ? effectiveDefinitionFor(oldEvent, definition) : definition
    addToPool(effective)
    if (oldEvent) overridesById.set(definition.id, { note: oldEvent.note, color: oldEvent.color, title: oldEvent.title })
  }

  // Negative, unique only within this one call (see classFromEvent's own
  // doc comment on why that's all that's ever needed).
  let nextEphemeralId = -1

  // Manually-created events this week, per the chosen policy.
  const preservedManual: SchedulerEvent[] = []
  for (const event of manualThisWeek) {
    if (manualEventPolicy === 'preserve') {
      preservedManual.push(event)
    } else if (manualEventPolicy === 'reposition') {
      const klass = classFromEvent(event, nextEphemeralId--)
      addToPool(klass)
      overridesById.set(klass.id, { note: event.note, color: event.color, title: event.title })
    }
    // 'delete': dropped entirely — never added anywhere.
  }

  // Classes Bin items, if this run should also try to place them.
  const binItemByEphemeralId = new Map<number, UnplacedClass>()
  if (includeBinItems) {
    for (const item of doc.unplacedClasses) {
      const klass = classFromUnplaced(item, nextEphemeralId--)
      addToPool(klass)
      overridesById.set(klass.id, { note: item.note, color: undefined, title: item.title })
      binItemByEphemeralId.set(klass.id, item)
    }
  }

  const tempInstructors: Instructor[] = []
  for (const [instructorId, classes] of poolByInstructor) {
    const option = instructorById.get(instructorId)
    if (!option) continue // no known instructor to hydrate against (e.g. a stale reference) — nothing sensible to do, so this class simply never gets attempted
    tempInstructors.push({
      id: option.id,
      name: option.name,
      classes,
      status: '', // never read by allocate()'s own logic
      maxSessionsPerWeek: option.maxSessionsPerWeek ?? null,
      maxSessionsPerDay: option.maxSessionsPerDay ?? null,
      consecutiveComfort: (option.consecutiveComfort ?? '') as ConsecutiveComfort,
      preferredGapMinutes: option.preferredGapMinutes ?? null,
      blockedOutDates: option.blockedOutDates ?? [],
      availability: option.availability,
      anythingElse: option.anythingElse,
    })
  }

  const preOccupied = [...pinnedThisWeek, ...preservedManual]
  const { events: newEvents, warnings } = allocate(
    tempInstructors,
    doc.resources,
    weekStart,
    weekEnd,
    DEFAULT_DAY_START_HOUR,
    DEFAULT_DAY_END_HOUR,
    preOccupied,
  )

  // allocate()'s own `id` scheme (`e${n}`) is scoped only to THIS call's own
  // output — it has no awareness of ids already used elsewhere in `doc`
  // (other weeks' own previously-generated events, the original CSV-driven
  // build, earlier regenerate runs...). Since this function calls allocate()
  // once PER WEEK (see regenerateWeek's own loop), every single call would
  // otherwise restart from `e1`, guaranteed to collide with something
  // already in the document — always replace it with a real unique id
  // rather than trusting allocate()'s own counter.
  const finalNewEvents = newEvents.map((event) => {
    const carried = event.classRequestId != null ? overridesById.get(event.classRequestId) : undefined
    const withFreshId = { ...event, id: crypto.randomUUID() }
    return carried ? { ...withFreshId, note: carried.note, color: carried.color, title: carried.title } : withFreshId
  })

  // A class that still couldn't be placed this week, resolved back to
  // whichever pool entry it came from via (instructorId, className) — the
  // warning itself carries no class id (see AllocationWarning's own shape).
  const poolEntryByKey = new Map<string, Class>()
  for (const classes of poolByInstructor.values()) {
    for (const klass of classes) poolEntryByKey.set(classKey(klass.instructorId, klass.className), klass)
  }

  const forcedEvents: SchedulerEvent[] = []
  const archived: UnplacedClass[] = []
  for (const warning of warnings) {
    if (warning.type !== 'unscheduled-class') continue
    const klass = poolEntryByKey.get(classKey(warning.instructorId, warning.className))
    if (!klass) continue
    const carried = overridesById.get(klass.id)
    const fromBin = binItemByEphemeralId.get(klass.id)

    if (overflowPolicy === 'archive-to-bin') {
      archived.push(fromBin ?? unplacedClassFrom(klass, warning.instructorName, carried))
      continue
    }

    // force-place
    const instructor = instructorById.get(klass.instructorId)
    if (!instructor) continue // same "nothing sensible to do" case as above
    const forced = forcePlace(klass, instructor, doc.resources, weekStart)
    forcedEvents.push(carried ? { ...forced, note: carried.note, color: carried.color, title: carried.title } : forced)
    // fromBin: correctly just not re-added to the bin — it's on the calendar now.
  }

  const finalUnplacedClasses = includeBinItems ? archived : [...doc.unplacedClasses, ...archived]

  return {
    ...doc,
    events: [...outsideWeek, ...pinnedThisWeek, ...preservedManual, ...finalNewEvents, ...forcedEvents],
    unplacedClasses: finalUnplacedClasses,
  }
}

/**
 * Rebuilds `options.rangeStart` through `options.rangeEnd` (exclusive) —
 * the user's own chosen date range (see GenerateModal.tsx), not assumed to
 * be a single week. Internally splits the range into Monday-Sunday windows
 * (see eachWeekWindow, the same windowing allocate() itself uses) and runs
 * regenerateOneWeek once per window, threading the doc through
 * sequentially — each week is processed independently (its own pin-
 * exclusion, its own old-event matching), exactly as a single-week run
 * always was; a multi-week range is just several of those in a row, not a
 * different algorithm.
 */
export function regenerateWeek(doc: ScheduleStateData, options: RegenerateWeekOptions): { doc: ScheduleStateData } {
  const { rangeStart, rangeEnd, ...weekOptions } = options
  let current = doc
  for (const { weekStart, weekEnd } of eachWeekWindow(rangeStart, rangeEnd)) {
    current = regenerateOneWeek(current, weekStart, weekEnd, weekOptions)
  }
  return { doc: current }
}
