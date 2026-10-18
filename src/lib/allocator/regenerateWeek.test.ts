import { describe, expect, it } from 'vitest'
import type { InstructorOption, Resource, SchedulerEvent, UnplacedClass } from '../../components/scheduler'
import type { Class } from '../roster/types'
import type { ScheduleStateData } from '../schedule/saveState'
import { applyRecurrenceEdit, fillDueRecurringOccurrences, regenerateWeek, type RegenerateWeekOptions } from './regenerateWeek'

// 2024-06-10 is a Monday — matches allocate.test.ts's own fixture convention.
const WEEK_START = new Date('2024-06-10T00:00:00')
const WEEK_END = new Date('2024-06-17T00:00:00')

const rooms: Resource[] = [{ id: 'roomA', title: 'Room A' }]

function makeInstructor(overrides: Partial<InstructorOption> = {}): InstructorOption {
  return {
    id: 1,
    name: 'Jane Doe',
    // Wide open all week — placement should trivially succeed unless a
    // test deliberately narrows this to force a failure.
    availability: [
      { day: 'Monday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
      { day: 'Tuesday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
      { day: 'Wednesday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
      { day: 'Thursday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
      { day: 'Friday', startMinutes: 8 * 60, endMinutes: 20 * 60 },
    ],
    ...overrides,
  }
}

function makeClassDefinition(overrides: Partial<Class> = {}): Class {
  return {
    id: 1,
    classDomain: 'Fitness & Aquatics',
    instructorId: 1,
    className: 'Swimming',
    classDurationMinutes: 60,
    roomNeeds: [],
    maxParticipation: null,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<SchedulerEvent> = {}): SchedulerEvent {
  return {
    id: 'e1',
    resourceId: 'roomA',
    instructorId: 1,
    instructorName: 'Jane Doe',
    classRequestId: 1,
    title: 'Swimming',
    start: new Date('2024-06-10T09:00:00'),
    end: new Date('2024-06-10T10:00:00'),
    ...overrides,
  }
}

function makeDoc(overrides: Partial<ScheduleStateData> = {}): ScheduleStateData {
  return {
    resources: rooms,
    classTypes: [],
    instructors: [makeInstructor()],
    events: [],
    unplacedClasses: [],
    classDefinitions: [makeClassDefinition()],
    resolvedIssueIds: [],
    ...overrides,
  }
}

function makeOptions(overrides: Partial<RegenerateWeekOptions> = {}): RegenerateWeekOptions {
  return {
    rangeStart: WEEK_START,
    rangeEnd: WEEK_END,
    overflowPolicy: 'archive-to-bin',
    manualEventPolicy: 'preserve',
    includeBinItems: false,
    ...overrides,
  }
}

describe('regenerateWeek', () => {
  it('leaves a pinned event exactly as-is and never books a duplicate of the same class', () => {
    const pinned = makeEvent({ id: 'pinned-1', pinned: true, start: new Date('2024-06-10T09:00:00'), end: new Date('2024-06-10T10:00:00') })
    const doc = makeDoc({ events: [pinned] })

    const { doc: result } = regenerateWeek(doc, makeOptions())

    expect(result.events).toEqual([pinned])
  })

  it('carries note/color/a manual rename forward onto the regenerated replacement of a roster-backed event', () => {
    const original = makeEvent({ note: 'Bring extra towels', color: '#4f6df5', title: 'Swim Time (renamed)' })
    const doc = makeDoc({ events: [original] })

    const { doc: result } = regenerateWeek(doc, makeOptions())

    const replacement = result.events.find((e) => e.classRequestId === 1)
    expect(replacement).toBeDefined()
    expect(replacement).toEqual(
      expect.objectContaining({ note: 'Bring extra towels', color: '#4f6df5', title: 'Swim Time (renamed)' }),
    )
  })

  it('manual event policy "preserve" leaves a manually-created event untouched', () => {
    const manual = makeEvent({ id: 'manual-1', classRequestId: undefined, title: 'One-off Workshop' })
    const doc = makeDoc({ events: [manual] })

    const { doc: result } = regenerateWeek(doc, makeOptions({ manualEventPolicy: 'preserve' }))

    expect(result.events).toContainEqual(manual)
  })

  it('manual event policy "reposition" carries its own fields forward as a fresh placement, not a fixed slot', () => {
    const manual = makeEvent({
      id: 'manual-1',
      classRequestId: undefined,
      title: 'One-off Workshop',
      note: 'Needs extra chairs',
      start: new Date('2024-06-10T09:00:00'),
      end: new Date('2024-06-10T10:00:00'),
    })
    const doc = makeDoc({ classDefinitions: [], events: [manual] })

    const { doc: result } = regenerateWeek(doc, makeOptions({ manualEventPolicy: 'reposition' }))

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual(expect.objectContaining({ title: 'One-off Workshop', note: 'Needs extra chairs' }))
    // A genuinely fresh placement, not necessarily (though it may coincidentally be) the same id.
    expect(result.events[0].id).not.toBe('manual-1')
  })

  it('manual event policy "delete" drops a manually-created event entirely', () => {
    const manual = makeEvent({ id: 'manual-1', classRequestId: undefined, title: 'One-off Workshop' })
    const doc = makeDoc({ classDefinitions: [], events: [manual] })

    const { doc: result } = regenerateWeek(doc, makeOptions({ manualEventPolicy: 'delete' }))

    expect(result.events).toEqual([])
  })

  it('an event whose classRequestId no longer resolves to any class definition is treated as manual, not crashed', () => {
    const stale = makeEvent({ id: 'stale-1', classRequestId: 999, title: 'Pre-feature Event' })
    const doc = makeDoc({ classDefinitions: [makeClassDefinition({ id: 1 })], events: [stale] })

    const { doc: result } = regenerateWeek(doc, makeOptions({ manualEventPolicy: 'preserve' }))

    expect(result.events).toContainEqual(stale)
  })

  it('leaves the Classes Bin untouched when includeBinItems is false', () => {
    const binItem: UnplacedClass = { id: 'u1', title: 'Pilates', durationMinutes: 45, instructorId: 1, instructorName: 'Jane Doe' }
    const doc = makeDoc({ unplacedClasses: [binItem] })

    const { doc: result } = regenerateWeek(doc, makeOptions({ includeBinItems: false }))

    expect(result.unplacedClasses).toEqual([binItem])
    expect(result.events.some((e) => e.title === 'Pilates')).toBe(false)
  })

  it('places a Classes Bin item when includeBinItems is true and a slot is available', () => {
    const binItem: UnplacedClass = { id: 'u1', title: 'Pilates', durationMinutes: 45, instructorId: 1, instructorName: 'Jane Doe' }
    const doc = makeDoc({ classDefinitions: [], unplacedClasses: [binItem] })

    const { doc: result } = regenerateWeek(doc, makeOptions({ includeBinItems: true }))

    expect(result.unplacedClasses).toEqual([])
    expect(result.events).toEqual([expect.objectContaining({ title: 'Pilates', instructorId: 1 })])
  })

  it('archives a class to the bin, unchanged elsewhere, when it genuinely cannot be placed and overflowPolicy is archive-to-bin', () => {
    const doc = makeDoc({ instructors: [makeInstructor({ availability: [] })] }) // no availability at all -> guaranteed failure

    const { doc: result } = regenerateWeek(doc, makeOptions({ overflowPolicy: 'archive-to-bin' }))

    expect(result.events).toEqual([])
    expect(result.unplacedClasses).toEqual([expect.objectContaining({ title: 'Swimming', instructorId: 1 })])
  })

  it('force-places a class as a real, visible event when it genuinely cannot be placed and overflowPolicy is force-place', () => {
    const doc = makeDoc({ instructors: [makeInstructor({ availability: [] })] }) // no availability at all -> guaranteed failure

    const { doc: result } = regenerateWeek(doc, makeOptions({ overflowPolicy: 'force-place' }))

    expect(result.unplacedClasses).toEqual([])
    expect(result.events).toEqual([expect.objectContaining({ title: 'Swimming', instructorId: 1, resourceId: 'roomA' })])
  })

  it('self-heals: a class definition with no prior event this week still gets a fresh attempt', () => {
    const doc = makeDoc({
      classDefinitions: [makeClassDefinition({ id: 1, className: 'Swimming' }), makeClassDefinition({ id: 2, className: 'Yoga' })],
      events: [], // neither class has ever been booked this week
    })

    const { doc: result } = regenerateWeek(doc, makeOptions())

    expect(result.events.map((e) => e.title).sort()).toEqual(['Swimming', 'Yoga'])
  })

  it('leaves events outside the target range completely untouched', () => {
    const laterEvent = makeEvent({ id: 'later', start: new Date('2024-07-01T09:00:00'), end: new Date('2024-07-01T10:00:00') })
    const doc = makeDoc({ events: [laterEvent] })

    const { doc: result } = regenerateWeek(doc, makeOptions())

    expect(result.events).toContainEqual(laterEvent)
  })

  it('a multi-week range books the same weekly class once per week, not once for the whole range', () => {
    const doc = makeDoc({ events: [] })
    // Range spans exactly 2 Monday-Sunday weeks.
    const twoWeeksEnd = new Date('2024-06-24T00:00:00')

    const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: twoWeeksEnd }))

    const swimmingEvents = result.events.filter((e) => e.title === 'Swimming')
    expect(swimmingEvents).toHaveLength(2)
    expect(swimmingEvents.some((e) => e.start < WEEK_END)).toBe(true)
    expect(swimmingEvents.some((e) => e.start >= WEEK_END)).toBe(true)
  })

  it('a pin in week 2 of a multi-week range does not block week 1\'s own booking of the same class', () => {
    const pinnedWeek2 = makeEvent({
      id: 'pinned-week2',
      pinned: true,
      start: new Date('2024-06-18T09:00:00'),
      end: new Date('2024-06-18T10:00:00'),
    })
    const doc = makeDoc({ events: [pinnedWeek2] })
    const twoWeeksEnd = new Date('2024-06-24T00:00:00')

    const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: twoWeeksEnd }))

    // Week 1 still gets its own fresh Swimming booking; week 2's is covered by the pin instead
    // of a second, freshly-generated one (the pinned event itself is also titled "Swimming").
    const freshSwimmingEvents = result.events.filter((e) => e.title === 'Swimming' && !e.pinned)
    expect(freshSwimmingEvents).toHaveLength(1)
    expect(freshSwimmingEvents[0].start < WEEK_END).toBe(true)
    expect(result.events).toContainEqual(pinnedWeek2)
  })

  it('never produces a newly-generated event whose id collides with an existing one, even across a multi-week run that calls allocate() once per week', () => {
    // Mimics allocate()'s own real id scheme (e1, e2, ...) for a pre-existing
    // pinned event — every week's regenerate call to allocate() internally
    // restarts its own id counter from scratch, so without a fix this would
    // collide with whatever a later week's own freshly-generated event happens
    // to be numbered.
    const pinned = makeEvent({ id: 'e1', pinned: true, title: 'Existing Pinned Class' })
    const doc = makeDoc({
      classDefinitions: [makeClassDefinition({ id: 1, className: 'Swimming' }), makeClassDefinition({ id: 2, className: 'Yoga' })],
      events: [pinned],
    })
    const threeWeeksEnd = new Date('2024-07-01T00:00:00')

    const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: threeWeeksEnd }))

    const ids = result.events.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  describe('recurrence', () => {
    it('holds an existing occurrence of a recurring series in place, exactly like a pinned event', () => {
      const recurring = makeEvent({
        id: 'recur-1',
        classRequestId: undefined,
        title: 'Yoga',
        note: 'Bring extra mats',
        recurrence: { pattern: 'weekly', seriesId: 'series-1' },
      })
      const doc = makeDoc({ classDefinitions: [], events: [recurring] })

      const { doc: result } = regenerateWeek(doc, makeOptions())

      expect(result.events).toContainEqual(recurring)
    })

    it('creates a fresh occurrence, copying the anchor\'s room/time/note/color, in a due week that has none yet', () => {
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Yoga',
        note: 'Bring extra mats',
        color: '#4f6df5',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1
        end: new Date('2024-06-10T10:00:00'),
        recurrence: { pattern: 'weekly', seriesId: 'series-1' },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })
      const twoWeeksEnd = new Date('2024-06-24T00:00:00')

      const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: twoWeeksEnd }))

      const week2Occurrence = result.events.find((e) => e.id !== anchor.id && e.recurrence?.seriesId === 'series-1')
      expect(week2Occurrence).toBeDefined()
      expect(week2Occurrence).toEqual(
        expect.objectContaining({
          title: 'Yoga',
          note: 'Bring extra mats',
          color: '#4f6df5',
          resourceId: 'roomA',
          instructorId: 1,
          start: new Date('2024-06-17T09:00:00'), // same weekday/time, one week later
          end: new Date('2024-06-17T10:00:00'),
        }),
      )
      // Never inherits the anchor's own classRequestId or pinned flag (see dueRecurringEvents).
      expect(week2Occurrence?.classRequestId).toBeUndefined()
      expect(week2Occurrence?.pinned).toBeFalsy()
    })

    it('a biweekly series skips the off week and fires again on the due week', () => {
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Pilates',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1
        end: new Date('2024-06-10T10:00:00'),
        recurrence: { pattern: 'biweekly', seriesId: 'series-biweekly' },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })
      const threeWeeksEnd = new Date('2024-07-01T00:00:00') // covers weeks 1, 2, 3

      const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: threeWeeksEnd }))

      const seriesEvents = result.events.filter((e) => e.recurrence?.seriesId === 'series-biweekly')
      // Week 1 (anchor) and week 3 (due, 2 weeks later) — never week 2.
      expect(seriesEvents).toHaveLength(2)
      expect(seriesEvents.some((e) => e.start.getTime() === new Date('2024-06-10T09:00:00').getTime())).toBe(true)
      expect(seriesEvents.some((e) => e.start.getTime() === new Date('2024-06-24T09:00:00').getTime())).toBe(true)
    })

    it('excludes a matching class definition from independent regeneration in a week already covered by recurrence, avoiding a duplicate booking', () => {
      const recurring = makeEvent({
        id: 'recur-1',
        classRequestId: 1,
        title: 'Swimming',
        recurrence: { pattern: 'weekly', seriesId: 'series-1' },
      })
      // classDefinitions still has the matching Swimming definition (id 1, from makeDoc's own default).
      const doc = makeDoc({ events: [recurring] })

      const { doc: result } = regenerateWeek(doc, makeOptions())

      const swimmingEvents = result.events.filter((e) => e.title === 'Swimming')
      expect(swimmingEvents).toHaveLength(1)
      expect(swimmingEvents[0]).toEqual(recurring)
    })

    it('an "ends on a date" condition stops creating new occurrences once the next one would fall after it', () => {
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Yoga',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1
        end: new Date('2024-06-10T10:00:00'),
        recurrence: {
          pattern: 'weekly',
          seriesId: 'series-ends-on-date',
          end: { type: 'on-date', date: new Date('2024-06-14T00:00:00') }, // last day of week 1
        },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })
      const twoWeeksEnd = new Date('2024-06-24T00:00:00')

      const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: twoWeeksEnd }))

      const seriesEvents = result.events.filter((e) => e.recurrence?.seriesId === 'series-ends-on-date')
      expect(seriesEvents).toHaveLength(1) // only the anchor — week 2 is past the end date
    })

    it('an "ends on a date" condition still allows an occurrence that falls exactly on the end date', () => {
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Yoga',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1
        end: new Date('2024-06-10T10:00:00'),
        recurrence: {
          pattern: 'weekly',
          seriesId: 'series-ends-on-date-2',
          end: { type: 'on-date', date: new Date('2024-06-17T00:00:00') }, // the exact day week 2's occurrence falls on
        },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })
      const twoWeeksEnd = new Date('2024-06-24T00:00:00')

      const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: twoWeeksEnd }))

      const seriesEvents = result.events.filter((e) => e.recurrence?.seriesId === 'series-ends-on-date-2')
      expect(seriesEvents).toHaveLength(2) // the end date's own day still counts
    })

    it('an "ends after N occurrences" condition stops once the series already has that many', () => {
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Yoga',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1
        end: new Date('2024-06-10T10:00:00'),
        recurrence: { pattern: 'weekly', seriesId: 'series-ends-after-1', end: { type: 'after-occurrences', count: 1 } },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })
      const twoWeeksEnd = new Date('2024-06-24T00:00:00')

      const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: twoWeeksEnd }))

      const seriesEvents = result.events.filter((e) => e.recurrence?.seriesId === 'series-ends-after-1')
      expect(seriesEvents).toHaveLength(1) // the anchor already IS the 1 occurrence this series is allowed
    })

    it('an "ends after N occurrences" condition allows exactly N total before stopping', () => {
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Yoga',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1
        end: new Date('2024-06-10T10:00:00'),
        recurrence: { pattern: 'weekly', seriesId: 'series-ends-after-2', end: { type: 'after-occurrences', count: 2 } },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })
      const threeWeeksEnd = new Date('2024-07-01T00:00:00')

      const { doc: result } = regenerateWeek(doc, makeOptions({ rangeEnd: threeWeeksEnd }))

      const seriesEvents = result.events.filter((e) => e.recurrence?.seriesId === 'series-ends-after-2')
      expect(seriesEvents).toHaveLength(2) // anchor (week 1) + one more (week 2), never a 3rd in week 3
    })
  })

  describe('fillDueRecurringOccurrences', () => {
    it('backfills a "forever" series into a range nobody has ever regenerated over', () => {
      // Regenerate never touched week 2 at all — this reproduces the actual
      // reported bug: a "forever" series only ever gets new occurrences
      // within whatever range Generate/Regenerate was explicitly run over,
      // so navigating past that range made it look like recurrence stopped.
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Yoga',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1
        end: new Date('2024-06-10T10:00:00'),
        recurrence: { pattern: 'weekly', seriesId: 'series-forever' },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })

      const filled = fillDueRecurringOccurrences(doc, new Date('2024-06-17T00:00:00'), new Date('2024-06-24T00:00:00'))

      const week2Occurrence = filled.events.find((e) => e.id !== anchor.id && e.recurrence?.seriesId === 'series-forever')
      expect(week2Occurrence).toBeDefined()
      expect(week2Occurrence?.start).toEqual(new Date('2024-06-17T09:00:00'))
    })

    it('is a no-op (returns the same doc reference) when nothing is due', () => {
      const doc = makeDoc({ classDefinitions: [], events: [] })

      const filled = fillDueRecurringOccurrences(doc, WEEK_START, WEEK_END)

      expect(filled).toBe(doc)
    })

    it('never creates a spurious duplicate when given a Sunday-starting range for a week the anchor already covers', () => {
      // Real reported bug: this app's own week VIEW labels itself Sun-Sat
      // (e.g. "September 6-12" with Monday the 7th as the first real day
      // column), so the visible range handed to this function by
      // onDateChange starts on Sunday, one day before the allocator's own
      // Monday-Sunday week model. Passing that straight through used to
      // make eachWeekWindow split off a spurious 1-day sliver ending
      // exactly at Monday, which incorrectly looked "not yet covered" and
      // got a duplicate created on the Sunday — every single time that
      // week was viewed.
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Yoga',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1, noon-ish
        end: new Date('2024-06-10T10:00:00'),
        recurrence: { pattern: 'weekly', seriesId: 'series-sunday-view' },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })
      const sundayBeforeWeek1 = new Date('2024-06-09T00:00:00')
      const sundayViewEnd = new Date(sundayBeforeWeek1.getTime() + 7 * 24 * 60 * 60 * 1000) // following Sunday

      const filled = fillDueRecurringOccurrences(doc, sundayBeforeWeek1, sundayViewEnd)

      const seriesEvents = filled.events.filter((e) => e.recurrence?.seriesId === 'series-sunday-view')
      expect(seriesEvents).toEqual([anchor]) // still just the anchor, nothing spurious added
    })

    it('creates the correct Monday-aligned occurrence, not a Sunday-shifted one, when the visible range starts on Sunday', () => {
      const anchor = makeEvent({
        id: 'recur-anchor',
        classRequestId: undefined,
        title: 'Yoga',
        start: new Date('2024-06-10T09:00:00'), // Monday, week 1
        end: new Date('2024-06-10T10:00:00'),
        recurrence: { pattern: 'weekly', seriesId: 'series-sunday-view-2' },
      })
      const doc = makeDoc({ classDefinitions: [], events: [anchor] })
      // Sunday-starting "week 2" view, exactly as onDateChange would report it.
      const sundayOfWeek2 = new Date('2024-06-16T00:00:00')
      const sundayViewEnd = new Date(sundayOfWeek2.getTime() + 7 * 24 * 60 * 60 * 1000)

      const filled = fillDueRecurringOccurrences(doc, sundayOfWeek2, sundayViewEnd)

      const newOccurrence = filled.events.find((e) => e.id !== anchor.id && e.recurrence?.seriesId === 'series-sunday-view-2')
      expect(newOccurrence).toBeDefined()
      expect(newOccurrence?.start).toEqual(new Date('2024-06-17T09:00:00')) // Monday, not Sunday the 16th
    })

    it('never touches anything except adding due recurring occurrences — no reshuffling, no bin/manual handling', () => {
      const untouched = makeEvent({ id: 'untouched-1', classRequestId: undefined, title: 'One-off Workshop' })
      const doc = makeDoc({ classDefinitions: [], events: [untouched] })

      const filled = fillDueRecurringOccurrences(doc, WEEK_START, WEEK_END)

      expect(filled.events).toEqual([untouched])
    })
  })
})

