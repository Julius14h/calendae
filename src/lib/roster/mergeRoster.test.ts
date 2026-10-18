import { describe, expect, it } from 'vitest'
import type { InstructorOption, SchedulerEvent, UnplacedClass } from '../../components/scheduler'
import type { ScheduleStateData } from '../schedule/saveState'
import { mergeRosterIntoSchedule } from './mergeRoster'
import type { Class, Instructor } from './types'

function makeClass(overrides: Partial<Class> = {}): Class {
  return {
    id: 1,
    classDomain: 'Fitness & Aquatics',
    instructorId: 1,
    className: 'Swimming',
    classDurationMinutes: 60,
    roomNeeds: ['Pool'],
    maxParticipation: 20,
    deliveryFormats: ['In-Person'],
    ...overrides,
  }
}

function makeIncomingInstructor(overrides: Partial<Instructor> = {}): Instructor {
  return {
    id: 1,
    name: 'Jane Doe',
    classes: [makeClass()],
    status: 'Returning, currently teaching at the Kimel',
    maxSessionsPerWeek: null,
    maxSessionsPerDay: null,
    consecutiveComfort: '',
    preferredGapMinutes: null,
    blockedOutDates: [],
    availability: [],
    anythingElse: '',
    ...overrides,
  }
}

function makeInstructorOption(overrides: Partial<InstructorOption> = {}): InstructorOption {
  return {
    id: 1,
    name: 'Jane Doe',
    availability: [],
    ...overrides,
  }
}

function makeEvent(overrides: Partial<SchedulerEvent> = {}): SchedulerEvent {
  return {
    id: 'e1',
    resourceId: 'roomA',
    instructorId: 1,
    instructorName: 'Jane Doe',
    title: 'Swimming',
    type: 'Fitness & Aquatics',
    start: new Date('2024-06-10T09:00:00'),
    end: new Date('2024-06-10T10:00:00'),
    roomNeeds: ['Pool'],
    deliveryFormats: ['In-Person'],
    maxParticipation: 20,
    ...overrides,
  }
}

function makeDoc(overrides: Partial<ScheduleStateData> = {}): ScheduleStateData {
  return {
    resources: [{ id: 'roomA', title: 'Room A' }],
    classTypes: [{ name: 'Fitness & Aquatics', color: '#4f6df5' }],
    instructors: [],
    events: [],
    unplacedClasses: [],
    classDefinitions: [],
    resolvedIssueIds: [],
    ...overrides,
  }
}

