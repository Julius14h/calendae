import type { InstructorOption, Resource, SchedulerEvent } from '../Scheduler.types';

export type AvailabilityLevel = 'preferred' | 'available' | 'unavailable'; // green / yellow / red

export interface AvailabilityBand {
  resourceId: string;
  start: Date;
  end: Date;
  level: AvailabilityLevel;
}

interface Interval {
  start: number;
  end: number;
}

// Mirrors allocate.ts's own NO_GAP_NEEDED_COMFORT/DEFAULT_GAP_MINUTES/
// requiredGapMinutes exactly (same two literal consecutiveComfort answers,
// same 15-minute default) — duplicated rather than imported, since nothing
// in this component package reaches into lib/allocator/lib/roster (see
// roomSuitsNeeds' own doc comment for the same reasoning), and
// InstructorOption.consecutiveComfort is deliberately a plain string here,
// not that layer's own ConsecutiveComfort union. Kept in sync by hand.
const NO_GAP_NEEDED_COMFORT = new Set([
  'I prefer classes to be scheduled consecutively (back-to-back)',
  'I am comfortable teaching consecutive classes, but have no preference',
]);
const DEFAULT_GAP_MINUTES = 15;

/** This instructor's own required gap, in minutes, between same-day classes — 0 when their stated comfort says back-to-back is fine (see NO_GAP_NEEDED_COMFORT), otherwise their own `preferredGapMinutes`, falling back to DEFAULT_GAP_MINUTES only when they never gave one. Never a flat one-size-fits-all number — this is what makes the instructor-availability conflict check (and the drag overlay's own red bands) respect what each instructor actually said, not a made-up rule. */
function requiredGapMinutes(instructor: InstructorOption): number {
  if (instructor.consecutiveComfort && NO_GAP_NEEDED_COMFORT.has(instructor.consecutiveComfort)) return 0;
  return instructor.preferredGapMinutes ?? DEFAULT_GAP_MINUTES;
}

/** `base` with every `exclude` interval carved out of it. */
function subtractIntervals(base: Interval[], exclude: Interval[]): Interval[] {
  let result = base;
  for (const ex of exclude) {
    const next: Interval[] = [];
    for (const b of result) {
      if (ex.end <= b.start || ex.start >= b.end) {
        next.push(b); // no overlap
        continue;
      }
      if (ex.start > b.start) next.push({ start: b.start, end: Math.min(ex.start, b.end) });
      if (ex.end < b.end) next.push({ start: Math.max(ex.end, b.start), end: b.end });
    }
    result = next.filter((iv) => iv.end > iv.start);
  }
  return result;
}

// Mirrors rooms.ts's own EXCLUSIVE_NEEDS/VIRTUAL_ROOM_TAG exactly (same
// duplication reasoning as NO_GAP_NEEDED_COMFORT/DEFAULT_GAP_MINUTES above —
// this file stays decoupled from lib/allocator). A room carrying one of
// these is reserved for that one purpose in the real allocator's own
// getEligibleRooms (a Pool/Gym/Virtual/Outdoor booking only ever goes to a
// room with that exact tag) — so a class that never asked for one of them
// shouldn't read as "preferred" there either, even though nothing physically
// stops it from being held in, say, the Gym.
const EXCLUSIVE_ROOM_TAGS = ['Pool', 'Gym/ weight-room equipment', 'Virtual (e.g. Zoom)', 'Outdoor space'];

/** Whether `room` is "general-purpose" — not exclusively reserved for one of EXCLUSIVE_ROOM_TAGS — the same rooms getEligibleRooms falls back to for a class that didn't ask for one of those 4 special purposes. */
function isGeneralPurposeRoom(room: Resource): boolean {
  const roomFeatures = room.roomNeeds ?? [];
  return !EXCLUSIVE_ROOM_TAGS.some((tag) => roomFeatures.includes(tag));
}

