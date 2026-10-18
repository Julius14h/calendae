import type { Resource, SchedulerEvent } from '../../components/scheduler'
import { getEligibleRooms, VIRTUAL_ROOM_TAG, ZOOM_ADMIN_BUFFER_MINUTES } from './rooms'
import type { Class, ConsecutiveComfort, Instructor } from '../roster/types'

const SLOT_MINUTES = 15

// Used only when an instructor's own preferredGapMinutes is null (they
// never gave a number, or their consecutiveComfort exempts them from
// needing one calculated at all) — see requiredGapMinutes.
const DEFAULT_GAP_MINUTES = 15

// Fallback ceilings for instructors who never gave an explicit weekly/daily
// cap ("Unsure/ Flexible", "Depends on the classes", or left blank) —
// business-decided numbers, not derived from anything in the form itself.
const DEFAULT_MAX_SESSIONS_PER_WEEK = 20
const DEFAULT_MAX_SESSIONS_PER_DAY = 8

// consecutiveComfort answers meaning "back-to-back is fine" — for these, no
// gap is enforced at all, regardless of what preferredGapMinutes says.
// consecutiveComfort's real job is only to GATE whether a gap is enforced,
// not to carry its own separate magnitude — the magnitude is whatever the
// instructor put in preferredGapMinutes (see requiredGapMinutes).
const NO_GAP_NEEDED_COMFORT = new Set<ConsecutiveComfort>([
  'I prefer classes to be scheduled consecutively (back-to-back)',
  'I am comfortable teaching consecutive classes, but have no preference',
])

// This consecutiveComfort answer is a claim about DAILY frequency, not
// about gaps — see resolveMaxSessionsPerDay.
const ONLY_ONE_CLASS_PER_DAY_COMFORT: ConsecutiveComfort = 'I prefer to teach only one class per day'

/**
 * Foundational Courses are never auto-scheduled by allocate() (business
 * decision — these are handled manually, not through the weekly algorithm),
 * but they're still real classes: an instructor keeps them in `classes`,
 * and staff can still add a Foundational Courses event by hand from the
 * frontend's manual "create event" flow. Only the automatic booking loop
 * below skips them.
 */
const NON_AUTO_SCHEDULED_DOMAINS = new Set(['Foundational Courses'])

/** Room/space features that any room trivially satisfies — not real requirements to match against. */
const NEEDS_ALWAYS_SATISFIED = new Set(['No specific room features required', 'Other'])

/**
 * Why a class never got booked this week — a plain retry of the identical
 * deterministic sweep would never resolve any of these (nothing about the
 * inputs changes between attempts), so this is purely diagnostic, not a
 * signal to try again:
 *   - 'no-eligible-room': getEligibleRooms returned nothing at all — a room
 *     inventory gap, not a scheduling contention.
 *   - 'no-instructor-availability': the instructor has no declared
 *     availability block, on any day actually in this week, long enough
 *     for the class's own duration.
 *   - 'daily-cap-reached-every-day': every day in the week was already at
 *     this instructor's per-day cap before a single slot was even tried —
 *     a caps/ordering issue, not a room/time conflict.
 *   - 'no-free-slot': everything above checked out (eligible rooms exist,
 *     the instructor has long-enough availability, at least one day wasn't
 *     capped out) but no (day, time, room) combination actually worked —
 *     genuine contention.
 */
export type UnscheduledClassReason = 'no-eligible-room' | 'no-instructor-availability' | 'daily-cap-reached-every-day' | 'no-free-slot'

export type AllocationWarning =
  | {
      type: 'unscheduled-class'
      instructorId: number
      instructorName: string
      className: string
      reason: UnscheduledClassReason
      /** Carried along so a UI can manually place this class on the calendar anyway (e.g. CreateFab's "Classes to review" modal's "Book" button) — nothing was ever booked for it, so there's no eventId the way room-fit-mismatch has one. */
      classDomain: string
      classDurationMinutes: number
      roomNeeds: string[]
      deliveryFormats: string[]
      intensity?: string
    }
  | {
      type: 'room-fit-mismatch'
      instructorId: number
      instructorName: string
      className: string
      roomId: string
      roomTitle: string
      missingRoomNeeds: string[]
      overCapacity: boolean
      /** The actual booked event this warning is about — lets a UI jump straight to it (e.g. CreateFab's "Classes to review" modal). */
      eventId: string
    }

