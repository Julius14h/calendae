import type { DateRange, SchedulerView } from '../Scheduler.types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Start of the week containing `date`. `weekStartsOn`: 0 = Sunday, 1 = Monday. */
export function startOfWeek(date: Date, weekStartsOn: 0 | 1): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  return addDays(d, -diff);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Exclusive end (first day of the following month). */
export function endOfMonthExclusive(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function eachDayOfRange(start: Date, endExclusive: Date): Date[] {
  const days: Date[] = [];
  let cursor = startOfDay(start);
  const end = startOfDay(endExclusive);
  while (cursor.getTime() < end.getTime()) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Builds the full 6-week (42-day) grid used by the month view, including lead/trail days. */
export function monthGridDays(anchorDate: Date, weekStartsOn: 0 | 1): Date[] {
  const monthStart = startOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart, weekStartsOn);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

export function visibleRangeForView(view: SchedulerView, anchorDate: Date, weekStartsOn: 0 | 1): DateRange {
  if (view === 'day') {
    const start = startOfDay(anchorDate);
    return { start, end: addDays(start, 1) };
  }
  if (view === 'week') {
    const start = startOfWeek(anchorDate, weekStartsOn);
    return { start, end: addDays(start, 7) };
  }
  const start = monthGridDays(anchorDate, weekStartsOn)[0];
  return { start, end: addDays(start, 42) };
}

export function shiftAnchorDate(view: SchedulerView, anchorDate: Date, direction: 1 | -1): Date {
  if (view === 'day') return addDays(anchorDate, direction);
  if (view === 'week') return addDays(anchorDate, 7 * direction);
  return addMonths(anchorDate, direction);
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function weekdayLabel(date: Date): string {
  return WEEKDAY_LABELS[date.getDay()];
}

export function monthLabel(date: Date): string {
  return MONTH_LABELS[date.getMonth()];
}

export function formatToolbarTitle(view: SchedulerView, anchorDate: Date, weekStartsOn: 0 | 1): string {
  if (view === 'day') {
    return `${weekdayLabel(anchorDate)}, ${monthLabel(anchorDate)} ${anchorDate.getDate()}, ${anchorDate.getFullYear()}`;
  }
  if (view === 'week') {
    const start = startOfWeek(anchorDate, weekStartsOn);
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      return `${monthLabel(start)} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
    }
    return `${monthLabel(start)} ${start.getDate()} – ${monthLabel(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${monthLabel(anchorDate)} ${anchorDate.getFullYear()}`;
}

export function formatHourLabel(hour: number): string {
  const h = hour % 24;
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

// Used by on-the-hour range pickers (SchedulerDrawer's business hours,
// InstructorViewDialog's availability) where ":00" is always correct —
// kept distinct from formatHourLabel above, which other hour labels (e.g.
// TimeHeader's grid) render without minutes.
export function formatBusinessHourLabel(hour: number): string {
  const h = hour % 24;
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
}

export function formatTimeOfDay(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours < 12 ? 'AM' : 'PM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

/**
 * "8:00 – 9:00 AM" — the start time's own AM/PM is always dropped (the end
 * time's is enough to read the range, even across noon: "11:30 – 12:30 PM").
 */
export function formatTimeRange(start: Date, end: Date): string {
  return `${formatTimeOfDay(start).replace(/ (AM|PM)$/, '')} – ${formatTimeOfDay(end)}`;
}

/** Parses an "HH:mm" string (as accepted by `scrollToTime`) into hours/minutes. */
export function parseTimeString(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export { DAY_MS };
