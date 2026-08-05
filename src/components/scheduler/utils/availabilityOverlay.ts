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

const ONE_HOUR_MS = 60 * 60000;

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

/**
 * For the event currently open in the details drawer, computes colored bands
 * for every room across the visible days — a client-side, advisory mirror of
 * the same rules allocate.ts enforces when building the schedule:
 *
 * - Red ("unavailable"): outside the instructor's declared weekly
 *   availability for that day, or within an hour of one of their other
 *   bookings (the same buffer rule as allocate.ts's instructorBookingBuffer).
 * - Yellow ("available"): the instructor is free, but this room isn't one of
 *   the event's preferred rooms (or there's no preference list at all, in
 *   which case every room counts as preferred instead).
 * - Green ("preferred"): the instructor is free and this room is preferred.
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
  const preferredRooms = event.preferredRooms ?? [];
  const treatAllRoomsAsPreferred = preferredRooms.length === 0;

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

    // Same 1-hour buffer as allocate.ts, around this instructor's OTHER bookings (any room).
    const bufferZones: Interval[] = events
      .filter((e) => e.instructorId === instructor.id && e.id !== event.id)
      .map((e) => ({ start: e.start.getTime() - ONE_HOUR_MS, end: e.end.getTime() + ONE_HOUR_MS }));

    const openAfterBuffer = subtractIntervals(availWindow, bufferZones);
    const bufferedOut = subtractIntervals(availWindow, openAfterBuffer);
    for (const iv of bufferedOut) {
      for (const room of resources) bands.push({ resourceId: room.id, start: new Date(iv.start), end: new Date(iv.end), level: 'unavailable' });
    }

    for (const room of resources) {
      const level: AvailabilityLevel = treatAllRoomsAsPreferred || preferredRooms.includes(room.id) ? 'preferred' : 'available';
      for (const iv of openAfterBuffer) {
        bands.push({ resourceId: room.id, start: new Date(iv.start), end: new Date(iv.end), level });
      }
    }
  }

  return bands;
}
