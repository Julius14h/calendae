import { describe, expect, it } from 'vitest'
import { allocate } from '../allocator/allocate'
import { REAL_ROOMS } from '../allocator/rooms'
import { buildRoster } from '../roster/buildRoster'
import { parseDedupedClassProfileRows } from '../roster/parseClassProfileCsv'
import { parseDedupedInstructorRows } from '../roster/parseInstructorSurveyCsv'
import instructorCsv from './mock-availability-form.csv?raw'
import classProfileCsv from './mock-class-profile.csv?raw'

// Guards the `?demo` link — if the CSV parsers' expected columns ever
// change, this fails instead of the demo silently opening a blank calendar.
describe('demo mock data', () => {
  it('builds a roster and allocates a populated schedule', () => {
    const { instructors } = buildRoster(parseDedupedInstructorRows(instructorCsv), parseDedupedClassProfileRows(classProfileCsv))
    expect(instructors.length).toBeGreaterThan(20)

    const start = new Date(2026, 0, 5) // a Monday
    const end = new Date(2026, 1, 5)
    const { events } = allocate(instructors, REAL_ROOMS, start, end, 8, 20)
    expect(events.length).toBeGreaterThan(50)
  })
})