describe('mergeRosterIntoSchedule', () => {
  it('adds a brand new instructor and turns every one of their classes into an unplaced class', () => {
    const doc = makeDoc()
    const { doc: result, rosterWarnings, mergeWarnings } = mergeRosterIntoSchedule(doc, [makeIncomingInstructor()])

    expect(result.instructors).toEqual([expect.objectContaining({ id: 1, name: 'Jane Doe' })])
    expect(result.unplacedClasses).toEqual([
      expect.objectContaining({ title: 'Swimming', instructorId: 1, instructorName: 'Jane Doe', durationMinutes: 60 }),
    ])
    expect(rosterWarnings).toEqual([])
    expect(mergeWarnings).toEqual([])
  })

  it('assigns new instructor ids after the highest existing one, never colliding across multiple new instructors in one run', () => {
    const doc = makeDoc({ instructors: [makeInstructorOption({ id: 5, name: 'Existing Person' })] })
    const incoming = [makeIncomingInstructor({ name: 'New Person A' }), makeIncomingInstructor({ name: 'New Person B' })]
    const { doc: result } = mergeRosterIntoSchedule(doc, incoming)

    const newIds = result.instructors.filter((i) => i.name !== 'Existing Person').map((i) => i.id)
    expect(newIds).toEqual([6, 7])
  })

  it('matches a unique existing name confidently, never touching that instructor\'s own fields, even with zero claimed-class overlap', () => {
    const doc = makeDoc({
      instructors: [makeInstructorOption({ id: 1, name: 'Jane Doe', maxSessionsPerWeek: 3, anythingElse: 'hand-edited note' })],
    })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ className: 'Pilates' })] })
    const { doc: result, rosterWarnings } = mergeRosterIntoSchedule(doc, [incoming])

    expect(result.instructors).toEqual([
      expect.objectContaining({ id: 1, name: 'Jane Doe', maxSessionsPerWeek: 3, anythingElse: 'hand-edited note' }),
    ])
    expect(result.unplacedClasses).toEqual([expect.objectContaining({ title: 'Pilates', instructorId: 1 })])
    expect(rosterWarnings).toEqual([])
  })

  it('resolves an ambiguous same-name match via a single clear claimed-class overlap winner', () => {
    const doc = makeDoc({
      instructors: [
        makeInstructorOption({ id: 1, name: 'Jane Doe' }),
        makeInstructorOption({ id: 2, name: 'Jane Doe' }),
      ],
      // Instructor id 2 is already known to teach Yoga — the overlap signal.
      events: [makeEvent({ instructorId: 2, title: 'Yoga' })],
    })
    // Claims both Yoga (the overlap signal) and Pilates (genuinely new).
    const incoming = makeIncomingInstructor({ classes: [makeClass({ className: 'Yoga' }), makeClass({ className: 'Pilates' })] })
    const { doc: result, rosterWarnings, mergeWarnings } = mergeRosterIntoSchedule(doc, [incoming])

    expect(rosterWarnings).toEqual([])
    // Yoga already matches the placed event (identical details -> no mergeWarning); Pilates is a
    // genuinely new class for id 2 -> a new unplaced entry. Resolved to instructor id 2 (the one
    // already known to teach Yoga), no new instructor created, id 1 untouched.
    expect(mergeWarnings).toEqual([])
    expect(result.unplacedClasses).toEqual([expect.objectContaining({ title: 'Pilates', instructorId: 2 })])
  })

  it('falls back to a review item (never guessing) when overlap is tied or all-zero across candidates', () => {
    const doc = makeDoc({
      instructors: [
        makeInstructorOption({ id: 1, name: 'Jane Doe' }),
        makeInstructorOption({ id: 2, name: 'Jane Doe' }),
      ],
    })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ className: 'Pilates' })] })
    const { doc: result, rosterWarnings } = mergeRosterIntoSchedule(doc, [incoming])

    expect(result.unplacedClasses).toEqual([])
    expect(rosterWarnings).toEqual([
      expect.objectContaining({
        type: 'unclaimed-class-profile',
        className: 'Pilates',
        // Real existing InstructorOption ids, not re-derived indices — the
        // whole point of this reuse (see PendingBookingActions.tsx's
        // suggestedClassesById lookup, which keys strictly off real doc ids).
        possibleInstructors: [
          { id: 1, name: 'Jane Doe', classes: [] },
          { id: 2, name: 'Jane Doe', classes: [] },
        ],
      }),
    ])
  })

  it('surfaces a review item (never auto-updating) when a matched class already has a PLACED event with different details', () => {
    const doc = makeDoc({
      instructors: [makeInstructorOption({ id: 1, name: 'Jane Doe' })],
      events: [makeEvent({ id: 'e1' })], // 60 min, Pool, In-Person, capacity 20
    })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ classDurationMinutes: 90 })] })
    const { doc: result, mergeWarnings } = mergeRosterIntoSchedule(doc, [incoming])

    expect(result.events).toEqual(doc.events) // untouched
    expect(mergeWarnings).toEqual([
      expect.objectContaining({ type: 'class-details-changed', eventId: 'e1', className: 'Swimming', changes: ['Duration: 60 → 90 min'] }),
    ])
  })

  it('silently refreshes a matched still-unplaced entry in place, with no review item', () => {
    const existingUnplaced: UnplacedClass = {
      id: 'u1',
      title: 'Swimming',
      type: 'Fitness & Aquatics',
      durationMinutes: 45,
      instructorId: 1,
      instructorName: 'Jane Doe',
    }
    const doc = makeDoc({
      instructors: [makeInstructorOption({ id: 1, name: 'Jane Doe' })],
      unplacedClasses: [existingUnplaced],
    })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ classDurationMinutes: 90 })] })
    const { doc: result, mergeWarnings } = mergeRosterIntoSchedule(doc, [incoming])

    expect(mergeWarnings).toEqual([])
    expect(result.unplacedClasses).toEqual([expect.objectContaining({ id: 'u1', title: 'Swimming', durationMinutes: 90 })])
  })

  it('handles a class matching BOTH a placed event and a not-yet-placed entry independently (Unschedule can create this overlap)', () => {
    const existingUnplaced: UnplacedClass = {
      id: 'u1',
      title: 'Swimming',
      type: 'Fitness & Aquatics',
      durationMinutes: 45,
      instructorId: 1,
      instructorName: 'Jane Doe',
    }
    const doc = makeDoc({
      instructors: [makeInstructorOption({ id: 1, name: 'Jane Doe' })],
      events: [makeEvent({ id: 'e1' })], // 60 min
      unplacedClasses: [existingUnplaced], // 45 min
    })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ classDurationMinutes: 90 })] })
    const { doc: result, mergeWarnings } = mergeRosterIntoSchedule(doc, [incoming])

    // Placed side: flagged, untouched.
    expect(mergeWarnings).toEqual([
      expect.objectContaining({ type: 'class-details-changed', eventId: 'e1', changes: ['Duration: 60 → 90 min'] }),
    ])
    expect(result.events).toEqual(doc.events)
    // Unplaced side: silently refreshed, no NEW unplaced entry created (both matches consumed the incoming class, not just one).
    expect(result.unplacedClasses).toEqual([expect.objectContaining({ id: 'u1', durationMinutes: 90 })])
  })

  it('appends a color for a new domain without disturbing existing classType entries', () => {
    const doc = makeDoc({ classTypes: [{ name: 'Fitness & Aquatics', color: '#4f6df5' }] })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ classDomain: 'Mind, Body, & Soul Wellness', className: 'Meditation' })] })
    const { doc: result } = mergeRosterIntoSchedule(doc, [incoming])

    expect(result.classTypes[0]).toEqual({ name: 'Fitness & Aquatics', color: '#4f6df5' })
    expect(result.classTypes.some((ct) => ct.name === 'Mind, Body, & Soul Wellness')).toBe(true)
  })

  it('leaves resources untouched', () => {
    const doc = makeDoc()
    const { doc: result } = mergeRosterIntoSchedule(doc, [makeIncomingInstructor()])
    expect(result.resources).toBe(doc.resources)
  })

  it('adds a class definition for a brand new instructor\'s class', () => {
    const doc = makeDoc()
    const { doc: result } = mergeRosterIntoSchedule(doc, [makeIncomingInstructor()])

    expect(result.classDefinitions).toEqual([expect.objectContaining({ instructorId: 1, className: 'Swimming', classDurationMinutes: 60 })])
  })

  it('adds a class definition for a matched existing instructor\'s genuinely new class', () => {
    const doc = makeDoc({ instructors: [makeInstructorOption({ id: 1, name: 'Jane Doe' })] })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ className: 'Pilates' })] })
    const { doc: result } = mergeRosterIntoSchedule(doc, [incoming])

    expect(result.classDefinitions).toEqual([expect.objectContaining({ instructorId: 1, className: 'Pilates' })])
  })

  it('refreshes an existing class definition\'s fields in place, preserving its id, when the roster data changes', () => {
    const doc = makeDoc({
      instructors: [makeInstructorOption({ id: 1, name: 'Jane Doe' })],
      classDefinitions: [makeClass({ id: 7, instructorId: 1, className: 'Swimming', classDurationMinutes: 60 })],
    })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ className: 'Swimming', classDurationMinutes: 75 })] })
    const { doc: result } = mergeRosterIntoSchedule(doc, [incoming])

    expect(result.classDefinitions).toEqual([expect.objectContaining({ id: 7, instructorId: 1, className: 'Swimming', classDurationMinutes: 75 })])
  })

  it('never creates a class definition for an unresolved (ambiguous-instructor) class', () => {
    const doc = makeDoc({
      instructors: [makeInstructorOption({ id: 1, name: 'Jane Doe' }), makeInstructorOption({ id: 2, name: 'Jane Doe' })],
    })
    const incoming = makeIncomingInstructor({ classes: [makeClass({ className: 'Pilates' })] })
    const { doc: result, rosterWarnings } = mergeRosterIntoSchedule(doc, [incoming])

    expect(rosterWarnings).toEqual([expect.objectContaining({ type: 'unclaimed-class-profile', className: 'Pilates' })])
    expect(result.classDefinitions).toEqual([])
  })
})
