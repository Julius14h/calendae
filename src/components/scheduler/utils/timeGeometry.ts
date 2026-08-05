import { addMinutes, clamp, isSameDay } from './dateMath';

/**
 * Shared geometry for the resource timeline (Day/Week views): converts between
 * pixel offsets and calendar time. Every column represents `slotMinutes` of the
 * business-hours window [dayStartHour, dayEndHour) for one day; days are laid
 * out left-to-right so dragging horizontally across the timeline is equivalent
 * to dragging across days.
 */
export interface TimelineGeometry {
  days: Date[];
  slotMinutes: number;
  snapMinutes: number;
  slotWidthPx: number;
  dayStartHour: number;
  dayEndHour: number;
  pxPerMinute: number;
  dayWidthPx: number;
  totalWidthPx: number;
}

export function createTimelineGeometry(opts: {
  days: Date[];
  slotMinutes: number;
  snapMinutes: number;
  slotWidthPx: number;
  dayStartHour: number;
  dayEndHour: number;
}): TimelineGeometry {
  const pxPerMinute = opts.slotWidthPx / opts.slotMinutes;
  const dayWidthPx = (opts.dayEndHour - opts.dayStartHour) * 60 * pxPerMinute;
  return {
    ...opts,
    pxPerMinute,
    dayWidthPx,
    totalWidthPx: dayWidthPx * opts.days.length,
  };
}

/** Whole hours in the visible business-hours window, e.g. [8, 9, ..., 19]. */
export function hoursOfDay(geometry: TimelineGeometry): number[] {
  return Array.from(
    { length: geometry.dayEndHour - geometry.dayStartHour },
    (_, i) => geometry.dayStartHour + i,
  );
}

export function hourWidthPx(geometry: TimelineGeometry): number {
  return 60 * geometry.pxPerMinute;
}

export function snapToInterval(minutes: number, snapMinutes: number): number {
  return Math.round(minutes / snapMinutes) * snapMinutes;
}

/** Minutes into the business-hours window (can be negative/overflowing if outside it). */
function minutesIntoWindow(date: Date, geometry: TimelineGeometry): number {
  return date.getHours() * 60 + date.getMinutes() - geometry.dayStartHour * 60;
}

/** X offset (content pixels) of a given date; clamps into the visible day range. */
export function dateToX(date: Date, geometry: TimelineGeometry): number {
  let dayIndex = geometry.days.findIndex((d) => isSameDay(d, date));
  if (dayIndex === -1) {
    dayIndex = date.getTime() < geometry.days[0].getTime() ? 0 : geometry.days.length - 1;
  }
  const windowMinutes = clamp(
    minutesIntoWindow(date, geometry),
    0,
    (geometry.dayEndHour - geometry.dayStartHour) * 60,
  );
  return dayIndex * geometry.dayWidthPx + windowMinutes * geometry.pxPerMinute;
}

/** Inverse of `dateToX`, snapped to `snapMinutes`. */
export function xToDate(x: number, geometry: TimelineGeometry): Date {
  const dayWindowMinutes = (geometry.dayEndHour - geometry.dayStartHour) * 60;
  const clampedX = clamp(x, 0, geometry.totalWidthPx);
  const dayIndex = clamp(Math.floor(clampedX / geometry.dayWidthPx), 0, geometry.days.length - 1);
  const offsetInDay = clampedX - dayIndex * geometry.dayWidthPx;
  let minutes = snapToInterval(offsetInDay / geometry.pxPerMinute, geometry.snapMinutes);
  minutes = clamp(minutes, 0, dayWindowMinutes);
  const day = geometry.days[dayIndex];
  return addMinutes(day, geometry.dayStartHour * 60 + minutes);
}

export function durationToWidthPx(startDate: Date, endDate: Date, geometry: TimelineGeometry): number {
  return Math.max(4, dateToX(endDate, geometry) - dateToX(startDate, geometry));
}
