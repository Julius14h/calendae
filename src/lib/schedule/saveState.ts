import type { ClassTypeOption, InstructorOption, Resource, SchedulerEvent } from '../../components/scheduler'
import { saveFile } from './downloadFile'
import { exportFilename } from './exportFilename'

const SCHEDULE_STATE_VERSION = 1

export interface ScheduleStateData {
  resources: Resource[]
  classTypes: ClassTypeOption[]
  instructors: InstructorOption[]
  events: SchedulerEvent[]
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
    events: state.events.map((event) => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
    })),
  }
}
