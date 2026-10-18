import { describe, expect, it } from 'vitest'
import type { SchedulerEvent } from '../../components/scheduler'
import type { Class, Instructor } from './types'
import { binClassesForGeneratedSchedule } from './unplacedClasses'

function makeClass(overrides: Partial<Class> = {}): Class {
  return {
    id: 1,
    classDomain: 'Fitness & Aquatics',
    instructorId: 1,
    className: 'Swimming',
    classDurationMinutes: 45,
    roomNeeds: [],
    maxParticipation: null,
    ...overrides,
  }
}

function makeInstructor(overrides: Partial<Instructor> = {}): Instructor {
  return {
    id: 1,
    name: 'Jane Doe',
    classes: [],
    status: '',
    maxSessionsPerWeek: 1,
    maxSessionsPerDay: null,
    consecutiveComfort: '',
    preferredGapMinutes: null,
    blockedOutDates: [],
    availability: [],
    ...overrides,
  }
}

function makeEvent(classRequestId: number): SchedulerEvent {
  return {
    id: `e${classRequestId}`,
    resourceId: 'roomA',
    instructorId: 1,
    instructorName: 'Jane Doe',
    classRequestId,
    title: 'Booked',
    start: new Date('2024-06-10T09:00:00'),
    end: new Date('2024-06-10T10:00:00'),
  }
}

describe('binClassesForGeneratedSchedule', () => {
  it('bins a roster class that never got booked (e.g. weekly cap reached first), but not one that did', () => {
    const instructor = makeInstructor({
      classes: [makeClass({ id: 1, className: 'Swimming' }), makeClass({ id: 2, className: 'Yoga' })],
    })

    const bin = binClassesForGeneratedSchedule([instructor], [makeEvent(1)])

    expect(bin).toEqual([expect.objectContaining({ title: 'Yoga', durationMinutes: 45, instructorId: 1, instructorName: 'Jane Doe' })])
    expect(bin[0].note).toBeUndefined()
  })

  it('never bins Foundational Courses (manual-only by design, not a failure)', () => {
    const instructor = makeInstructor({ classes: [makeClass({ classDomain: 'Foundational Courses' })] })

    expect(binClassesForGeneratedSchedule([instructor], [])).toEqual([])
  })

  it('bins unprofiled classes with their placeholder duration and note', () => {
    const instructor = makeInstructor({
      unprofiledClasses: [{ ...makeClass({ id: -1, className: 'Tai Chi', classDurationMinutes: 60 }), reason: 'no-profile' }],
    })

    expect(binClassesForGeneratedSchedule([instructor], [])).toEqual([
      expect.objectContaining({
        title: 'Tai Chi',
        durationMinutes: 60,
        note: 'No Class Profile found. Class duration was set to the default 60 mins.',
      }),
    ])
  })
})
