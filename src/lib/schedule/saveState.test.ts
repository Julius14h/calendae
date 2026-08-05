import { describe, expect, it } from 'vitest'
import type { ClassTypeOption, InstructorOption, Resource, SchedulerEvent } from '../../components/scheduler'
import { parseScheduleState } from './saveState'

const resources: Resource[] = [{ id: 'roomA', title: 'Room A' }]
const classTypes: ClassTypeOption[] = [{ name: 'Aquatics', color: '#4f6df5' }]
const instructors: InstructorOption[] = [
  { id: 1, name: 'Jane Doe', availability: [{ day: 'Monday', startMinutes: 540, endMinutes: 660 }] },
]
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

describe('schedule save/load round-trip', () => {
  it('revives start/end back into real Dates after a stringify + parse cycle', () => {
    const json = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), resources, classTypes, instructors, events })
    const restored = parseScheduleState(json)

    expect(restored.events[0].start).toBeInstanceOf(Date)
    expect(restored.events[0].start.getTime()).toBe(events[0].start.getTime())
    expect(restored.events[0].end.getTime()).toBe(events[0].end.getTime())
    expect(restored.resources).toEqual(resources)
    expect(restored.instructors).toEqual(instructors)
    expect(restored.classTypes).toEqual(classTypes)
  })

  it('throws on a file that does not look like a schedule save', () => {
    expect(() => parseScheduleState(JSON.stringify({ foo: 'bar' }))).toThrow()
  })
})