/** A room "suits" a class's stated needs when it carries every one of them among its own — a plain subset check, not the allocator's own more nuanced capacity-preference rules (see rooms.ts's getEligibleRooms). Deliberately not reused here: nothing in this component package imports from lib/allocator/lib/roster (see this file's own callers, e.g. Scheduler.tsx, which stays decoupled from that app-specific data layer), and a quick visual hint doesn't need the allocator's full decision tree — just "would this room actually work," which the room/class's own already-generic `roomNeeds` string lists answer directly. No stated needs at all (undefined or empty) does NOT trivially suit every room — the real allocator only ever books a needs-less class into a general-purpose room (see isGeneralPurposeRoom), never into a room reserved for Pool/Gym/Virtual/Outdoor, so this mirrors that instead of marking a Zoom or Outdoor room "preferred" for an ordinary in-person class that never asked to be virtual/outside. */
function roomSuitsNeeds(room: Resource, needs: string[] | undefined): boolean {
  if (!needs || needs.length === 0) return isGeneralPurposeRoom(room);
  const roomFeatures = room.roomNeeds ?? [];
  return needs.every((need) => roomFeatures.includes(need));
}

/**
 * For the currently selected event (open in the event popover, or being
 * dragged out of the Unplaced Classes drawer), computes colored bands for
 * every room across the visible days — a client-side, advisory mirror of
 * the same rules allocate.ts enforces when building the schedule:
 *
 * - Red ("unavailable"): outside the instructor's declared weekly
 *   availability for that day, or within their own required gap (see
 *   requiredGapMinutes — not a flat rule, this is per-instructor) of one of
 *   their other bookings, same as allocate.ts's own instructorBookingBuffer.
 * - Yellow ("available"): the instructor is free, but this room doesn't
 *   have everything the class needs (see roomSuitsNeeds).
 * - Green ("preferred"): the instructor is free and this room suits the
 *   class's stated needs (or the class stated no needs at all).
 *
 * Bands span a room's whole open window regardless of whether some other
 * event already occupies part of it — both TimelineView.tsx and
 * WeekViewVertical.tsx render these one layer *beneath* actual events (a
 * lower z-index), so an event sitting on top of a band simply hides it,
 * with no need to carve the event's own time range out here. That carve-out
 * used to exist, but it assumed a room's conflicting event always spans the
 * room's full width/height — true for an ordinary single-lane room, but
 * false the moment that room is squished into side-by-side lanes: the
 * excluded stretch still covered the *entire* room, so a lane with nothing
 * scheduled in it at that moment lost its band too, with no event drawn
 * over the resulting gap to hide the loss — a blank white hole exactly
 * where a colored band should have been.
 */
export function computeAvailabilityBands(
  event: SchedulerEvent,
  instructor: InstructorOption,
  resources: Resource[],
  events: SchedulerEvent[],
  days: Date[],
  dayStartHour: number,
  dayEndHour: number,
): AvailabilityBand[] {
  const bands: AvailabilityBand[] = [];

  for (const day of days) {
    const dayStart = new Date(day);
    dayStart.setHours(dayStartHour, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(dayEndHour, 0, 0, 0);
    const weekday = dayStart.toLocaleDateString('en-US', { weekday: 'long' });

    const availBlock = instructor.availability.find((a) => a.day === weekday);
    const availStart = availBlock
      ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(availBlock.startMinutes / 60), availBlock.startMinutes % 60)
      : null;
    const availEnd = availBlock
      ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(availBlock.endMinutes / 60), availBlock.endMinutes % 60)
      : null;

    const clippedStart = availStart ? new Date(Math.max(availStart.getTime(), dayStart.getTime())) : null;
    const clippedEnd = availEnd ? new Date(Math.min(availEnd.getTime(), dayEnd.getTime())) : null;
    const hasAvailabilityToday = clippedStart !== null && clippedEnd !== null && clippedStart.getTime() < clippedEnd.getTime();

    if (!hasAvailabilityToday) {
      for (const room of resources) bands.push({ resourceId: room.id, start: dayStart, end: dayEnd, level: 'unavailable' });
      continue;
    }

    if (clippedStart!.getTime() > dayStart.getTime()) {
      for (const room of resources) bands.push({ resourceId: room.id, start: dayStart, end: clippedStart!, level: 'unavailable' });
    }
    if (clippedEnd!.getTime() < dayEnd.getTime()) {
      for (const room of resources) bands.push({ resourceId: room.id, start: clippedEnd!, end: dayEnd, level: 'unavailable' });
    }

    const availWindow: Interval[] = [{ start: clippedStart!.getTime(), end: clippedEnd!.getTime() }];

    // This instructor's own required gap (see requiredGapMinutes), around their OTHER bookings (any room).
    const bufferMs = requiredGapMinutes(instructor) * 60000;
    const bufferZones: Interval[] = events
      .filter((e) => e.instructorId === instructor.id && e.id !== event.id)
      .map((e) => ({ start: e.start.getTime() - bufferMs, end: e.end.getTime() + bufferMs }));

    const openAfterBuffer = subtractIntervals(availWindow, bufferZones);
    const bufferedOut = subtractIntervals(availWindow, openAfterBuffer);
    for (const iv of bufferedOut) {
      for (const room of resources) bands.push({ resourceId: room.id, start: new Date(iv.start), end: new Date(iv.end), level: 'unavailable' });
    }

    for (const room of resources) {
      const level: AvailabilityLevel = roomSuitsNeeds(room, event.roomNeeds) ? 'preferred' : 'available';
      for (const iv of openAfterBuffer) {
        bands.push({ resourceId: room.id, start: new Date(iv.start), end: new Date(iv.end), level });
      }
    }
  }

  return bands;
}

