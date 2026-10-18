import { describe, expect, it } from 'vitest'
import { buildRoster } from './buildRoster'
import type { DedupedClassProfileRow, DedupedInstructorRow } from './types'

// Small hand-written fixtures — quicker to tweak per scenario than
// re-exporting real form submissions for each case.
function makeInstructorRow(overrides: Partial<DedupedInstructorRow> = {}): DedupedInstructorRow {
  return {
    id: '1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    status: 'Returning, currently teaching at the Kimel',
    maxSessionsPerWeek: null,
    maxSessionsPerDay: null,
    consecutiveComfort: '',
    preferredGapMinutes: null,
    classes: [{ domain: 'Fitness & Aquatics', className: 'Swimming' }],
    blockedOutDates: [],
    availability: [],
    anythingElse: '',
    completionStatus: 'Complete',
    ...overrides,
  }
}

function makeClassProfileRow(overrides: Partial<DedupedClassProfileRow> = {}): DedupedClassProfileRow {
  return {
    id: '1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    domain: 'Fitness & Aquatics',
    className: 'Swimming',
    durationMinutes: 60,
    maxParticipation: 20,
    roomNeeds: ['Pool'],
    deliveryFormats: ['In-Person'],
    completionStatus: 'Complete',
    ...overrides,
  }
}