export interface AllocationResult {
  events: SchedulerEvent[]
  warnings: AllocationWarning[]
}

interface AllocationContext {
  rooms: Resource[]
  virtualRoomIds: Set<string>
  dayStartHour: number
  dayEndHour: number
  index: EventIndex
  warnings: AllocationWarning[]
}

/**
 * Builds a week-by-week schedule: for each instructor, tries to book every
 * one of their classes once that week (skipping any in
 * NON_AUTO_SCHEDULED_DOMAINS — see its doc comment), in list order, stopping
 * early once their weekly cap is reached (see resolveMaxSessionsPerWeek — a
 * null answer resolves to DEFAULT_MAX_SESSIONS_PER_WEEK, it is NOT
 * unlimited). A day's bookings stop the same way per resolveMaxSessionsPerDay.
 *
 * Instructors are processed most-constrained-first, not in whatever order
 * they were given (see sortByPriority) — the earlier an instructor is
 * processed, the more say they get over contested slots/rooms, so
 * processing order needs to reflect an actual priority, not be arbitrary.
 *
 * Room selection matches each class's own roomNeeds/maxParticipation
 * against the real room inventory's own tags/capacity (see
 * rooms.ts's getEligibleRooms) — Pool/Gym/Virtual/Outdoor needs are
 * exclusive to their dedicated room(s); Mirrors routes to the mirrored
 * room regardless of capacity (flagged via `warnings` if it doesn't fit);
 * everything else is a soft preference between general-purpose rooms by
 * capacity. Virtual (Zoom) bookings additionally share a cross-room
 * ZOOM_ADMIN_BUFFER_MINUTES buffer, since the same admin manages every
 * Zoom session regardless of which of the 3 Zoom rooms it's in.
 *
 * Every booking respects the instructor's declared weekly-recurring
 * availability plus their own required gap since their other bookings that
 * week (see requiredGapMinutes — DEFAULT_GAP_MINUTES only when they
 * haven't stated a preference; comfortable-with-back-to-back instructors
 * get none at all, everyone else's own preferredGapMinutes answer is used
 * as-is).
 *
 * Returns both the generated events AND a list of warnings — classes that
 * couldn't be scheduled this week at all (every eligible room was busy at
 * every slot the instructor was free), and classes that got booked into a
 * room not fully matching their stated needs/capacity. Neither case blocks
 * the rest of the schedule; they're surfaced for a human to review instead.
 */
export function allocate(
  instructors: Instructor[],
  rooms: Resource[],
  start: Date,
  end: Date,
  dayStartHour: number,
  dayEndHour: number,
  /**
   * Events that must be treated as already occupying a room/instructor
   * slot — e.g. a pinned event a caller wants held in place while it
   * regenerates everything else around it (see regenerateWeek.ts) — without
   * being included in this call's own returned `events` (the caller already
   * has them and will merge them back in itself). Seeded into the room/
   * instructor conflict indices only, never into `index.all`, so
   * `addEvent`/`instructorBookingBuffer`/`zoomAdminBufferConflict` naturally
   * avoid them with no other change to this function's own logic.
   */
  preOccupied: SchedulerEvent[] = [],
): AllocationResult {
  const ctx: AllocationContext = {
    rooms,
    virtualRoomIds: new Set(rooms.filter((room) => (room.roomNeeds ?? []).includes(VIRTUAL_ROOM_TAG)).map((room) => room.id)),
    dayStartHour,
    dayEndHour,
    index: createEventIndex(),
    warnings: [],
  }
  seedEventIndex(ctx.index, preOccupied)

  const orderedInstructors = sortByPriority(instructors)

  for (const { weekStart, weekEnd } of eachWeekWindow(start, end)) {
    const weekDays = daysInRange(weekStart, weekEnd)

    for (const instructor of orderedInstructors) {
      bookInstructorWeek(instructor, weekDays, weekStart, weekEnd, ctx)
    }
  }

  return { events: ctx.index.all, warnings: ctx.warnings }
}

/** Sum of an instructor's own declared weekly availability, in minutes — the lower this is, the fewer real options they have. */
function totalAvailableMinutes(instructor: Instructor): number {
  return instructor.availability.reduce((sum, block) => sum + (block.endMinutes - block.startMinutes), 0)
}

