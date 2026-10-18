import type { SchedulerEvent } from '../Scheduler.types';

export interface ConflictCandidate {
  resourceId: string;
  instructorId: number;
  start: Date;
  end: Date;
  /** The event being moved — excluded from the scan so it never conflicts with itself. */
  excludeEventId?: string;
}

export interface ConflictResult {
  roomConflict: SchedulerEvent | null;
  instructorConflict: SchedulerEvent | null;
}

/**
 * Direct time-overlap only — deliberately NOT the 1-hour instructor buffer
 * allocate.ts's instructorBookingBuffer / utils/availabilityOverlay.ts's red
 * bands use elsewhere in this app. A conscious, simpler rule for Month
 * view's drag-to-move feature (explicit product decision), not something
 * that should silently drift into matching those elsewhere.
 *
 * Callers must always pass the full, unfiltered event list — never a
 * display-only filtered view (e.g. hidden class types/instructors) — since a
 * hidden event still really occupies its room/instructor.
 */
export function findConflicts(events: SchedulerEvent[], candidate: ConflictCandidate): ConflictResult {
  let roomConflict: SchedulerEvent | null = null;
  let instructorConflict: SchedulerEvent | null = null;
  for (const event of events) {
    if (event.id === candidate.excludeEventId) continue;
    if (!(candidate.start < event.end && candidate.end > event.start)) continue;
    if (!roomConflict && event.resourceId === candidate.resourceId) roomConflict = event;
    if (!instructorConflict && event.instructorId === candidate.instructorId) instructorConflict = event;
    if (roomConflict && instructorConflict) break;
  }
  return { roomConflict, instructorConflict };
}
