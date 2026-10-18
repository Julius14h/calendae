import type { ClassTypeOption, InstructorOption, Resource, SchedulerEvent, UnplacedClass } from '../../components/scheduler'
import type { Class } from '../roster/types'
import { saveFile } from './downloadFile'
import { exportFilename } from './exportFilename'

// 3 adds `classDefinitions` (see regenerateWeek.ts). 4 adds
// `resolvedIssueIds` (see SchedulerPage.tsx's own reviewIssues) — both
// informational only, parseScheduleState doesn't branch on either, it just
// defaults the field.
const SCHEDULE_STATE_VERSION = 4

export interface ScheduleStateData {
  resources: Resource[]
  classTypes: ClassTypeOption[]
  instructors: InstructorOption[]
  events: SchedulerEvent[]
  unplacedClasses: UnplacedClass[]
  /** Each instructor's own class definitions (domain/duration/room needs/capacity), sourced from the roster survey — kept around after Generate/Add New finish (unlike before, when this was discarded the instant the schedule was built) specifically so regenerateWeek.ts has something to rebuild a single week "as if for the first time" from, without requiring the CSVs to be re-imported. Never mutated by hand-editing an event — see regenerateWeek.ts's own doc comment on why a placed event's edits are treated as overrides, not written back here. */
  classDefinitions: Class[]
  /** "Resolved" review issues (see SchedulerPage.tsx's own reviewIssues), dismissed from view for the rest of this session/save. Part of the undo-tracked document (rather than separate React state) so Ctrl+Z genuinely undoes a Resolve click, the same as any other edit — see SchedulerPage.tsx's own handleResolveReviewIssue. Issue ids are stable strings (e.g. `instructor-conflict-${eventId}`), not array indices, so this stays meaningful across re-renders that recompute the issue list itself. */
  resolvedIssueIds: string[]
}

interface ScheduleStateFile extends ScheduleStateData {
  version: number
  savedAt: string
}

/**
 * Downloads the full app state — rooms, class types, the instructor roster,
 * and every event — as a JSON file. Unlike exportScheduleToXlsx (a flattened,
 * one-way view for humans), this is meant to be re-loaded via
 * parseScheduleState() to resume editing exactly where you left off,
 * independent of whatever roster happens to be imported at the time.
 */
export async function exportScheduleState(state: ScheduleStateData, filename = exportFilename('json')): Promise<void> {
  const payload: ScheduleStateFile = {
    version: SCHEDULE_STATE_VERSION,
    savedAt: new Date().toISOString(),
    ...state,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  await saveFile(blob, filename, 'Schedule save file')
}

/**
 * Parses a previously-saved JSON snapshot. JSON.parse alone leaves `start`/
 * `end` as ISO strings, not Date objects — this revives them, since
 * everything downstream (sorting, drag/resize, the availability overlay)
 * expects real Dates. Throws if the file doesn't look like a schedule save.
 */
export function parseScheduleState(json: string): ScheduleStateData {
  const parsed: unknown = JSON.parse(json)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as ScheduleStateFile).events) ||
    !Array.isArray((parsed as ScheduleStateFile).resources)
  ) {
    throw new Error('This file does not look like a schedule save.')
  }
  const state = parsed as ScheduleStateFile
  return {
    resources: state.resources,
    classTypes: state.classTypes ?? [],
    instructors: state.instructors ?? [],
    unplacedClasses: state.unplacedClasses ?? [],
    classDefinitions: state.classDefinitions ?? [],
    resolvedIssueIds: state.resolvedIssueIds ?? [],
    // `recurrence.end`'s own nested `date` (for the 'on-date' end condition)
    // needs the exact same string->Date revival as start/end above, or it's
    // left as a plain ISO string after a JSON round-trip and every later
    // Date comparison against it (see regenerateWeek.ts's dueRecurringEvents)
    // silently breaks.
    events: state.events.map((event) => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
      recurrence:
        event.recurrence?.end?.type === 'on-date'
          ? { ...event.recurrence, end: { ...event.recurrence.end, date: new Date(event.recurrence.end.date) } }
          : event.recurrence,
    })),
  }
}
