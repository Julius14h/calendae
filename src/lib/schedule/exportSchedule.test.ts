import { describe, expect, it } from 'vitest'
import type { Resource, SchedulerEvent } from '../../components/scheduler'
import { scheduleToRows } from './exportSchedule'

const resources: Resource[] = [{ id: 'roomA', title: 'Room A' }]

const events: SchedulerEvent[] = [
  {
    id: 'e1',
    resourceId: 'roomA',
    instructorId: 1,
    classRequestId: 1,
    instructorName: 'Jane Doe',
    title: 'Swimming',
    type: 'Aquatics',
    start: new Date('2024-06-10T09:00:00'),
    end: new Date('2024-06-10T10:00:00'),
  },
]

describe('scheduleToRows', () => {
  it('flattens events into rows with room titles resolved and instructor/type carried through', () => {
    const rows = scheduleToRows(events, resources)

    expect(rows).toEqual([
      {
        'Class Name': 'Swimming',
        'Class Type': 'Aquatics',
        Instructor: 'Jane Doe',
        Room: 'Room A',
        Date: new Date('2024-06-10T09:00:00').toLocaleDateString(),
        Start: new Date('2024-06-10T09:00:00').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        End: new Date('2024-06-10T10:00:00').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ])
  })

  it('sorts rows by start time regardless of input order', () => {
    const later: SchedulerEvent = { ...events[0], id: 'e2', title: 'Later class', start: new Date('2024-06-10T14:00:00'), end: new Date('2024-06-10T15:00:00') }
    const rows = scheduleToRows([later, events[0]], resources)
    expect(rows.map((r) => r['Class Name'])).toEqual(['Swimming', 'Later class'])
  })
})