/** How many of the two numeric caps this instructor actually answered explicitly (0-2) — higher means their stated number is a real commitment, not a business-decided fallback guess. */
function explicitCapCount(instructor: Instructor): number {
  return (instructor.maxSessionsPerWeek != null ? 1 : 0) + (instructor.maxSessionsPerDay != null ? 1 : 0)
}

/**
 * Most-constrained-first processing order, computed once and reused for
 * every week (availability/caps don't change week to week, so re-sorting
 * per week would just waste work for an identical result).
 *
 * Primary key: instructors who gave an explicit weekly/daily cap get
 * priority over "Unsure/Flexible" instructors, whose cap is a
 * business-decided fallback number they never actually committed to —
 * otherwise a flexible instructor could soak up slots that would otherwise
 * go to someone with fewer, concrete options.
 *
 * Secondary key (and the sole tiebreak within an explicitness tier): total
 * weekly availability minutes, ascending — an instructor with only a
 * handful of open hours should get first pick over someone with wide-open
 * availability, who can far more easily fit into whatever's left over.
 *
 * This replaces the earlier idea of randomizing processing order: for a
 * schedule meant to be solved once and reused every week (see the
 * conversation this was decided in), randomizing doesn't actually fix
 * anything — it just swaps "whoever submitted first always wins" for
 * "whoever the random seed favored always wins," equally arbitrary and
 * just as permanent once baked into the reused template. Prioritizing by
 * actual constraint tightness targets the real failure mode instead:
 * someone losing a slot purely because of processing order.
 */
function sortByPriority(instructors: Instructor[]): Instructor[] {
  return [...instructors].sort((a, b) => {
    const explicitnessDiff = explicitCapCount(b) - explicitCapCount(a)
    if (explicitnessDiff !== 0) return explicitnessDiff
    return totalAvailableMinutes(a) - totalAvailableMinutes(b)
  })
}

/** null (Unsure/Flexible or blank) resolves to DEFAULT_MAX_SESSIONS_PER_WEEK — never unlimited. */
function resolveMaxSessionsPerWeek(instructor: Instructor): number {
  return instructor.maxSessionsPerWeek ?? DEFAULT_MAX_SESSIONS_PER_WEEK
}

/**
 * null resolves to DEFAULT_MAX_SESSIONS_PER_DAY, same as the weekly cap —
 * but "I prefer to teach only one class per day" additionally clamps
 * whatever that resolves to down to 1, since that consecutiveComfort
 * answer is itself a claim about daily frequency, not just a comfort
 * level, and nothing else in the data enforces it.
 */
function resolveMaxSessionsPerDay(instructor: Instructor): number {
  const resolved = instructor.maxSessionsPerDay ?? DEFAULT_MAX_SESSIONS_PER_DAY
  return instructor.consecutiveComfort === ONLY_ONE_CLASS_PER_DAY_COMFORT ? Math.min(resolved, 1) : resolved
}

/**
 * Tries to book each of `instructor`'s classes once within this week, in
 * list order, respecting both the weekly and daily aggregate caps across
 * *all* of the instructor's classes combined (not per-class). Every class
 * that doesn't end up booked (Foundational Courses aside, which are simply
 * skipped, not a failure) gets an 'unscheduled-class' warning, complete
 * with a reason (see bookClassOnce).
 */
function bookInstructorWeek(instructor: Instructor, weekDays: Date[], weekStart: Date, weekEnd: Date, ctx: AllocationContext): void {
  let bookedThisWeek = 0
  const bookedByDay = new Map<string, number>()
  const maxPerWeek = resolveMaxSessionsPerWeek(instructor)
  const maxPerDay = resolveMaxSessionsPerDay(instructor)

  for (const klass of instructor.classes) {
    if (NON_AUTO_SCHEDULED_DOMAINS.has(klass.classDomain)) continue
    if (bookedThisWeek >= maxPerWeek) break

    if (bookClassOnce(klass, instructor, weekDays, weekStart, weekEnd, bookedByDay, maxPerDay, ctx)) {
      bookedThisWeek++
    }
  }
}

/** Does `instructor` have any declared availability block, on a day actually present in `days`, long enough to fit `durationMinutes`? A cheap, sweep-independent check — used to diagnose an unscheduled class rather than to filter the sweep itself. */
function instructorHasEnoughAvailabilityThisWeek(instructor: Instructor, days: Date[], durationMinutes: number): boolean {
  const dayNamesThisWeek = new Set(days.map((day) => day.toLocaleDateString('en-US', { weekday: 'long' })))
  return instructor.availability.some((block) => dayNamesThisWeek.has(block.day) && block.endMinutes - block.startMinutes >= durationMinutes)
}

