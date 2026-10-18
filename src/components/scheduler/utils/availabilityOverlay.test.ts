import { describe, expect, it } from 'vitest'
import type { InstructorOption, Resource, SchedulerEvent } from '../Scheduler.types'
import { computeAvailabilityBands, findInstructorAvailabilityConflict } from './availabilityOverlay'

const MONDAY = new Date('2026-09-07T00:00:00') // a real Monday

function makeInstructor(overrides: Partial<InstructorOption> = {}): InstructorOption {
  return {
    id: 1,
    name: 'Jane Doe',
    availability: [{ day: 'Monday', startMinutes: 9 * 60, endMinutes: 17 * 60 }],
    ...overrides,
  }
}

function makeEvent(overrides: Partial<SchedulerEvent> = {}): SchedulerEvent {
  return {
    id: 'e1',
    resourceId: 'gym',
    instructorId: 1,
    instructorName: 'Jane Doe',
    title: 'Yoga',
    start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 10, 0),
    end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 0),
    ...overrides,
  }
}

const GYM: Resource = { id: 'gym', title: 'Gym', roomNeeds: ['Gym/ weight-room equipment'] }
const POOL: Resource = { id: 'pool', title: 'Pool', roomNeeds: ['Pool'] }
const GENERAL: Resource = { id: 'ara', title: 'ARA', roomNeeds: ['Mirrors', 'No specific room features required'] }

// dayStartHour/dayEndHour match the instructor's own 9am-5pm availability
// exactly, so every band produced falls inside their open window (no
// separate "before/after availability" unavailable bands to filter out).
function bandsFor(event: SchedulerEvent, resources: Resource[]) {
  return computeAvailabilityBands(event, makeInstructor(), resources, [event], [MONDAY], 9, 17)
}

describe('computeAvailabilityBands — room-needs-based yellow/green', () => {
  it('marks a room "preferred" (green) when it has every one of the class\'s stated needs', () => {
    const event = makeEvent({ roomNeeds: ['Pool'] })
    const bands = bandsFor(event, [POOL])
    expect(bands.every((b) => b.level === 'preferred')).toBe(true)
  })

  it('marks a room "available" (yellow) when the instructor is free but the room is missing a stated need', () => {
    const event = makeEvent({ roomNeeds: ['Pool'] })
    const bands = bandsFor(event, [GYM])
    expect(bands.every((b) => b.level === 'available')).toBe(true)
  })

  it('marks only general-purpose rooms "preferred" for a class with no stated needs at all — never a Pool/Gym/Virtual/Outdoor room it never asked for', () => {
    const event = makeEvent({ roomNeeds: undefined })
    const generalBands = bandsFor(event, [GENERAL])
    expect(generalBands.every((b) => b.level === 'preferred')).toBe(true)
    const exclusiveBands = bandsFor(event, [GYM, POOL])
    expect(exclusiveBands.every((b) => b.level === 'available')).toBe(true)
  })

  it('requires every stated need to be present, not just one of several', () => {
    const event = makeEvent({ roomNeeds: ['Mirrors', 'Pool'] })
    // GENERAL has Mirrors but not Pool -> should NOT count as suited
    const bands = bandsFor(event, [GENERAL])
    expect(bands.every((b) => b.level === 'available')).toBe(true)
  })

  it('still marks time outside the instructor\'s availability as unavailable regardless of room fit', () => {
    const event = makeEvent({ roomNeeds: ['Pool'] })
    // Wider than the instructor's own 9am-5pm availability, unlike bandsFor's own matched window.
    const bands = computeAvailabilityBands(event, makeInstructor(), [POOL], [event], [MONDAY], 8, 20)
    const eveningBand = bands.find((b) => b.resourceId === 'pool' && b.start.getHours() >= 17)
    expect(eveningBand?.level).toBe('unavailable')
  })
})