describe('buildRoster', () => {
  it('joins a matching Class Profile submission by (email, className)', () => {
    const { instructors } = buildRoster([makeInstructorRow()], [makeClassProfileRow()])
    const [instructor] = instructors

    expect(instructor.id).toBe(1)
    expect(instructor.name).toBe('Jane Doe')
    expect(instructor.classes).toEqual([
      {
        id: 1,
        classDomain: 'Fitness & Aquatics',
        instructorId: 1,
        className: 'Swimming',
        classDurationMinutes: 60,
        roomNeeds: ['Pool'],
        maxParticipation: 20,
        deliveryFormats: ['In-Person'],
      },
    ])
  })

  it('skips a class with no matching Class Profile submission, but keeps the instructor and warns', () => {
    const { instructors, warnings } = buildRoster([makeInstructorRow()], [])
    const [instructor] = instructors

    expect(instructor.classes).toEqual([])
    expect(instructor.name).toBe('Jane Doe')
    expect(warnings).toEqual([{ type: 'unmatched-availability-class', instructorName: 'Jane Doe', className: 'Swimming', reason: 'no-profile' }])
  })

  it('skips a class whose Class Profile submission has no duration yet, and warns with the right reason', () => {
    const { instructors, warnings } = buildRoster([makeInstructorRow()], [makeClassProfileRow({ durationMinutes: null })])
    const [instructor] = instructors

    expect(instructor.classes).toEqual([])
    expect(warnings).toEqual([{ type: 'unmatched-availability-class', instructorName: 'Jane Doe', className: 'Swimming', reason: 'no-duration' }])
  })

  it('does not cross-match classes between different instructors sharing a class name', () => {
    const instructorRows = [
      makeInstructorRow({ email: 'jane@example.com', classes: [{ domain: 'Fitness & Aquatics', className: 'Yoga' }] }),
      makeInstructorRow({ email: 'john@example.com', name: 'John Smith', classes: [{ domain: 'Fitness & Aquatics', className: 'Yoga' }] }),
    ]
    const classProfileRows = [
      makeClassProfileRow({ email: 'john@example.com', name: 'John Smith', className: 'Yoga', durationMinutes: 45 }),
    ]

    const { instructors } = buildRoster(instructorRows, classProfileRows)
    const [jane, john] = instructors

    // Jane's Yoga has no profile of her own — John's shouldn't leak into hers.
    expect(jane.classes).toEqual([])
    expect(john.classes).toHaveLength(1)
    expect(john.classes[0].classDurationMinutes).toBe(45)
  })

  it('keeps a Foundational Courses class as a real, bookable Class (allocate() decides not to auto-schedule it, not this step)', () => {
    const instructorRows = [
      makeInstructorRow({ classes: [{ domain: 'Foundational Courses', className: 'SMART Goals Workshop' }] }),
    ]
    const classProfileRows = [
      makeClassProfileRow({ domain: 'Foundational Courses', className: 'SMART Goals Workshop', durationMinutes: 30 }),
    ]

    const { instructors } = buildRoster(instructorRows, classProfileRows)
    const [instructor] = instructors

    expect(instructor.classes).toHaveLength(1)
    expect(instructor.classes[0].classDomain).toBe('Foundational Courses')
  })

  it('assigns sequential ids across all instructors and classes, not restarting per instructor', () => {
    const instructorRows = [
      makeInstructorRow({
        email: 'a@example.com',
        classes: [
          { domain: 'Fitness & Aquatics', className: 'Swimming' },
          { domain: 'Fitness & Aquatics', className: 'Yoga' },
        ],
      }),
      makeInstructorRow({ email: 'b@example.com', name: 'John Smith', classes: [{ domain: 'Fitness & Aquatics', className: 'Ballet' }] }),
    ]
    const classProfileRows = [
      makeClassProfileRow({ email: 'a@example.com', className: 'Swimming' }),
      makeClassProfileRow({ email: 'a@example.com', className: 'Yoga' }),
      makeClassProfileRow({ email: 'b@example.com', name: 'John Smith', className: 'Ballet' }),
    ]

    const { instructors } = buildRoster(instructorRows, classProfileRows)
    const [first, second] = instructors

    expect(first.id).toBe(1)
    expect(second.id).toBe(2)
    expect(first.classes.map((c) => c.id)).toEqual([1, 2])
    expect(second.classes.map((c) => c.id)).toEqual([3])
  })

  it('auto-assigns a Class Profile submission whose email matches, even if the class was never explicitly claimed', () => {
    const instructorRows = [makeInstructorRow({ classes: [] })]
    const classProfileRows = [makeClassProfileRow()]

    const { instructors, warnings } = buildRoster(instructorRows, classProfileRows)
    const [instructor] = instructors

    // Matching by email alone is enough to attach it — not flagged as
    // something needing a real instructor, just a low-priority FYI.
    expect(instructor.classes).toEqual([
      {
        id: 1,
        classDomain: 'Fitness & Aquatics',
        instructorId: 1,
        className: 'Swimming',
        classDurationMinutes: 60,
        roomNeeds: ['Pool'],
        maxParticipation: 20,
        deliveryFormats: ['In-Person'],
      },
    ])
    expect(warnings).toEqual([{ type: 'auto-matched-by-email', instructorName: 'Jane Doe', className: 'Swimming' }])
  })

  it('does not auto-assign (and warns with the right reason instead) when the email-matched profile has no duration', () => {
    const instructorRows = [makeInstructorRow({ classes: [] })]
    const classProfileRows = [makeClassProfileRow({ durationMinutes: null })]

    const { instructors, warnings } = buildRoster(instructorRows, classProfileRows)

    expect(instructors[0].classes).toEqual([])
    expect(warnings).toEqual([{ type: 'unmatched-availability-class', instructorName: 'Jane Doe', className: 'Swimming', reason: 'no-duration' }])
  })

  it('flags a Class Profile submission as needing an instructor only when its email matches no Availability Form submission at all', () => {
    const instructorRows = [makeInstructorRow({ email: 'someone-else@example.com', name: 'Someone Else', classes: [] })]
    const classProfileRows = [makeClassProfileRow()] // still jane@example.com — no instructor row shares that email

    const { instructors, warnings } = buildRoster(instructorRows, classProfileRows)

    expect(instructors[0].classes).toEqual([])
    expect(warnings).toEqual([
      {
        type: 'unclaimed-class-profile',
        instructorName: 'Jane Doe',
        className: 'Swimming',
        classDomain: 'Fitness & Aquatics',
        classDurationMinutes: 60,
        roomNeeds: ['Pool'],
        deliveryFormats: ['In-Person'],
        possibleInstructors: [],
      },
    ])
  })

  it('falls back to 60 minutes for a genuinely orphaned profile (no matching email at all) with no stated duration', () => {
    const instructorRows = [makeInstructorRow({ email: 'someone-else@example.com', name: 'Someone Else', classes: [] })]
    const classProfileRows = [makeClassProfileRow({ durationMinutes: null })]

    const { warnings } = buildRoster(instructorRows, classProfileRows)

    expect(warnings).toEqual([
      {
        type: 'unclaimed-class-profile',
        instructorName: 'Jane Doe',
        className: 'Swimming',
        classDomain: 'Fitness & Aquatics',
        classDurationMinutes: 60,
        roomNeeds: ['Pool'],
        deliveryFormats: ['In-Person'],
        possibleInstructors: [],
      },
    ])
  })

  it('suggests a real instructor whose name matches (case/whitespace-insensitively) even though the email does not', () => {
    const instructorRows = [makeInstructorRow({ email: 'someone-else@example.com', name: '  JANE doe  ', classes: [] })]
    const classProfileRows = [makeClassProfileRow()] // name: 'Jane Doe', email: jane@example.com

    const { warnings } = buildRoster(instructorRows, classProfileRows)

    expect(warnings).toEqual([
      {
        type: 'unclaimed-class-profile',
        instructorName: 'Jane Doe',
        className: 'Swimming',
        classDomain: 'Fitness & Aquatics',
        classDurationMinutes: 60,
        roomNeeds: ['Pool'],
        deliveryFormats: ['In-Person'],
        possibleInstructors: [{ id: 1, name: '  JANE doe  ', classes: [] }],
      },
    ])
  })

  it('lists every real instructor sharing a name, not just one, when two different people happen to share it — with each one\'s own claimed classes, not email, as the distinguishing info', () => {
    const instructorRows = [
      makeInstructorRow({ email: 'someone-else@example.com', name: 'Jane Doe', classes: [{ domain: 'Fitness & Aquatics', className: 'Ballet' }] }),
      makeInstructorRow({ email: 'yet-another@example.com', name: 'Jane Doe', classes: [] }),
    ]
    const classProfileRows = [makeClassProfileRow()] // submitter is also 'Jane Doe', email jane@example.com

    const { warnings } = buildRoster(instructorRows, classProfileRows)
    const warning = warnings.find((w) => w.type === 'unclaimed-class-profile')

    expect(warning).toBeDefined()
    if (!warning || warning.type !== 'unclaimed-class-profile') throw new Error('expected unclaimed-class-profile')
    expect(warning.possibleInstructors).toEqual([
      { id: 1, name: 'Jane Doe', classes: ['Ballet'] },
      { id: 2, name: 'Jane Doe', classes: [] },
    ])
  })

  it('does not warn about an orphaned profile with a blank class name (an incomplete submission)', () => {
    const instructorRows = [makeInstructorRow({ email: 'someone-else@example.com', name: 'Someone Else', classes: [] })]
    const classProfileRows = [makeClassProfileRow({ className: '' })]

    const { warnings } = buildRoster(instructorRows, classProfileRows)

    expect(warnings).toEqual([])
  })

  it('does not warn (or auto-assign) about an email-matched profile with a blank class name (an incomplete submission)', () => {
    const instructorRows = [makeInstructorRow({ classes: [] })]
    const classProfileRows = [makeClassProfileRow({ className: '' })]

    const { instructors, warnings } = buildRoster(instructorRows, classProfileRows)

    expect(instructors[0].classes).toEqual([])
    expect(warnings).toEqual([])
  })

  it('surfaces stated blockout dates verbatim as a warning', () => {
    const instructorRows = [makeInstructorRow({ blockedOutDates: ['Feb 15-26', 'April 12-23'] })]

    const { warnings } = buildRoster(instructorRows, [makeClassProfileRow()])

    expect(warnings).toContainEqual({ type: 'blocked-out-dates', instructorName: 'Jane Doe', blockedOutDates: ['Feb 15-26', 'April 12-23'] })
  })

  it('does not warn about blockout dates when the instructor left them blank', () => {
    const instructorRows = [makeInstructorRow({ blockedOutDates: [] })]

    const { warnings } = buildRoster(instructorRows, [makeClassProfileRow()])

    expect(warnings.some((w) => w.type === 'blocked-out-dates')).toBe(false)
  })
})