function unscheduledClassWarning(klass: Class, instructor: Instructor, reason: UnscheduledClassReason): AllocationWarning {
  return {
    type: 'unscheduled-class',
    instructorId: instructor.id,
    instructorName: instructor.name,
    className: klass.className,
    reason,
    classDomain: klass.classDomain,
    classDurationMinutes: klass.classDurationMinutes,
    roomNeeds: klass.roomNeeds,
    deliveryFormats: klass.deliveryFormats ?? [],
    intensity: klass.intensity,
  }
}

/**
 * Sweeps every 15-minute slot across `days` (clamped to `[weekStart, weekEnd)`
 * and to business hours), day by day, stopping at the first bookable slot —
 * the first still-eligible room (see getEligibleRooms) that's free at that
 * time. Days already at the instructor's per-day cap are skipped entirely.
 * Returns whether a booking was made; on failure, records an
 * 'unscheduled-class' warning with a diagnosed reason (see
 * UnscheduledClassReason) rather than just the bare fact of failure.
 */
function bookClassOnce(
  klass: Class,
  instructor: Instructor,
  days: Date[],
  weekStart: Date,
  weekEnd: Date,
  bookedByDay: Map<string, number>,
  maxPerDay: number,
  ctx: AllocationContext,
): boolean {
  const eligibleRooms = getEligibleRooms(klass, ctx.rooms)
  if (eligibleRooms.length === 0) {
    ctx.warnings.push(unscheduledClassWarning(klass, instructor, 'no-eligible-room'))
    return false
  }

  if (!instructorHasEnoughAvailabilityThisWeek(instructor, days, klass.classDurationMinutes)) {
    ctx.warnings.push(unscheduledClassWarning(klass, instructor, 'no-instructor-availability'))
    return false
  }

  let triedAnyDay = false

  for (const day of days) {
    const dayKey = day.toDateString()
    if ((bookedByDay.get(dayKey) ?? 0) >= maxPerDay) continue
    triedAnyDay = true

    let slotStart = new Date(day)
    slotStart.setHours(ctx.dayStartHour, 0, 0, 0)
    if (slotStart < weekStart) slotStart = new Date(weekStart)

    let dayEnd = new Date(day)
    dayEnd.setHours(ctx.dayEndHour, 0, 0, 0)
    if (dayEnd > weekEnd) dayEnd = new Date(weekEnd)

    while (slotStart < dayEnd) {
      const slotEnd = new Date(slotStart.getTime() + klass.classDurationMinutes * 60000)

      if (isThisInstructorAvailable(slotStart, slotEnd, instructor, ctx.index)) {
        for (const room of eligibleRooms) {
          const bookedEvent = addEvent(ctx, klass, instructor, room, new Date(slotStart), slotEnd)
          if (bookedEvent) {
            recordRoomFitWarning(klass, room, instructor, bookedEvent.id, ctx.warnings)
            bookedByDay.set(dayKey, (bookedByDay.get(dayKey) ?? 0) + 1)
            return true
          }
        }
      }

      slotStart = new Date(slotStart.getTime() + SLOT_MINUTES * 60000)
    }
  }

  ctx.warnings.push(unscheduledClassWarning(klass, instructor, triedAnyDay ? 'no-free-slot' : 'daily-cap-reached-every-day'))
  return false
}

interface EventIndex {
  all: SchedulerEvent[]
  byInstructor: Map<number, SchedulerEvent[]>
  byRoom: Map<string, SchedulerEvent[]>
}

function createEventIndex(): EventIndex {
  return { all: [], byInstructor: new Map(), byRoom: new Map() }
}

/** Populates `byInstructor`/`byRoom` (conflict-checking only) with `events`, deliberately leaving `all` (the returned-events accumulator) untouched — see `allocate()`'s own `preOccupied` param doc comment for why. */
function seedEventIndex(index: EventIndex, events: SchedulerEvent[]): void {
  for (const event of events) {
    indexAppend(index.byInstructor, event.instructorId, event)
    indexAppend(index.byRoom, event.resourceId, event)
  }
}

