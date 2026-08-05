import { describe, expect, it } from 'vitest'
import type { Resource } from '../../components/scheduler'
import type { ClassRequest, Instructor } from '../roster/types'
import { allocate } from './allocate'
import type { ClassInfo } from './types'

// Small hand-written fixture (not the parsed .xlsx) — quicker to tweak for
// individual scenarios (conflicts, no matching room, unmet availability...)
// than re-exporting a form submission for each case.
// 2024-06-10 is a Monday — matches the availability block below.
// Built fresh per test — cheap insurance against fixture state leaking
// between tests if allocate()'s treatment of its inputs ever changes.
function makeInstructors(): Instructor[] {
  return [
    {
      name: 'Jane Doe',
      id: 1,
      preferredRooms: ['roomA'],
      classRequests: [],
      availability: [{ day: 'Monday', startMinutes: 9 * 60, endMinutes: 11 * 60 }],
    },
  ]
}

function makeClassRequests(): ClassRequest[] {
  return [
    {
      id: 1,
      instructorId: 1,
      classType: 'Aquatics',
      durationMinutes: 60,
      preferredRooms: ['roomA'],
      className: 'Swimming',
      events: [],
      count: 1,
    },
  ]
}

const rooms: Resource[] = [{ id: 'roomA', title: 'Room A' }]

const classes: ClassInfo[] = [{ id: 'c1', name: 'Aquatics', durationMinutes: 60, type: 'Aquatics' }]

describe('allocate', () => {
  it('books Jane into her preferred room once within her Monday availability', () => {
    const start = new Date('2024-06-10T09:00:00')
    const end = new Date('2024-06-10T12:00:00')

    const result = allocate(makeClassRequests(), rooms, classes, makeInstructors(), start, end)

    expect(result).toEqual([
      expect.objectContaining({
        resourceId: 'roomA',
        title: 'Swimming',
        instructorId: 1,
        start: new Date('2024-06-10T09:00:00'),
        end: new Date('2024-06-10T10:00:00'),
      }),
    ])
  })

  it('does not double-book the room within the one-hour instructor buffer', () => {
    const start = new Date('2024-06-10T09:00:00')
    const end = new Date('2024-06-10T12:00:00')

    const result = allocate(makeClassRequests(), rooms, classes, makeInstructors(), start, end)

    // Only one event should exist for the whole window — the buffer plus the
    // 9-11 availability window leaves no room for a second Aquatics session.
    expect(result).toHaveLength(1)
  })
})
