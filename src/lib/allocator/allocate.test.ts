import { describe, expect, it } from 'vitest'
import type { Resource, SchedulerEvent } from '../../components/scheduler'
import type { Instructor } from '../roster/types'
import { allocate } from './allocate'

const DAY_START_HOUR = 8
const DAY_END_HOUR = 20

// Small hand-written fixture (not the parsed CSV) — quicker to tweak for
// individual scenarios (conflicts, unmet availability...) than re-exporting
// a form submission for each case.
// 2024-06-10 is a Monday — matches the availability block below.
// Built fresh per test — cheap insurance against fixture state leaking
// between tests if allocate()'s treatment of its inputs ever changes.
function makeInstructors(): Instructor[] {
  return [
    {
      id: 1,
      name: 'Jane Doe',
      classes: [{ id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Swimming', classDurationMinutes: 60, roomNeeds: [], maxParticipation: null }],
      status: 'Returning, currently teaching at the Kimel',
      maxSessionsPerWeek: null,
      maxSessionsPerDay: null,
      consecutiveComfort: '',
      preferredGapMinutes: null,
      blockedOutDates: [],
      availability: [{ day: 'Monday', startMinutes: 9 * 60, endMinutes: 11 * 60 }],
    },
  ]
}

const rooms: Resource[] = [{ id: 'roomA', title: 'Room A' }]

describe('allocate', () => {
  it('books Jane once within her Monday availability', () => {
    const start = new Date('2024-06-10T09:00:00')
    const end = new Date('2024-06-10T12:00:00')

    const { events } = allocate(makeInstructors(), rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    expect(events).toEqual([
      expect.objectContaining({
        resourceId: 'roomA',
        title: 'Swimming',
        instructorId: 1,
        start: new Date('2024-06-10T09:00:00'),
        end: new Date('2024-06-10T10:00:00'),
      }),
    ])
  })

  it('only books a class once per week even though the slot sweep keeps going', () => {
    const start = new Date('2024-06-10T09:00:00')
    const end = new Date('2024-06-10T12:00:00')

    const { events } = allocate(makeInstructors(), rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    // The buffer plus the 9-11 availability window leaves no room for a
    // second Swimming session even before the once-per-week rule kicks in —
    // this just confirms bookClassOnce actually stops after its first hit.
    expect(events).toHaveLength(1)
  })

  it('stops booking once maxSessionsPerWeek is reached, even with classes left to try', () => {
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [
          { id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Swimming', classDurationMinutes: 60, roomNeeds: [], maxParticipation: null },
          { id: 2, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Yoga', classDurationMinutes: 60, roomNeeds: [], maxParticipation: null },
        ],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: 1,
        maxSessionsPerDay: null,
        consecutiveComfort: '',
        preferredGapMinutes: null,
        blockedOutDates: [],
        // Wide-open availability across two days so both classes *could* be
        // booked if the weekly cap didn't stop it after the first.
        availability: [
          { day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
          { day: 'Tuesday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
        ],
      },
    ]
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-13T00:00:00') // Thursday

    const { events } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Swimming')
  })

  it('never auto-books a Foundational Courses class, even with room to spare', () => {
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [{ id: 1, classDomain: 'Foundational Courses', instructorId: 1, className: 'SMART Goals Workshop', classDurationMinutes: 60, roomNeeds: [], maxParticipation: null }],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: null,
        consecutiveComfort: '',
        preferredGapMinutes: null,
        blockedOutDates: [],
        availability: [{ day: 'Monday', startMinutes: 9 * 60, endMinutes: 11 * 60 }],
      },
    ]
    const start = new Date('2024-06-10T09:00:00')
    const end = new Date('2024-06-10T12:00:00')

    const { events } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    // Foundational Courses are handled manually from the frontend, not by
    // the auto-allocator — the class stays in instructor.classes (staff can
    // still add it by hand), it just never gets auto-booked here.
    expect(events).toHaveLength(0)
  })

  it('enforces preferredGapMinutes exactly for "prefer to have some time between classes"', () => {
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [
          { id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Swimming', classDurationMinutes: 60, roomNeeds: [], maxParticipation: null },
          { id: 2, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Yoga', classDurationMinutes: 30, roomNeeds: [], maxParticipation: null },
        ],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: null,
        consecutiveComfort: 'I prefer to have some time between classes',
        preferredGapMinutes: 30,
        blockedOutDates: [],
        availability: [{ day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 }],
      },
    ]
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')

    const { events } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    // Swimming books greedily at 8:00-9:00. Yoga can't land any earlier than
    // exactly 9:30 (9:00 + the stated 30-minute gap) — not 9:15 (only 15
    // min, too close) and not later than necessary either.
    expect(events).toHaveLength(2)
    const yoga = events.find((e) => e.title === 'Yoga')!
    expect(yoga.start).toEqual(new Date('2024-06-10T09:30:00'))
  })

  it('ignores preferredGapMinutes entirely and allows exact back-to-back for a comfortable-with-consecutive instructor', () => {
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [
          { id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Swimming', classDurationMinutes: 30, roomNeeds: [], maxParticipation: null },
          { id: 2, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Yoga', classDurationMinutes: 30, roomNeeds: [], maxParticipation: null },
        ],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: null,
        // Deliberately non-null, to prove the comfort answer GATES whether
        // preferredGapMinutes applies at all, rather than being averaged
        // with it or otherwise still partially honored.
        consecutiveComfort: 'I am comfortable teaching consecutive classes, but have no preference',
        preferredGapMinutes: 60,
        blockedOutDates: [],
        availability: [{ day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 }],
      },
    ]
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')

    const { events } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    expect(events).toHaveLength(2)
    const yoga = events.find((e) => e.title === 'Yoga')!
    expect(yoga.start).toEqual(new Date('2024-06-10T08:30:00')) // right after Swimming ends at 8:30, zero gap
  })

  it('detects a same-instructor overlap across two different rooms, not just a start-time collision', () => {
    const twoRooms: Resource[] = [
      { id: 'roomA', title: 'Room A' },
      { id: 'roomB', title: 'Room B' },
    ]
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [
          // A short class booked first, then a long one whose start looks
          // "far enough away" under a naive start-only comparison but whose
          // END actually runs well past the first class's start — this is
          // exactly the case a start-time-only buffer check would miss.
          { id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Quick Stretch', classDurationMinutes: 15, roomNeeds: [], maxParticipation: null },
          { id: 2, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Long Workshop', classDurationMinutes: 180, roomNeeds: [], maxParticipation: null },
        ],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: null,
        consecutiveComfort: 'I am comfortable teaching consecutive classes, but have no preference', // 0 gap needed
        preferredGapMinutes: null,
        blockedOutDates: [],
        availability: [{ day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 }],
      },
    ]
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')

    const { events } = allocate(instructors, twoRooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    // Quick Stretch books first at 8:00-8:15 (roomA). Long Workshop must NOT
    // land at 8:00-11:00 in roomB just because a different room is free —
    // that would double-book the instructor for the 8:00-8:15 overlap.
    expect(events).toHaveLength(2)
    const workshop = events.find((e) => e.title === 'Long Workshop')!
    expect(workshop.start.getTime()).toBeGreaterThanOrEqual(new Date('2024-06-10T08:15:00').getTime())
  })

  it('resolves a null weekly cap to the default ceiling (20), not unlimited', () => {
    const manyClasses = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      classDomain: 'Fitness & Aquatics',
      instructorId: 1,
      className: `Class ${i + 1}`,
      classDurationMinutes: 15,
      roomNeeds: [],
      maxParticipation: null,
    }))
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: manyClasses,
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null, // "Unsure/ Flexible" or blank — must NOT mean unlimited
        maxSessionsPerDay: null,
        consecutiveComfort: 'I am comfortable teaching consecutive classes, but have no preference', // 0 gap, so the day easily fits many 15-min slots
        preferredGapMinutes: null,
        blockedOutDates: [],
        availability: [
          { day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
          { day: 'Tuesday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
          { day: 'Wednesday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
        ],
      },
    ]
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-13T00:00:00') // Thursday

    const { events } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    // Plenty of room/time to book all 25 15-minute classes across 3 days —
    // the only thing that should stop it short is the resolved default cap.
    expect(events).toHaveLength(20)
  })

  it('clamps the daily cap to 1 for "I prefer to teach only one class per day", even with a higher explicit maxSessionsPerDay', () => {
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [
          { id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Class A', classDurationMinutes: 30, roomNeeds: [], maxParticipation: null },
          { id: 2, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Class B', classDurationMinutes: 30, roomNeeds: [], maxParticipation: null },
          { id: 3, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Class C', classDurationMinutes: 30, roomNeeds: [], maxParticipation: null },
        ],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: 5, // deliberately contradicts "only one class per day"
        consecutiveComfort: 'I prefer to teach only one class per day',
        preferredGapMinutes: null,
        blockedOutDates: [],
        availability: [
          { day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
          { day: 'Tuesday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
          { day: 'Wednesday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
        ],
      },
    ]
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-13T00:00:00') // Thursday

    const { events } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    // Without the clamp, all 3 would land on Monday (day cap of 5 easily
    // allows it, same-day gap is only the 15-min default). With it, each
    // class needs its own day.
    expect(events).toHaveLength(3)
    const days = events.map((e) => e.start.toDateString())
    expect(new Set(days).size).toBe(3)
  })

  it('processes a more-constrained, explicit-cap instructor before a wide-open flexible one, even when listed second', () => {
    const wideOpenInstructor: Instructor = {
      id: 1,
      name: 'Wide Open Instructor',
      classes: [{ id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Flexible Class', classDurationMinutes: 60, roomNeeds: [], maxParticipation: null }],
      status: 'Returning, currently teaching at the Kimel',
      maxSessionsPerWeek: null, // Unsure/Flexible — lower priority
      maxSessionsPerDay: null,
      consecutiveComfort: '',
      preferredGapMinutes: null,
      blockedOutDates: [],
      availability: [{ day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 }], // wide open all day
    }
    const narrowInstructor: Instructor = {
      id: 2,
      name: 'Narrow Instructor',
      classes: [{ id: 2, classDomain: 'Fitness & Aquatics', instructorId: 2, className: 'Constrained Class', classDurationMinutes: 60, roomNeeds: [], maxParticipation: null }],
      status: 'Returning, currently teaching at the Kimel',
      maxSessionsPerWeek: 1, // explicit — higher priority
      maxSessionsPerDay: 1,
      consecutiveComfort: '',
      preferredGapMinutes: null,
      blockedOutDates: [],
      availability: [{ day: 'Monday', startMinutes: 8 * 60, endMinutes: 9 * 60 }], // ONLY this one hour, all week
    }
    // Wide-open instructor listed FIRST — naive array-order processing would
    // let her grab the only room's 8-9 slot first, leaving the narrow
    // instructor with no other slot to use at all.
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')

    const { events, warnings } = allocate([wideOpenInstructor, narrowInstructor], rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    expect(warnings).toEqual([])
    expect(events).toHaveLength(2)
    const narrow = events.find((e) => e.title === 'Constrained Class')!
    expect(narrow.start).toEqual(new Date('2024-06-10T08:00:00')) // got her only viable slot
    const wide = events.find((e) => e.title === 'Flexible Class')!
    expect(wide.start.getTime()).toBeGreaterThanOrEqual(new Date('2024-06-10T09:00:00').getTime()) // pushed later instead
  })

  it('enforces the shared Zoom admin buffer across different instructors and different Zoom rooms', () => {
    const zoomRooms: Resource[] = [
      { id: 'zoom1', title: 'Zoom 1', roomNeeds: ['Virtual (e.g. Zoom)'] },
      { id: 'zoom2', title: 'Zoom 2', roomNeeds: ['Virtual (e.g. Zoom)'] },
    ]
    const makeVirtualInstructor = (id: number, name: string): Instructor => ({
      id,
      name,
      classes: [{ id, classDomain: 'Fitness & Aquatics', instructorId: id, className: `${name}'s Class`, classDurationMinutes: 30, roomNeeds: ['Virtual (e.g. Zoom)'], maxParticipation: null }],
      status: 'Returning, currently teaching at the Kimel',
      maxSessionsPerWeek: null,
      maxSessionsPerDay: null,
      consecutiveComfort: '',
      preferredGapMinutes: null,
      blockedOutDates: [],
      availability: [{ day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 }],
    })
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')

    const { events } = allocate([makeVirtualInstructor(1, 'Alice'), makeVirtualInstructor(2, 'Bob')], zoomRooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    // Alice books Zoom 1 at 8:00-8:30. Even though Zoom 2 is a completely
    // different room and Bob is a completely different instructor, the
    // shared admin buffer should still push Bob's start to 8:30 or later —
    // not let him land at 8:00-8:15 in Zoom 2 just because that room and
    // his own schedule are both free then.
    expect(events).toHaveLength(2)
    const bob = events.find((e) => e.title === "Bob's Class")!
    expect(bob.start.getTime()).toBeGreaterThanOrEqual(new Date('2024-06-10T08:30:00').getTime())
  })

  it('flags a room-fit mismatch when a Mirrors class exceeds the mirrored room\'s capacity, but still books it', () => {
    const araLikeRoom: Resource[] = [{ id: 'ara', title: 'ARA', maxCapacity: 15, roomNeeds: ['Mirrors'] }]
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [{ id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Big Yoga Class', classDurationMinutes: 60, roomNeeds: ['Mirrors'], maxParticipation: 25 }],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: null,
        consecutiveComfort: '',
        preferredGapMinutes: null,
        blockedOutDates: [],
        availability: [{ day: 'Monday', startMinutes: 9 * 60, endMinutes: 11 * 60 }],
      },
    ]
    const start = new Date('2024-06-10T09:00:00')
    const end = new Date('2024-06-10T12:00:00')

    const { events, warnings } = allocate(instructors, araLikeRoom, start, end, DAY_START_HOUR, DAY_END_HOUR)

    expect(events).toHaveLength(1) // still booked, not refused
    expect(warnings).toEqual([
      {
        type: 'room-fit-mismatch',
        instructorId: 1,
        instructorName: 'Jane Doe',
        className: 'Big Yoga Class',
        roomId: 'ara',
        roomTitle: 'ARA',
        missingRoomNeeds: [],
        overCapacity: true,
        eventId: events[0].id,
      },
    ])
  })

  it('diagnoses "no-eligible-room" when no room in the list carries the needed tag at all', () => {
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [{ id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Pool Aerobics', classDurationMinutes: 60, roomNeeds: ['Pool'], maxParticipation: null }],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: null,
        consecutiveComfort: '',
        preferredGapMinutes: null,
        blockedOutDates: [],
        availability: [{ day: 'Monday', startMinutes: 9 * 60, endMinutes: 11 * 60 }],
      },
    ]
    const start = new Date('2024-06-10T09:00:00')
    const end = new Date('2024-06-10T12:00:00')

    // `rooms` (module-level fixture) has no Pool room at all.
    const { events, warnings } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    expect(events).toHaveLength(0)
    expect(warnings).toEqual([
      {
        type: 'unscheduled-class',
        instructorId: 1,
        instructorName: 'Jane Doe',
        className: 'Pool Aerobics',
        reason: 'no-eligible-room',
        classDomain: 'Fitness & Aquatics',
        classDurationMinutes: 60,
        roomNeeds: ['Pool'],
        deliveryFormats: [],
      },
    ])
  })

  it('diagnoses "no-instructor-availability" when no declared block is long enough for the class', () => {
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [{ id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Long Class', classDurationMinutes: 120, roomNeeds: [], maxParticipation: null }],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: null,
        consecutiveComfort: '',
        preferredGapMinutes: null,
        blockedOutDates: [],
        // Only a 60-minute window all week — too short for a 120-minute class.
        availability: [{ day: 'Monday', startMinutes: 9 * 60, endMinutes: 10 * 60 }],
      },
    ]
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')

    const { warnings } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    expect(warnings).toEqual([
      {
        type: 'unscheduled-class',
        instructorId: 1,
        instructorName: 'Jane Doe',
        className: 'Long Class',
        reason: 'no-instructor-availability',
        classDomain: 'Fitness & Aquatics',
        classDurationMinutes: 120,
        roomNeeds: [],
        deliveryFormats: [],
      },
    ])
  })

  it('diagnoses "daily-cap-reached-every-day" when every day in the week is already at the per-day cap', () => {
    const instructors: Instructor[] = [
      {
        id: 1,
        name: 'Jane Doe',
        classes: [
          { id: 1, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Class A', classDurationMinutes: 30, roomNeeds: [], maxParticipation: null },
          { id: 2, classDomain: 'Fitness & Aquatics', instructorId: 1, className: 'Class B', classDurationMinutes: 30, roomNeeds: [], maxParticipation: null },
        ],
        status: 'Returning, currently teaching at the Kimel',
        maxSessionsPerWeek: null,
        maxSessionsPerDay: 1, // only one booking per day, and only one day is available
        consecutiveComfort: '',
        preferredGapMinutes: null,
        blockedOutDates: [],
        availability: [{ day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 }],
      },
    ]
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')

    const { events, warnings } = allocate(instructors, rooms, start, end, DAY_START_HOUR, DAY_END_HOUR)

    // Class A takes Monday's only slot; Class B's only available day
    // (Monday) is already at cap before a single slot gets tried.
    expect(events).toHaveLength(1)
    expect(warnings).toEqual([
      {
        type: 'unscheduled-class',
        instructorId: 1,
        instructorName: 'Jane Doe',
        className: 'Class B',
        reason: 'daily-cap-reached-every-day',
        classDomain: 'Fitness & Aquatics',
        classDurationMinutes: 30,
        roomNeeds: [],
        deliveryFormats: [],
      },
    ])
  })

  it('diagnoses "no-free-slot" for genuine room contention, distinct from the other reasons', () => {
    const makeInstructorNeedingRoomA = (id: number, name: string): Instructor => ({
      id,
      name,
      classes: [{ id, classDomain: 'Fitness & Aquatics', instructorId: id, className: `${name}'s Class`, classDurationMinutes: 180, roomNeeds: [], maxParticipation: null }],
      status: 'Returning, currently teaching at the Kimel',
      maxSessionsPerWeek: null,
      maxSessionsPerDay: null,
      consecutiveComfort: '',
      preferredGapMinutes: null,
      blockedOutDates: [],
      availability: [{ day: 'Monday', startMinutes: 8 * 60, endMinutes: 11 * 60 }], // exactly one 3-hour window, same for both
    })
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')

    // Both instructors have real, long-enough availability and a real
    // eligible room (`rooms` has one) — they just collide over the one
    // single room and identical 3-hour window, with no room left over.
    const { events, warnings } = allocate(
      [makeInstructorNeedingRoomA(1, 'Alice'), makeInstructorNeedingRoomA(2, 'Bob')],
      rooms,
      start,
      end,
      DAY_START_HOUR,
      DAY_END_HOUR,
    )

    expect(events).toHaveLength(1)
    expect(warnings).toEqual([
      {
        type: 'unscheduled-class',
        instructorId: 2,
        instructorName: 'Bob',
        className: "Bob's Class",
        reason: 'no-free-slot',
        classDomain: 'Fitness & Aquatics',
        classDurationMinutes: 180,
        roomNeeds: [],
        deliveryFormats: [],
      },
    ])
  })

  it('treats a preOccupied event as blocking its slot, without including it in the returned events', () => {
    const start = new Date('2024-06-10T00:00:00') // Monday
    const end = new Date('2024-06-11T00:00:00')
    const pinned: SchedulerEvent = {
      id: 'pinned-1',
      resourceId: 'roomA',
      instructorId: 1,
      instructorName: 'Jane Doe',
      title: 'Pinned Class',
      start: new Date('2024-06-10T09:00:00'),
      end: new Date('2024-06-10T10:00:00'),
      pinned: true,
    }

    const { events } = allocate(makeInstructors(), rooms, start, end, DAY_START_HOUR, DAY_END_HOUR, [pinned])

    // Jane's only availability that day is 9-11am, fully consumed by the
    // pinned event plus its own required gap — nowhere left for Swimming.
    expect(events).toEqual([])
    // The pinned event itself is never duplicated into the return value —
    // the caller already has it and will merge it back in.
    expect(events.some((e) => e.id === 'pinned-1')).toBe(false)
  })
})
