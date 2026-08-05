import type { Resource, SchedulerEvent } from '../../components/scheduler'
import type { ClassRequest, Instructor } from '../roster/types'
import type { ClassInfo } from './types'

const DAY_START_HOUR = 9
const DAY_END_HOUR = 21
const SLOT_MINUTES = 15
const ONE_HOUR_MS = 60 * 60000

/**
 * Builds a week-by-week schedule: requests are tried most-constrained-first
 * (fewest viable rooms), so a request that can only use one room doesn't
 * lose it to a more flexible one.
 *
 * Each request is booked independently *per week* (its `count` is a weekly
 * quota, not a total over the whole range) in two passes:
 *   1. Preferred rooms only — searches every feasible slot in the week
 *      before settling for anything, so a request doesn't lock into a
 *      non-preferred room just because it happened to be the first slot
 *      tried that week.
 *   2. Any room — only runs if pass 1 couldn't fill the week's quota.
 * Both passes respect instructor availability and a 1-hour buffer since
 * their other bookings.
 *
 * Known limitations: a request only looks for a preferred room within its
 * *own* week — it won't hold out across multiple weeks for one, and if no
 * preferred room is ever free that whole week, it still falls back to
 * whatever's available rather than going unscheduled.
 */
export function allocate(classRequests: ClassRequest[], rooms: Resource[], classes: ClassInfo[], instructors: Instructor[], start: Date, end: Date): SchedulerEvent[] {
  void classes

  const sortedClassRequests = [...classRequests].sort(
    (a, b) => roomConstraintCount(a) - roomConstraintCount(b),
  )

  const index = createEventIndex()

  for (const { weekStart, weekEnd } of eachWeekWindow(start, end)) {
    const weekDays = daysInRange(weekStart, weekEnd)

    for (const request of sortedClassRequests) {
      const instructor = getInstructor(request.instructorId, instructors)
      if (!instructor) {
        console.warn(`Instructor with ID ${request.instructorId} not found.`)
        continue
      }

      let remaining = request.count
      if (request.preferredRooms.length > 0) {
        remaining -= bookRequestAcrossDays(request, instructor, weekDays, weekStart, weekEnd, remaining, rooms, index, true)
      }
      if (remaining > 0) {
        bookRequestAcrossDays(request, instructor, weekDays, weekStart, weekEnd, remaining, rooms, index, false)
      }
    }
  }

  return index.all
}

/**
 * Sweeps every 15-minute slot across `days` (clamped to `[weekStart, weekEnd)`
 * and to business hours) looking for up to `quota` bookable occurrences of
 * `request`. `preferredOnly` restricts room choice to `request.preferredRooms`
 * (in their own ranked order) instead of falling back to any room. Returns
 * how many occurrences it actually booked.
 */
function bookRequestAcrossDays(
  request: ClassRequest,
  instructor: Instructor,
  days: Date[],
  weekStart: Date,
  weekEnd: Date,
  quota: number,
  rooms: Resource[],
  index: EventIndex,
  preferredOnly: boolean,
): number {
  const candidateRooms = preferredOnly ? preferredRoomsOnly(rooms, request.preferredRooms) : prioritizeRooms(rooms, request.preferredRooms)

  let booked = 0
  for (const day of days) {
    if (booked >= quota) break

    let slotStart = new Date(day)
    slotStart.setHours(DAY_START_HOUR, 0, 0, 0)
    if (slotStart < weekStart) slotStart = new Date(weekStart)

    let dayEnd = new Date(day)
    dayEnd.setHours(DAY_END_HOUR, 0, 0, 0)
    if (dayEnd > weekEnd) dayEnd = new Date(weekEnd)

    while (slotStart < dayEnd && booked < quota) {
      const slotEnd = new Date(slotStart.getTime() + request.durationMinutes * 60000)

      if (isThisInstructorAvailable(slotStart, slotEnd, instructor, index)) {
        for (const room of candidateRooms) {
          if (addEvent(index, request, instructor, room.id, new Date(slotStart), slotEnd)) {
            booked++
            break
          }
        }
      }

      slotStart = new Date(slotStart.getTime() + SLOT_MINUTES * 60000)
    }
  }
  return booked
}

function getInstructor(id: number, instructors: Instructor[]): Instructor | undefined {
  return instructors.find(instructor => instructor.id === id);
}