describe('findInstructorAvailabilityConflict', () => {
  it('is null for an event fully inside the instructor\'s declared availability with no other bookings nearby', () => {
    const event = makeEvent() // 10am-11am Monday; instructor is free 9am-5pm
    expect(findInstructorAvailabilityConflict(event, makeInstructor(), [event])).toBeNull()
  })

  it('is "outside-availability" when the event starts before the instructor\'s declared availability', () => {
    const event = makeEvent({
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 8, 0),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 9, 30),
    })
    expect(findInstructorAvailabilityConflict(event, makeInstructor(), [event])).toEqual({ reason: 'outside-availability' })
  })

  it('is "outside-availability" when the instructor has no declared availability at all that day', () => {
    const event = makeEvent() // Monday, but instructor below is only available Tuesday
    const instructor = makeInstructor({ availability: [{ day: 'Tuesday', startMinutes: 9 * 60, endMinutes: 17 * 60 }] })
    expect(findInstructorAvailabilityConflict(event, instructor, [event])).toEqual({ reason: 'outside-availability' })
  })

  it('is "too-close-to-booking" (naming the specific sibling event + the required gap) within the DEFAULT 15-minute gap for an instructor who stated no preference', () => {
    const event = makeEvent({
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 10),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 12, 10),
    })
    const otherBooking = makeEvent({
      id: 'e2',
      title: 'Pilates',
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 10, 0),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 0),
    })
    // Gap between the two is exactly 10 minutes — inside the 15-minute default.
    expect(findInstructorAvailabilityConflict(event, makeInstructor(), [event, otherBooking])).toEqual({
      reason: 'too-close-to-booking',
      conflictingEvent: otherBooking,
      requiredGapMinutes: 15,
    })
  })

  it('is null once the gap exceeds the DEFAULT 15 minutes (not the old flat hour)', () => {
    const event = makeEvent({
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 30),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 12, 30),
    })
    const otherBooking = makeEvent({
      id: 'e2',
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 10, 0),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 0),
    })
    // Gap is 30 minutes — outside the 15-minute default, even though it would have conflicted under the old flat 1-hour rule.
    expect(findInstructorAvailabilityConflict(event, makeInstructor(), [event, otherBooking])).toBeNull()
  })

  it('respects an instructor\'s own larger preferredGapMinutes', () => {
    const event = makeEvent({
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 30),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 12, 30),
    })
    const otherBooking = makeEvent({
      id: 'e2',
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 10, 0),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 0),
    })
    const instructor = makeInstructor({ preferredGapMinutes: 45 })
    // Gap is 30 minutes — inside this instructor's own stated 45-minute preference.
    expect(findInstructorAvailabilityConflict(event, instructor, [event, otherBooking])).toEqual({
      reason: 'too-close-to-booking',
      conflictingEvent: otherBooking,
      requiredGapMinutes: 45,
    })
  })

  it('never flags a proximity conflict for an instructor whose stated comfort says back-to-back is fine, even with zero gap', () => {
    const event = makeEvent({
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 0),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 12, 0),
    })
    const otherBooking = makeEvent({
      id: 'e2',
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 10, 0),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 0), // ends exactly when the next one starts
    })
    const instructor = makeInstructor({ consecutiveComfort: 'I am comfortable teaching consecutive classes, but have no preference' })
    expect(findInstructorAvailabilityConflict(event, instructor, [event, otherBooking])).toBeNull()
  })

  it('still flags a LITERAL overlap even for an instructor comfortable with back-to-back classes', () => {
    const event = makeEvent({
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 10, 30),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 30),
    })
    const otherBooking = makeEvent({
      id: 'e2',
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 10, 0),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 0), // overlaps 10:30-11:00 with the event above
    })
    const instructor = makeInstructor({ consecutiveComfort: 'I prefer classes to be scheduled consecutively (back-to-back)' })
    expect(findInstructorAvailabilityConflict(event, instructor, [event, otherBooking])).toEqual({
      reason: 'too-close-to-booking',
      conflictingEvent: otherBooking,
      requiredGapMinutes: 0,
    })
  })

  it('ignores a different instructor\'s bookings when checking the buffer', () => {
    const event = makeEvent({
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 10),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 12, 10),
    })
    const otherInstructorsBooking = makeEvent({
      id: 'e2',
      instructorId: 2,
      start: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 10, 0),
      end: new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate(), 11, 0),
    })
    expect(findInstructorAvailabilityConflict(event, makeInstructor(), [event, otherInstructorsBooking])).toBeNull()
  })
})