describe('buildRoster unprofiled classes', () => {
  it('keeps a claimed class with no Class Profile as a 60-min placeholder, out of the bookable classes', () => {
    const { instructors } = buildRoster([makeInstructorRow()], [])

    expect(instructors[0].classes).toEqual([])
    expect(instructors[0].unprofiledClasses).toEqual([
      {
        id: -1,
        classDomain: 'Fitness & Aquatics',
        instructorId: 1,
        className: 'Swimming',
        classDurationMinutes: 60,
        roomNeeds: [],
        maxParticipation: null,
        reason: 'no-profile',
      },
    ])
  })

  it("keeps a duration-less Class Profile's real details on the placeholder", () => {
    const { instructors } = buildRoster([makeInstructorRow()], [makeClassProfileRow({ durationMinutes: null })])

    expect(instructors[0].unprofiledClasses).toEqual([
      expect.objectContaining({ className: 'Swimming', classDurationMinutes: 60, roomNeeds: ['Pool'], maxParticipation: 20, reason: 'no-duration' }),
    ])
  })

  it('catches a duration-less profile that was only matched by email, too', () => {
    const { instructors } = buildRoster(
      [makeInstructorRow({ classes: [] })],
      [makeClassProfileRow({ className: 'Yoga', durationMinutes: null })],
    )

    expect(instructors[0].unprofiledClasses).toEqual([expect.objectContaining({ className: 'Yoga', reason: 'no-duration' })])
  })

  it("never shifts a real class's own id", () => {
    const { instructors } = buildRoster(
      [makeInstructorRow({ classes: [{ domain: 'Fitness & Aquatics', className: 'Unprofiled' }, { domain: 'Fitness & Aquatics', className: 'Swimming' }] })],
      [makeClassProfileRow()],
    )

    expect(instructors[0].classes.map((c) => c.id)).toEqual([1])
    expect(instructors[0].unprofiledClasses?.map((c) => c.id)).toEqual([-1])
  })
})
