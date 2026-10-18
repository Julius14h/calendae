import { parseScheduleState } from './saveState'
import type { ScheduleStateData } from './saveState'

// Persists the SCHEDULE — never the raw source CSVs. The two survey CSVs
// (Availability, Class Profile) only ever live in React state for the
// current browsing session; nothing about them touches localStorage. Only
// once a real schedule has actually been generated from both (see
// SchedulerPage.tsx) does anything get written here — and by that point
// it's already gone through buildRoster, which never carries instructor
// email past its own join step, so nothing sensitive ends up persisted.
const SCHEDULE_STORAGE_KEY = 'calendae.schedule'

export function loadStoredSchedule(): ScheduleStateData | null {
  try {
    const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY)
    if (!raw) return null
    return parseScheduleState(raw)
  } catch {
    // Missing/corrupted/unavailable storage — fall back to nothing stored, not a crash.
    return null
  }
}

export function saveStoredSchedule(state: ScheduleStateData): void {
  try {
    localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or unavailable — this session still works, just won't survive a reload.
  }
}