function indexAppend<K>(map: Map<K, SchedulerEvent[]>, key: K, event: SchedulerEvent) {
  const list = map.get(key)
  if (list) list.push(event)
  else map.set(key, [event])
}

/**
 * Checks the candidate room's own booked events (via the index, not a full
 * scan) for a conflict, and — for a Zoom room — also checks the shared
 * cross-room admin buffer against every OTHER Zoom room's events (see
 * zoomAdminBufferConflict). If clear, records the new event in every index
 * — O(that room's/instructor's own event count), not O(total events).
 */
function addEvent(ctx: AllocationContext, klass: Class, instructor: Instructor, room: Resource, start: Date, end: Date): SchedulerEvent | null {
  const roomEvents = ctx.index.byRoom.get(room.id)
  if (roomEvents) {
    for (const event of roomEvents) {
      if (start < event.end && end > event.start) return null // room conflict
    }
  }

  if (ctx.virtualRoomIds.has(room.id) && zoomAdminBufferConflict(start, end, ctx)) {
    return null
  }

  const newEvent: SchedulerEvent = {
    id: `e${ctx.index.all.length + 1}`,
    resourceId: room.id,
    title: klass.className,
    start,
    end,
    type: klass.classDomain,
    instructorName: instructor.name,
    instructorId: instructor.id,
    classRequestId: klass.id,
    roomNeeds: klass.roomNeeds,
    deliveryFormats: klass.deliveryFormats,
    maxParticipation: klass.maxParticipation ?? undefined,
    intensity: klass.intensity,
  }

  ctx.index.all.push(newEvent)
  indexAppend(ctx.index.byInstructor, instructor.id, newEvent)
  indexAppend(ctx.index.byRoom, room.id, newEvent)

  return newEvent
}

/**
 * Every Zoom booking shares one admin behind the scenes, regardless of
 * which of the 3 Zoom rooms it's in — so no two Zoom bookings, across ANY
 * combination of Zoom rooms, may start within ZOOM_ADMIN_BUFFER_MINUTES of
 * each other. Same interval-overlap-with-buffer shape as
 * instructorBookingBuffer, just scoped to the whole Zoom room group instead
 * of one instructor.
 */
function zoomAdminBufferConflict(start: Date, end: Date, ctx: AllocationContext): boolean {
  const bufferMs = ZOOM_ADMIN_BUFFER_MINUTES * 60000
  for (const roomId of ctx.virtualRoomIds) {
    const events = ctx.index.byRoom.get(roomId)
    if (!events) continue
    for (const event of events) {
      if (start.getTime() < event.end.getTime() + bufferMs && end.getTime() > event.start.getTime() - bufferMs) {
        return true
      }
    }
  }
  return false
}

/** Which of klass's stated room needs the chosen room doesn't actually cover — empty if it covers everything (or klass asked for nothing beyond what any room trivially satisfies). */
function unmetRoomNeeds(klass: Class, room: Resource): string[] {
  const roomTags = new Set(room.roomNeeds ?? [])
  return klass.roomNeeds.filter((need) => !NEEDS_ALWAYS_SATISFIED.has(need) && !roomTags.has(need))
}

/**
 * Records a warning when the room a class actually got booked into doesn't
 * fully cover its stated needs, or is smaller than its stated
 * maxParticipation — e.g. a Mirrors class with >15 people always goes to
 * the mirrored room regardless (see getEligibleRooms), so it needs
 * flagging here rather than being silently accepted or refused.
 */
function recordRoomFitWarning(klass: Class, room: Resource, instructor: Instructor, eventId: string, warnings: AllocationWarning[]): void {
  const missingRoomNeeds = unmetRoomNeeds(klass, room)
  const overCapacity = room.maxCapacity != null && klass.maxParticipation != null && klass.maxParticipation > room.maxCapacity
  if (missingRoomNeeds.length === 0 && !overCapacity) return

  warnings.push({
    type: 'room-fit-mismatch',
    instructorId: instructor.id,
    instructorName: instructor.name,
    className: klass.className,
    roomId: room.id,
    roomTitle: room.title,
    missingRoomNeeds,
    overCapacity,
    eventId,
  })
}

/**
 * Whether this instructor can take a class from `start` to `end`: not within
 * their own required gap of one of their existing bookings, and within one
 * of their declared weekly availability windows for that day.
 */