/**
 * Why `event` — already placed on the grid — sits somewhere its own
 * instructor genuinely can't teach, or would rather not. 'outside-
 * availability' means the event itself falls outside their declared weekly
 * window (or they have none that day) — a hard fact, not a preference;
 * fixed only by moving this event or reassigning it. 'too-close-to-booking'
 * means the event is otherwise fine, but sits within `requiredGapMinutes`
 * of `conflictingEvent` — a DIFFERENT booking for the SAME instructor,
 * possibly a completely different class name (which is why this carries
 * the other event directly rather than just a boolean: two classes close
 * together for the same person read as "unrelated" without it, even though
 * moving *either* one resolves both — the conflict is mutual, not something
 * either event has independently). Unlike the first reason, this one is
 * genuinely a PREFERENCE (see requiredGapMinutes — it's 0, and this case
 * can't even trigger, for an instructor who said back-to-back is fine), so
 * a host app should treat it as advisory, not blocking (see
 * Scheduler.types.ts's own `severity` doc comment) — the class CAN still
 * happen where it is, it just isn't how this instructor said they'd like
 * it scheduled.
 */
export type InstructorAvailabilityConflict =
  | { reason: 'outside-availability' }
  | { reason: 'too-close-to-booking'; conflictingEvent: SchedulerEvent; requiredGapMinutes: number };

/**
 * Finds `event`'s own instructor-availability conflict, if it has one — see
 * InstructorAvailabilityConflict's own doc comment for the two reasons.
 * Factored out (from the same rules computeAvailabilityBands uses to paint
 * its own red bands) as a plain per-event check so a host app can surface
 * this as a 'blocking' ReviewIssue (see Scheduler.types.ts's own
 * `severity`) instead of just an advisory one — a hand move/resize, or
 * dropping an unplaced class, can land an event somewhere the original
 * allocate() pass would never have picked, and neither of those write
 * paths validates against availability on its own.
 */
export function findInstructorAvailabilityConflict(
  event: SchedulerEvent,
  instructor: InstructorOption,
  otherEvents: SchedulerEvent[],
): InstructorAvailabilityConflict | null {
  const weekday = event.start.toLocaleDateString('en-US', { weekday: 'long' });
  const availBlock = instructor.availability.find((a) => a.day === weekday);
  if (!availBlock) return { reason: 'outside-availability' };

  const day = event.start;
  const availStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(availBlock.startMinutes / 60), availBlock.startMinutes % 60);
  const availEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(availBlock.endMinutes / 60), availBlock.endMinutes % 60);
  if (event.start.getTime() < availStart.getTime() || event.end.getTime() > availEnd.getTime()) {
    return { reason: 'outside-availability' };
  }

  const gapMinutes = requiredGapMinutes(instructor);
  const bufferMs = gapMinutes * 60000;
  const conflictingEvent = otherEvents.find((other) => {
    if (other.instructorId !== instructor.id || other.id === event.id) return false;
    return event.start.getTime() < other.end.getTime() + bufferMs && event.end.getTime() > other.start.getTime() - bufferMs;
  });
  return conflictingEvent ? { reason: 'too-close-to-booking', conflictingEvent, requiredGapMinutes: gapMinutes } : null;
}
