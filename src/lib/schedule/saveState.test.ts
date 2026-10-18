import { describe, expect, it } from 'vitest'
import type { ClassTypeOption, InstructorOption, Resource, SchedulerEvent, UnplacedClass } from '../../components/scheduler'
import type { Class } from '../roster/types'
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

  it('defaults unplacedClasses to [] for a version-1 file saved before that field existed', () => {
    const json = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), resources, classTypes, instructors, events })
    const restored = parseScheduleState(json)

    expect(restored.unplacedClasses).toEqual([])
  })

  it('round-trips unplacedClasses for a version-2 file', () => {
    const unplacedClasses: UnplacedClass[] = [
      { id: 'u1', title: 'Yoga', type: 'Fitness & Aquatics', durationMinutes: 45, instructorId: 1, instructorName: 'Jane Doe' },
    ]
    const json = JSON.stringify({
      version: 2,
      savedAt: new Date().toISOString(),
      resources,
      classTypes,
      instructors,
      events,
      unplacedClasses,
    })
    const restored = parseScheduleState(json)

    expect(restored.unplacedClasses).toEqual(unplacedClasses)
  })

  it('defaults classDefinitions to [] for a version-2 file saved before that field existed', () => {
    const json = JSON.stringify({ version: 2, savedAt: new Date().toISOString(), resources, classTypes, instructors, events, unplacedClasses: [] })
    const restored = parseScheduleState(json)

    expect(restored.classDefinitions).toEqual([])
  })

  it('round-trips classDefinitions for a version-3 file', () => {
    const classDefinitions: Class[] = [
      { id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Swimming', classDurationMinutes: 60, roomNeeds: ['Pool'], maxParticipation: 20 },
    ]
    const json = JSON.stringify({
      version: 3,
      savedAt: new Date().toISOString(),
      resources,
      classTypes,
      instructors,
      events,
      unplacedClasses: [],
      classDefinitions,
    })
    const restored = parseScheduleState(json)

    expect(restored.classDefinitions).toEqual(classDefinitions)
  })

  it('throws on a file that does not look like a schedule save', () => {
    expect(() => parseScheduleState(JSON.stringify({ foo: 'bar' }))).toThrow()
  })
})

describe('current (version 4) save compatibility', () => {
  it('round-trips every field of a save made before the bin-recovery changes, unchanged', () => {
    const unplacedClasses: UnplacedClass[] = [
      { id: 'u1', title: 'Yoga', type: 'Fitness & Aquatics', durationMinutes: 45, instructorId: 1, instructorName: 'Jane Doe', note: 'Hand note' },
    ]
    const classDefinitions: Class[] = [
      { id: 1, classDomain: 'Aquatics', instructorId: 1, className: 'Swimming', classDurationMinutes: 60, roomNeeds: ['Pool'], maxParticipation: 12 },
    ]
    const saved = {
      version: 4,
      savedAt: '2026-09-01T12:00:00.000Z',
      resources,
      classTypes,
      instructors,
      events,
      unplacedClasses,
      classDefinitions,
      resolvedIssueIds: ['instructor-conflict-e1'],
    }

    const restored = parseScheduleState(JSON.stringify(saved))

    expect(restored).toEqual({ resources, classTypes, instructors, events, unplacedClasses, classDefinitions, resolvedIssueIds: ['instructor-conflict-e1'] })
  })
})