describe('applyRecurrenceEdit', () => {
  function makeSeries() {
    const anchor = makeEvent({
      id: 'anchor',
      classRequestId: undefined,
      title: 'Yoga',
      start: new Date('2024-06-10T09:00:00'), // Monday, week 1
      end: new Date('2024-06-10T10:00:00'),
      recurrence: { pattern: 'weekly', seriesId: 's1' },
    })
    const occ2 = makeEvent({
      id: 'occ2',
      classRequestId: undefined,
      title: 'Yoga',
      start: new Date('2024-06-17T09:00:00'), // Monday, week 2
      end: new Date('2024-06-17T10:00:00'),
      recurrence: { pattern: 'weekly', seriesId: 's1' },
    })
    const occ3 = makeEvent({
      id: 'occ3',
      classRequestId: undefined,
      title: 'Yoga',
      start: new Date('2024-06-24T09:00:00'), // Monday, week 3
      end: new Date('2024-06-24T10:00:00'),
      recurrence: { pattern: 'weekly', seriesId: 's1' },
    })
    return { anchor, occ2, occ3 }
  }

  it('is a no-op when the event does not resolve, or is not recurring', () => {
    const { anchor, occ2, occ3 } = makeSeries()
    const doc = makeDoc({ classDefinitions: [], events: [anchor, occ2, occ3] })

    expect(applyRecurrenceEdit(doc, 'does-not-exist', { pattern: 'biweekly', seriesId: 's1' }, 'all')).toBe(doc)

    const nonRecurring = makeEvent({ id: 'plain', classRequestId: undefined, recurrence: undefined })
    const docWithPlain = makeDoc({ classDefinitions: [], events: [nonRecurring] })
    expect(applyRecurrenceEdit(docWithPlain, 'plain', { pattern: 'weekly', seriesId: 'new' }, 'all')).toBe(docWithPlain)
  })

  it("'all' applies the new pattern/end to every occurrence, keeping the same seriesId", () => {
    const { anchor, occ2, occ3 } = makeSeries()
    const doc = makeDoc({ classDefinitions: [], events: [anchor, occ2, occ3] })

    const result = applyRecurrenceEdit(doc, 'occ2', { pattern: 'biweekly', seriesId: 's1' }, 'all')

    for (const id of ['anchor', 'occ2', 'occ3']) {
      const event = result.events.find((e) => e.id === id)
      expect(event?.recurrence).toEqual({ pattern: 'biweekly', seriesId: 's1' })
    }
  })

  it("'all' clears recurrence from every occurrence when turning it off", () => {
    const { anchor, occ2, occ3 } = makeSeries()
    const doc = makeDoc({ classDefinitions: [], events: [anchor, occ2, occ3] })

    const result = applyRecurrenceEdit(doc, 'occ2', undefined, 'all')

    for (const id of ['anchor', 'occ2', 'occ3']) {
      expect(result.events.find((e) => e.id === id)?.recurrence).toBeUndefined()
    }
  })

  it("'this-and-following' splits the series: earlier occurrences keep the old pattern (end capped to the day before), this-and-later get the new pattern under a fresh seriesId", () => {
    const { anchor, occ2, occ3 } = makeSeries()
    const doc = makeDoc({ classDefinitions: [], events: [anchor, occ2, occ3] })

    const result = applyRecurrenceEdit(doc, 'occ2', { pattern: 'biweekly', seriesId: 's1' }, 'this-and-following')

    const resultAnchor = result.events.find((e) => e.id === 'anchor')
    expect(resultAnchor?.recurrence?.pattern).toBe('weekly') // untouched cadence
    expect(resultAnchor?.recurrence?.seriesId).toBe('s1') // stays in the old series
    expect(resultAnchor?.recurrence?.end).toEqual({ type: 'on-date', date: new Date('2024-06-16T23:59:59.999') })

    const resultOcc2 = result.events.find((e) => e.id === 'occ2')
    const resultOcc3 = result.events.find((e) => e.id === 'occ3')
    expect(resultOcc2?.recurrence?.pattern).toBe('biweekly')
    expect(resultOcc3?.recurrence?.pattern).toBe('biweekly')
    expect(resultOcc2?.recurrence?.seriesId).toBe(resultOcc3?.recurrence?.seriesId)
    expect(resultOcc2?.recurrence?.seriesId).not.toBe('s1')
  })

  it("'this-and-following' turning recurrence off detaches this-and-later occurrences entirely, leaving earlier ones still recurring (just capped)", () => {
    const { anchor, occ2, occ3 } = makeSeries()
    const doc = makeDoc({ classDefinitions: [], events: [anchor, occ2, occ3] })

    const result = applyRecurrenceEdit(doc, 'occ2', undefined, 'this-and-following')

    const resultAnchor = result.events.find((e) => e.id === 'anchor')
    expect(resultAnchor?.recurrence?.pattern).toBe('weekly')
    expect(resultAnchor?.recurrence?.end).toEqual({ type: 'on-date', date: new Date('2024-06-16T23:59:59.999') })
    expect(result.events.find((e) => e.id === 'occ2')?.recurrence).toBeUndefined()
    expect(result.events.find((e) => e.id === 'occ3')?.recurrence).toBeUndefined()
  })

  it("'this-and-following' on the series' own anchor behaves exactly like 'all' — there's nothing earlier to split off", () => {
    const { anchor, occ2, occ3 } = makeSeries()
    const doc = makeDoc({ classDefinitions: [], events: [anchor, occ2, occ3] })

    const result = applyRecurrenceEdit(doc, 'anchor', { pattern: 'monthly', seriesId: 's1' }, 'this-and-following')

    for (const id of ['anchor', 'occ2', 'occ3']) {
      expect(result.events.find((e) => e.id === id)?.recurrence).toEqual({ pattern: 'monthly', seriesId: 's1' })
    }
  })
})