function isThisInstructorAvailable(start: Date, end: Date, instructor: Instructor, index: EventIndex): boolean {
  const dayOfWeek = start.toLocaleDateString('en-US', { weekday: 'long' })
  if (instructorBookingBuffer(start, end, instructor, index)) {
    return false
  }
  for (const availability of instructor.availability) {
    if (availability.day === dayOfWeek) {
      const availabilityStart = new Date(start)
      availabilityStart.setHours(Math.floor(availability.startMinutes / 60), availability.startMinutes % 60, 0, 0)

      const availabilityEnd = new Date(start)
      availabilityEnd.setHours(Math.floor(availability.endMinutes / 60), availability.endMinutes % 60, 0, 0)
      if (start >= availabilityStart && end <= availabilityEnd) {
        return true // Instructor is available
      }
    }
  }
  return false // Instructor is not available
}

/**
 * The minimum gap (in minutes) to enforce between this instructor's own
 * bookings. There's no need to invent a universal numeric definition of
 * "consecutive" — an instructor's own preferredGapMinutes answer already IS
 * their personal definition of adequate spacing (e.g. "do not want
 * consecutive" + "15 minutes" means exactly 15 minutes is enough for THEM,
 * not some larger number this function should second-guess). This only
 * overrides that with 0 for the two comfort answers that mean back-to-back
 * is genuinely fine, and falls back to DEFAULT_GAP_MINUTES for anyone who
 * never gave a number at all.
 */
function requiredGapMinutes(instructor: Instructor): number {
  if (NO_GAP_NEEDED_COMFORT.has(instructor.consecutiveComfort)) return 0
  return instructor.preferredGapMinutes ?? DEFAULT_GAP_MINUTES
}

/**
 * Don't book events that fall within this instructor's own required gap
 * (see requiredGapMinutes) of an event they're already booked for — a full
 * interval overlap check padded by the gap on both sides, not just a
 * comparison of the candidate's start time. A point-only comparison would
 * miss a long candidate that starts well before an existing booking (so its
 * start looks "far enough away") but whose end still runs into or past it —
 * which a same-instructor conflict in a *different* room would otherwise
 * sail through undetected (the room-conflict check in addEvent only looks
 * within one room, never across an instructor's other rooms).
 */
function instructorBookingBuffer(start: Date, end: Date, instructor: Instructor, index: EventIndex): boolean {
  const instructorEvents = index.byInstructor.get(instructor.id)
  if (!instructorEvents) return false
  const bufferMs = requiredGapMinutes(instructor) * 60000
  for (const event of instructorEvents) {
    if (start.getTime() < event.end.getTime() + bufferMs && end.getTime() > event.start.getTime() - bufferMs) {
      return true // overlaps this event, or falls within its required gap — blocked
    }
  }
  return false
}

/** Monday at midnight of the week containing `date`. */
function getWeekStart(date: Date): Date {
  const weekStart = new Date(date)
  weekStart.setHours(0, 0, 0, 0)
  const diffFromMonday = (weekStart.getDay() + 6) % 7 // getDay(): 0 = Sunday ... 6 = Saturday
  weekStart.setDate(weekStart.getDate() - diffFromMonday)
  return weekStart
}

/** Calendar-week (Monday-Sunday) windows covering `[start, end)`, each clamped to that range so partial first/last weeks aren't over- or under-counted. */
/** Exported for regenerateWeek.ts's own multi-week loop — same Monday-Sunday windowing this function already relies on internally, kept as one implementation rather than a second copy. */
export function eachWeekWindow(start: Date, end: Date): { weekStart: Date; weekEnd: Date }[] {
  const windows: { weekStart: Date; weekEnd: Date }[] = []
  let cursor = getWeekStart(start)
  while (cursor < end) {
    const naturalWeekEnd = new Date(cursor)
    naturalWeekEnd.setDate(cursor.getDate() + 7)
    windows.push({
      weekStart: cursor > start ? new Date(cursor) : new Date(start),
      weekEnd: naturalWeekEnd < end ? new Date(naturalWeekEnd) : new Date(end),
    })
    cursor = naturalWeekEnd
  }
  return windows
}

/** Midnight-aligned Date for each calendar day touched by `[rangeStart, rangeEnd)`. */
function daysInRange(rangeStart: Date, rangeEnd: Date): Date[] {
  const days: Date[] = []
  const cursor = new Date(rangeStart)
  cursor.setHours(0, 0, 0, 0)
  while (cursor < rangeEnd) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}