interface EventIndex {
  all: SchedulerEvent[]
  byInstructor: Map<number, SchedulerEvent[]>
  byRoom: Map<string, SchedulerEvent[]>
}

function createEventIndex(): EventIndex {
  return { all: [], byInstructor: new Map(), byRoom: new Map() }
}

function indexAppend<K>(map: Map<K, SchedulerEvent[]>, key: K, event: SchedulerEvent) {
  const list = map.get(key)
  if (list) list.push(event)
  else map.set(key, [event])
}

/**
 * Checks the candidate room's own booked events (via the index, not a full
 * scan) for a conflict; if clear, records the new event in every index —
 * O(that room's/instructor's own event count), not O(total events).
 */
function addEvent(index: EventIndex, request: ClassRequest, instructor: Instructor, roomId: string, start: Date, end: Date): boolean {
  const roomEvents = index.byRoom.get(roomId)
  if (roomEvents) {
    for (const event of roomEvents) {
      if (start < event.end && end > event.start) return false // room conflict
    }
  }

  const newEvent: SchedulerEvent = {
    id: `e${index.all.length + 1}`,
    resourceId: roomId,
    title: `${request.className}`,
    start,
    end,
    type: request.classType,
    instructorName: instructor.name,
    instructorId: instructor.id,
    classRequestId: request.id,
    preferredRooms: request.preferredRooms,
  }

  index.all.push(newEvent)
  indexAppend(index.byInstructor, instructor.id, newEvent)
  indexAppend(index.byRoom, roomId, newEvent)

  return true
}

/**
 * Whether this instructor can take a class from `start` to `end`: not within
 * an hour of one of their existing bookings, and within one of their
 * declared weekly availability windows for that day.
 */
function isThisInstructorAvailable(start: Date, end: Date, instructor: Instructor, index: EventIndex): boolean {
  const dayOfWeek = start.toLocaleDateString('en-US', { weekday: 'long' });
  if (instructorBookingBuffer(start, instructor, index)) {
    return false;
  }
  for (const availability of instructor.availability) {
    if (availability.day === dayOfWeek) {
      const availabilityStart = new Date(start);
      availabilityStart.setHours(Math.floor(availability.startMinutes / 60), availability.startMinutes % 60, 0, 0);

      const availabilityEnd = new Date(start);
      availabilityEnd.setHours(Math.floor(availability.endMinutes / 60), availability.endMinutes % 60, 0, 0);
      if (start >= availabilityStart && end <= availabilityEnd) {
        return true; // Instructor is available
      }
    }
  }
  return false; // Instructor is not available
}

/**
 * Don't book events if they are within an hour of an event already booked by the instructor
 */
function instructorBookingBuffer(start: Date, instructor: Instructor, index: EventIndex): boolean {
  const instructorEvents = index.byInstructor.get(instructor.id)
  if (!instructorEvents) return false
  for (const event of instructorEvents) {
    if (Math.abs(start.getTime() - event.end.getTime()) < ONE_HOUR_MS ||
        Math.abs(event.start.getTime() - start.getTime()) < ONE_HOUR_MS) {
      return true; // within an hour of an existing booking — blocked
    }
  }
  return false;
}

/** Empty preferredRooms means "any room works" — the least constrained case, so it counts as unlimited options rather than zero. */
function roomConstraintCount(request: ClassRequest): number {
  return request.preferredRooms.length === 0 ? Infinity : request.preferredRooms.length
}

/** Just the rooms in `preferredRoomIds`, ordered to match that list (preferredRoomIds[0] first). */
function preferredRoomsOnly(rooms: Resource[], preferredRoomIds: string[]): Resource[] {
  return preferredRoomIds
    .map(id => rooms.find(room => room.id === id))
    .filter((room): room is Resource => room !== undefined);
}

function prioritizeRooms(rooms: Resource[], preferredRoomIds: string[]): Resource[] {
  /**
   * Orders rooms by the request's own preference ranking (preferredRoomIds[0]
   * tried first), then appends the rest in their original order.
   */
  const preferred = preferredRoomsOnly(rooms, preferredRoomIds);
  const nonPreferred = rooms.filter(room => !preferredRoomIds.includes(room.id));
  return [...preferred, ...nonPreferred];
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
function eachWeekWindow(start: Date, end: Date): { weekStart: Date; weekEnd: Date }[] {
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
