import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import '../App.css'
import Header from '../components/Header'
import { DEFAULT_DAY_END_HOUR, DEFAULT_DAY_START_HOUR, Scheduler, findInstructorAvailabilityConflict, formatTimeOfDay } from '../components/scheduler'
import type {
  ClassFieldEditScope,
  ClassTypeOption,
  DateRange,
  InstructorOption,
  RecurrenceEditScope,
  RegenerateWeekOptions,
  Resource,
  ReviewIssue,
  SchedulerEvent,
  SchedulerHandle,
  SchedulerView,
  UnplacedClass,
} from '../components/scheduler'
import { useHistoryState } from '../hooks/useHistoryState'
import type { AllocationWarning, UnscheduledClassReason } from '../lib/allocator/allocate'
import { allocate } from '../lib/allocator/allocate'
import { REAL_ROOMS } from '../lib/allocator/rooms'
import { applyRecurrenceEdit, fillDueRecurringOccurrences, regenerateWeek } from '../lib/allocator/regenerateWeek'
import type { RosterWarning } from '../lib/roster/buildRoster'
import { buildRoster } from '../lib/roster/buildRoster'
import { assignClassTypeColor } from '../lib/roster/classTypeColors'
import type { MergeWarning } from '../lib/roster/mergeRoster'
import { mergeRosterIntoSchedule } from '../lib/roster/mergeRoster'
import { parseDedupedClassProfileRows } from '../lib/roster/parseClassProfileCsv'
import { parseDedupedInstructorRows } from '../lib/roster/parseInstructorSurveyCsv'
import type { Instructor } from '../lib/roster/types'
import { exportScheduleToXlsx } from '../lib/schedule/exportSchedule'
import type { ScheduleStateData } from '../lib/schedule/saveState'
import { exportScheduleState, parseScheduleState } from '../lib/schedule/saveState'
import { loadStoredSchedule, saveStoredSchedule } from '../lib/schedule/scheduleStorage'

/** Whether "now" falls inside a scheduler date range (start inclusive, end exclusive). */
function isTodayWithinRange(range: DateRange): boolean {
  const now = new Date()
  return now >= range.start && now < range.end
}

/** Monday of the calendar week containing `date`, at midnight. */
function mostRecentMonday(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const diffFromMonday = (d.getDay() + 6) % 7 // getDay(): 0 = Sunday ... 6 = Saturday
  d.setDate(d.getDate() - diffFromMonday)
  return d
}

// Every fixture/real roster's availability is keyed to real weekday names
// (Monday..Friday), not "today" — so events are generated starting from
// the Monday of the current week (guaranteeing today falls inside the
// range) across a 1-month window, matching the real-world scheduling
// horizon this is meant for. allocate()'s per-instructor weekly cap is what
// makes this recur roughly once (or twice) a week across the whole window
// instead of piling up at the very start.
const scheduleStart = mostRecentMonday(new Date())
const scheduleEnd = new Date(scheduleStart)
scheduleEnd.setMonth(scheduleStart.getMonth() + 1)

const UNSCHEDULED_REASON_TEXT: Record<UnscheduledClassReason, string> = {
  'no-eligible-room': "No room matches this class's stated requirements.",
  'no-instructor-availability': 'The instructor has no available time for this class.',
  'daily-cap-reached-every-day': "The instructor's daily class limit was already reached on every day they're available.",
  'no-free-slot': 'No open time slot could be found for it this week.',
}

/** Maps allocate()'s AllocationWarning[] into the generic ReviewIssue[] shape CreateFab's "Classes to review" modal expects — keeps the Scheduler component itself decoupled from this app's own data layer (see Scheduler.types.ts's doc comment on ReviewIssue). */
function reviewIssuesFromAllocationWarnings(warnings: AllocationWarning[]): ReviewIssue[] {
  return warnings.map((warning, i) => {
    if (warning.type === 'unscheduled-class') {
      return {
        id: `allocation-${i}`,
        category: "Couldn't be scheduled",
        title: `${warning.className} — ${warning.instructorName}`,
        detail: UNSCHEDULED_REASON_TEXT[warning.reason],
        bookableClass: {
          instructorId: warning.instructorId,
          instructorName: warning.instructorName,
          className: warning.className,
          classDomain: warning.classDomain,
          classDurationMinutes: warning.classDurationMinutes,
          roomNeeds: warning.roomNeeds,
          deliveryFormats: warning.deliveryFormats,
          intensity: warning.intensity,
        },
      }
    }
    const problems: string[] = []
    if (warning.missingRoomNeeds.length > 0) problems.push(`missing ${warning.missingRoomNeeds.join(', ')}`)
    if (warning.overCapacity) problems.push("over the room's capacity")
    return {
      id: `allocation-${i}`,
      category: 'Room may not fully fit',
      title: `${warning.className} — ${warning.instructorName}`,
      detail: `Booked into ${warning.roomTitle}, but ${problems.join('; ')}.`,
      eventId: warning.eventId,
    }
  })
}

/** Same idea as reviewIssuesFromAllocationWarnings, for buildRoster()'s own RosterWarning[]. */
function reviewIssuesFromRosterWarnings(warnings: RosterWarning[]): ReviewIssue[] {
  return warnings.map((warning, i) => {
    if (warning.type === 'unmatched-availability-class') {
      return {
        id: `roster-${i}`,
        category: 'Claimed but missing a class profile',
        title: `${warning.className} — ${warning.instructorName}`,
        detail:
          warning.reason === 'no-profile'
            ? 'No matching Class Profile submission was found for this class.'
            : "This class's Class Profile submission is missing a duration.",
      }
    }
    if (warning.type === 'auto-matched-by-email') {
      return {
        id: `roster-${i}`,
        category: 'Auto-matched by email (not explicitly claimed)',
        title: `${warning.className} — ${warning.instructorName}`,
        detail: `${warning.instructorName} never explicitly checked this class on their own Availability Form, but their email matched a real submission, so it was added to their schedule anyway — worth a quick glance, not something blocking anything.`,
        // No eventId/bookableClass — this is purely informational. The
        // class is already real and bookable (or already booked, or
        // already flagged separately if allocate() couldn't book it) —
        // there's nothing left here for a "View"/"Book" button to do.
      }
    }
    if (warning.type === 'unclaimed-class-profile') {
      const hasSuggestions = warning.possibleInstructors.length > 0
      return {
        id: `roster-${i}`,
        category: 'Needs an instructor',
        title: `${warning.className} — submitted by ${warning.instructorName}`,
        // Accurate to what actually happened: this email matched nobody on
        // the Availability Form at all (not "they forgot to check a box" —
        // that case auto-assigns and never reaches this warning, see
        // 'auto-matched-by-email'). If a real instructor's NAME matches
        // under a different email, say so — likely the same person, just a
        // typo'd/alternate email between the two separate forms.
        detail: hasSuggestions
          ? `No Availability Form submission matches ${warning.instructorName}'s email, but their name matches ${warning.possibleInstructors.length === 1 ? 'an existing instructor' : 'existing instructors'} submitted under a different email — likely the same person. Pick one below, or add a new instructor if it's actually someone else.`
          : `No Availability Form submission matches ${warning.instructorName}'s email at all — there's no known instructor to attach this to yet. Assign one below, or add a new instructor.`,
        // No instructorId/instructorName here: `warning.instructorName` is
        // just whoever submitted the Class Profile, not a confirmed
        // schedulable instructor (see buildRoster.ts's own doc comment on
        // this warning type) — the pending placeholder's own popup asks
        // the user to pick a real one first.
        bookableClass: {
          className: warning.className,
          classDomain: warning.classDomain,
          classDurationMinutes: warning.classDurationMinutes,
          roomNeeds: warning.roomNeeds,
          deliveryFormats: warning.deliveryFormats,
          intensity: warning.intensity,
          suggestedInstructors: warning.possibleInstructors,
        },
      }
    }
    return {
      id: `roster-${i}`,
      category: 'Blocked-out dates to confirm',
      title: warning.instructorName,
      detail: warning.blockedOutDates.join('; '),
    }
  })
}

/**
 * Runs allocate() over `instructors`/`rooms` and assembles the full
 * ScheduleStateData document from the result — shared by the module-level
 * initial load and by both CSV-import handlers below, so "generate a fresh
 * schedule from this roster" is one code path, not three.
 */
function buildDocumentFromRoster(
  instructors: Instructor[],
  rooms: Resource[],
  range: { start: Date; end: Date } = { start: scheduleStart, end: scheduleEnd },
): { doc: ScheduleStateData; warnings: AllocationWarning[] } {
  const domainNames = Array.from(new Set(instructors.flatMap((instructor) => instructor.classes.map((c) => c.classDomain))))
  const classTypes: ClassTypeOption[] = assignClassTypeColor([], domainNames)

  const instructorOptions: InstructorOption[] = instructors.map((instructor) => ({
    id: instructor.id,
    name: instructor.name,
    availability: instructor.availability,
    maxSessionsPerWeek: instructor.maxSessionsPerWeek,
    maxSessionsPerDay: instructor.maxSessionsPerDay,
    consecutiveComfort: instructor.consecutiveComfort,
    preferredGapMinutes: instructor.preferredGapMinutes,
    blockedOutDates: instructor.blockedOutDates,
    anythingElse: instructor.anythingElse,
  }))

  const { events, warnings } = allocate(instructors, rooms, range.start, range.end, DEFAULT_DAY_START_HOUR, DEFAULT_DAY_END_HOUR)

  // Kept around (unlike everything else local to this function) so a later
  // "Regenerate Week" can rebuild a single week from the SAME class
  // definitions this schedule was originally built from — see
  // regenerateWeek.ts's own doc comment.
  const classDefinitions = instructors.flatMap((instructor) => instructor.classes)

  return {
    doc: { events, resources: rooms, classTypes, instructors: instructorOptions, unplacedClasses: [], classDefinitions, resolvedIssueIds: [] },
    warnings,
  }
}

/** Shared by onUnscheduleEvent (removes the original) and onDuplicateEvent (leaves it in place) — both need the exact same UnplacedClass shape built from a placed event's own current fields. */
function unplacedClassFromEvent(event: SchedulerEvent): UnplacedClass {
  return {
    id: crypto.randomUUID(),
    title: event.title,
    type: event.type,
    durationMinutes: (event.end.getTime() - event.start.getTime()) / 60000,
    instructorId: event.instructorId,
    instructorName: event.instructorName,
    roomNeeds: event.roomNeeds,
    deliveryFormats: event.deliveryFormats,
    maxParticipation: event.maxParticipation,
    intensity: event.intensity,
    note: event.note,
  }
}

/** Same idea as reviewIssuesFromAllocationWarnings/reviewIssuesFromRosterWarnings, for mergeRosterIntoSchedule's own MergeWarning[] (see mergeRoster.ts). */
function reviewIssuesFromMergeWarnings(warnings: MergeWarning[]): ReviewIssue[] {
  return warnings.map((warning, i) => ({
    id: `merge-${i}`,
    category: 'Class details changed',
    title: `${warning.className} — ${warning.instructorName}`,
    detail: `The freshly-imported data disagrees with this already-booked class: ${warning.changes.join('; ')}. Not applied automatically — edit the event yourself if the new values are right.`,
    eventId: warning.eventId,
  }))
}

// Nothing about the two source CSVs is ever persisted (see
// scheduleStorage.ts) — only the SCHEDULE that comes out of a successful
// import (both Availability and Class Profile present together) gets
// saved, so this is the only thing a reload needs to check. Warnings are
// NOT persisted alongside it (same reasoning as the CSVs never persisting):
// a reload of a previously-generated schedule starts with an empty review
// list until the user re-imports and clicks Generate again, same as
// canGenerateRoster resetting to false on reload.
//
// No stored schedule -> a genuinely blank document, not a fabricated demo
// roster: zero instructors/events/classTypes until a real Availability +
// Class Profile import is generated. `resources` still starts as
// REAL_ROOMS — that's the real, fixed physical room inventory (see
// rooms.ts), not sample/demo data, and handleGenerateRoster below always
// rebuilds against REAL_ROOMS regardless of this initial value anyway.
const storedSchedule = loadStoredSchedule()
const { doc: INITIAL_DOCUMENT, warnings: INITIAL_ALLOCATION_WARNINGS }: { doc: ScheduleStateData; warnings: AllocationWarning[] } =
  storedSchedule
    ? { doc: storedSchedule, warnings: [] }
    : {
        doc: { events: [], resources: REAL_ROOMS, classTypes: [], instructors: [], unplacedClasses: [], classDefinitions: [], resolvedIssueIds: [] },
        warnings: [],
      }
const INITIAL_ROSTER_WARNINGS: RosterWarning[] = []

export default function SchedulerPage() {
  // events/resources/classTypes/instructors are one combined "document" so a
  // single Undo/Redo history covers every kind of edit uniformly, not just
  // event moves — see useHistoryState's own docs for why it's one object
  // instead of four separate undo stacks.
  const {
    state: doc,
    set: setDoc,
    setSilently: setDocSilently,
    undo,
    redo,
    reset: resetDoc,
    canUndo,
    canRedo,
  } = useHistoryState<ScheduleStateData>(INITIAL_DOCUMENT)
  const { events, resources, classTypes, instructors, unplacedClasses } = doc

  const schedulerRef = useRef<SchedulerHandle>(null)
  const availabilityFileInputRef = useRef<HTMLInputElement>(null)
  const classProfileFileInputRef = useRef<HTMLInputElement>(null)
  const saveFileInputRef = useRef<HTMLInputElement>(null)

  // The two source CSVs live ONLY in memory for the current session — never
  // persisted (see scheduleStorage.ts's own docs for why), and never
  // written back to disk on their own, either: selecting a file just
  // stages it here. Nothing happens to the visible schedule until
  // "Generate" is explicitly clicked (see handleGenerateRoster) — that's
  // the only action that reads these, builds a roster, and persists the
  // result. A reload always drops both back to null; regenerating after
  // that means re-importing both files again, by design.
  const [instructorCsvText, setInstructorCsvText] = useState<string | null>(null)
  const [classProfileCsvText, setClassProfileCsvText] = useState<string | null>(null)
  const canGenerateRoster = instructorCsvText !== null && classProfileCsvText !== null

  // Feed CreateFab's "Classes to review" modal (see reviewIssuesFromAllocationWarnings/
  // reviewIssuesFromRosterWarnings above) — allocationWarnings updates whenever a
  // schedule is (re)built; rosterWarnings only ever comes from a real Generate
  // (buildRoster never runs against sample data) — starts empty, replaced
  // entirely by the real thing the moment a real Generate happens.
  const [allocationWarnings, setAllocationWarnings] = useState<AllocationWarning[]>(INITIAL_ALLOCATION_WARNINGS)
  const [rosterWarnings, setRosterWarnings] = useState<RosterWarning[]>(INITIAL_ROSTER_WARNINGS)
  // Only ever appended to by handleMergeRoster (see mergeRoster.ts's own
  // MergeWarning) — a real Generate replaces rosterWarnings/allocationWarnings
  // wholesale (see handleGenerateRoster), but has nothing to say about
  // already-placed classes disagreeing with fresh data, so it never touches
  // this array.
  const [mergeWarnings, setMergeWarnings] = useState<MergeWarning[]>([])
  // Computed live (not just at Generate/merge time) so a hand move/resize,
  // or dropping an unplaced class, gets caught too — neither of those write
  // paths validates against the instructor's own declared availability on
  // its own, unlike the original allocate() pass. `id` is deterministic
  // (keyed off the event's own stable id, not an array index like the other
  // mappers above) so a "Resolve" stays attached to the right event even as
  // this list is recomputed every render. `severity: 'blocking'` is what
  // gives this the stronger red-ring treatment instead of the everyday dot
  // — see ReviewIssue's own doc comment.
  const instructorConflictIssues: ReviewIssue[] = useMemo(() => {
    const issues: ReviewIssue[] = []
    for (const event of events) {
      const instructor = instructors.find((i) => i.id === event.instructorId)
      if (!instructor) continue // no real instructor assigned yet — a different, already-handled kind of issue
      const conflict = findInstructorAvailabilityConflict(event, instructor, events)
      if (conflict) {
        // 'outside-availability' is a hard fact (they said they can't teach
        // then) — genuinely blocking. 'too-close-to-booking' is a
        // PREFERENCE (see findInstructorAvailabilityConflict's own doc
        // comment on requiredGapMinutes — it's 0, and this case can't even
        // trigger, for an instructor who said back-to-back is fine), so
        // it's advisory instead, worded as a preference rather than a
        // requirement, and names the OTHER class directly — two classes
        // close together for the same instructor can have completely
        // different names/rooms, which reads as "unrelated" without naming
        // the actual sibling booking.
        const category = conflict.reason === 'outside-availability' ? 'Instructor not available at this time' : "Instructor's preferred gap not met"
        const detail =
          conflict.reason === 'outside-availability'
            ? `${event.instructorName} isn't available at this time based on their stated weekly availability — move this class, or reassign it to someone else.`
            : conflict.requiredGapMinutes === 0
              ? `${event.instructorName} is double-booked with their other class, ${conflict.conflictingEvent.title} at ${formatTimeOfDay(conflict.conflictingEvent.start)}–${formatTimeOfDay(conflict.conflictingEvent.end)}.`
              : `${event.instructorName} prefers at least ${conflict.requiredGapMinutes} minutes between classes — this is too close to their other class, ${conflict.conflictingEvent.title} at ${formatTimeOfDay(conflict.conflictingEvent.start)}–${formatTimeOfDay(conflict.conflictingEvent.end)}.`
        issues.push({
          id: `instructor-conflict-${event.id}`,
          category,
          title: `${event.title} — ${event.instructorName}`,
          detail,
          eventId: event.id,
          severity: conflict.reason === 'outside-availability' ? 'blocking' : 'advisory',
        })
      }
    }
    return issues
  }, [events, instructors])
  // Same live-derived shape as instructorConflictIssues above, for the one
  // conflict that check doesn't cover: two events sharing the same room at
  // an overlapping time. Nothing normally produces this (addEvent's own
  // room-conflict check prevents it during a normal allocate()/regenerate
  // pass) — the one deliberate exception is regenerateWeek.ts's own
  // "force-place as a last resort" option, which explicitly bypasses every
  // conflict check, so this is what makes a force-placed room conflict
  // visible without regenerateWeek needing to produce its own bespoke
  // warning/issue type. Also catches an ordinary accidental double-booking
  // from manual dragging, for free.
  const roomConflictIssues: ReviewIssue[] = useMemo(() => {
    const issues: ReviewIssue[] = []
    for (const event of events) {
      const conflictingEvent = events.find(
        (other) => other.id !== event.id && other.resourceId === event.resourceId && event.start < other.end && event.end > other.start,
      )
      if (conflictingEvent) {
        const resource = resources.find((r) => r.id === event.resourceId)
        issues.push({
          id: `room-conflict-${event.id}`,
          category: 'Room double-booked',
          title: `${event.title} — ${resource?.title ?? event.resourceId}`,
          detail: `This room is already booked for ${conflictingEvent.title} at ${formatTimeOfDay(conflictingEvent.start)}–${formatTimeOfDay(conflictingEvent.end)} — move one of them.`,
          eventId: event.id,
          severity: 'blocking',
        })
      }
    }
    return issues
  }, [events, resources])
  const reviewIssues: ReviewIssue[] = [
    ...reviewIssuesFromRosterWarnings(rosterWarnings),
    ...reviewIssuesFromAllocationWarnings(allocationWarnings),
    ...roomConflictIssues,
    ...reviewIssuesFromMergeWarnings(mergeWarnings),
    ...instructorConflictIssues,
  ]
    .filter((issue) => !doc.resolvedIssueIds.includes(issue.id))
    // handleMergeRoster uses the undoable setDoc (unlike Generate/Load,
    // which both reset history — see its own comment) — rosterWarnings/
    // mergeWarnings still live outside that undo boundary (resolvedIssueIds
    // no longer does — see ScheduleStateData's own doc comment), so undoing
    // a merge can leave a stale issue pointing at an event that no longer
    // exists. This self-heals that without needing to fold those two into
    // the undo-tracked document too: any eventId-carrying issue (this new
    // category, or an existing room-fit-mismatch) whose event was undone
    // away just stops showing up.
    .filter((issue) => issue.eventId === undefined || events.some((e) => e.id === issue.eventId))
  // Routed through the same undoable setDoc as every other edit — resolving
  // an issue is a real, undoable action (Ctrl+Z brings it right back), not a
  // side effect exempt from the document's own history.
  const handleResolveReviewIssue = (issueId: string) =>
    setDoc((prev) => (prev.resolvedIssueIds.includes(issueId) ? prev : { ...prev, resolvedIssueIds: [...prev.resolvedIssueIds, issueId] }))

  async function handleAvailabilityFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const csvText = await file.text()
    try {
      parseDedupedInstructorRows(csvText) // validate only — Generate does the real parse
    } catch (error) {
      console.error('Failed to parse Instructor Availability CSV', error)
      alert('This file does not look like a valid Instructor Availability CSV export.')
      return
    }

    setInstructorCsvText(csvText)
  }

  async function handleClassProfileFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const csvText = await file.text()
    try {
      parseDedupedClassProfileRows(csvText) // validate only — Generate does the real parse
    } catch (error) {
      console.error('Failed to parse Class Profile CSV', error)
      alert('This file does not look like a valid Class Profile CSV export.')
      return
    }

    setClassProfileCsvText(csvText)
  }

  /**
   * "Generate" — GenerateModal's own 'fresh' mode already serves as the
   * confirmation step (its body explicitly warns this replaces the current
   * schedule before its own Generate button can be clicked), so this no
   * longer needs a separate window.confirm the way it used to.
   */
  function handleGenerateRoster(range: { start: Date; end: Date }) {
    if (!instructorCsvText || !classProfileCsvText) {
      alert('Import both the Instructor Availability CSV and the Class Profile CSV before generating.')
      return
    }

    const { instructors, warnings: newRosterWarnings } = buildRoster(
      parseDedupedInstructorRows(instructorCsvText),
      parseDedupedClassProfileRows(classProfileCsvText),
    )
    setRosterWarnings(newRosterWarnings)
    const { doc: newDoc, warnings: newAllocationWarnings } = buildDocumentFromRoster(instructors, REAL_ROOMS, range)
    setAllocationWarnings(newAllocationWarnings)
    // A freshly-generated schedule starts its own fresh history — undoing
    // "back into" the previous roster's schedule wouldn't make sense.
    resetDoc(newDoc)
    // Only NOW does anything touch localStorage — the built document, not
    // the source CSVs (see scheduleStorage.ts).
    saveStoredSchedule(newDoc)
  }

  /**
   * "Add new instructors/classes" — merges the imported files into the doc
   * that's CURRENTLY loaded (see mergeRosterIntoSchedule) instead of
   * replacing it (compare handleGenerateRoster above). No confirm dialog:
   * unlike Generate/Load, nothing here is being replaced, so there's
   * nothing destructive to warn about.
   */
  function handleMergeRoster() {
    if (!instructorCsvText || !classProfileCsvText) {
      alert('Import both the Instructor Availability CSV and the Class Profile CSV before adding.')
      return
    }

    const { instructors: newInstructors } = buildRoster(
      parseDedupedInstructorRows(instructorCsvText),
      parseDedupedClassProfileRows(classProfileCsvText),
    )
    const result = mergeRosterIntoSchedule(doc, newInstructors)
    setRosterWarnings((prev) => [...prev, ...result.rosterWarnings])
    setMergeWarnings((prev) => [...prev, ...result.mergeWarnings])
    // Undoable (unlike Generate/Load's resetDoc) — this is meant to be one
    // more edit in the current session, not a fresh start.
    setDoc(() => result.doc)
    saveStoredSchedule(result.doc)
  }

  /**
   * GenerateModal's own "Generate" submit — rebuilds one week from the
   * CURRENTLY loaded doc's own classDefinitions, no CSV staging required
   * (unlike handleGenerateRoster/handleMergeRoster above). Undoable, same
   * reasoning as handleMergeRoster: this is one more edit in the current
   * session, not a fresh start.
   */
  function handleRegenerateWeek(options: RegenerateWeekOptions) {
    const result = regenerateWeek(doc, options)
    setDoc(() => result.doc)
    saveStoredSchedule(result.doc)
  }

  /** GenerateModal's own "Clear all pins" — an immediate, separate action from the main Generate submit (see GenerateModal.tsx's own doc comment). */
  function handleClearAllPins() {
    setDoc((prev) => ({ ...prev, events: prev.events.map((e) => ({ ...e, pinned: false })) }))
  }

  /**
   * Fires on every navigation AND on mount (see useSchedulerNavigation's own
   * onDateChange). Also silently backfills any "forever" recurring series
   * that's due somewhere in the newly-visible range — without this, a
   * recurring series only ever gets new occurrences within whatever range
   * someone explicitly ran Generate/Regenerate over, so simply clicking
   * through to a week nobody's regenerated yet made it look like recurrence
   * randomly stopped working (see fillDueRecurringOccurrences's own doc
   * comment for how this was found). Uses setSilently, not setDoc — this
   * isn't an edit the user made, so it shouldn't cost them an Undo step.
   */
  function handleDateChange(range: DateRange) {
    setIsTodayInView(isTodayWithinRange(range))
    setDocSilently((prev) => fillDueRecurringOccurrences(prev, range.start, range.end))
  }

  async function handleSaveFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const state = parseScheduleState(await file.text())
      // Validate before asking — an invalid file should show the error below,
      // not a confirmation prompt for a load that was never going to happen.
      if (!window.confirm('Loading this file will replace your current schedule. Continue?')) return
      // A loaded file starts its own fresh history — undoing "back into" the
      // previously-open schedule wouldn't make sense.
      resetDoc(state)
    } catch (error) {
      console.error('Failed to load schedule save', error)
      alert('This file does not look like a valid schedule save.')
    }
  }

  // Mirrored from the scheduler via onViewChange/onTitleChange/onDrawerOpenChange
  // so the app-level Header (which owns the actual controls) can render them —
  // the scheduler's own toolbar is hidden via `hideToolbar` below.
  const [view, setView] = useState<SchedulerView>('week')
  const [title, setTitle] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Starts true: the scheduler opens anchored on today, so today is in view
  // until onDateChange says otherwise (it doesn't fire on mount).
  const [isTodayInView, setIsTodayInView] = useState(true)

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) to redo — skipped while
  // focused in a text input so the browser's native field-level undo (e.g.
  // while typing a new event's class name) isn't hijacked by this.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey
      if (!isMod) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  return (
    <>
      <input
        type="file"
        accept=".csv"
        ref={availabilityFileInputRef}
        onChange={handleAvailabilityFileSelected}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        accept=".csv"
        ref={classProfileFileInputRef}
        onChange={handleClassProfileFileSelected}
        style={{ display: 'none' }}
      />
      <input
        type="file"
        accept=".json"
        ref={saveFileInputRef}
        onChange={handleSaveFileSelected}
        style={{ display: 'none' }}
      />
      <Header
        drawerOpen={drawerOpen}
        onToggleDrawer={() => schedulerRef.current?.toggleDrawer()}
        title={title}
        isTodayInView={isTodayInView}
        onToday={() => schedulerRef.current?.gotoToday()}
        onPrev={() => schedulerRef.current?.gotoPrev()}
        onNext={() => schedulerRef.current?.gotoNext()}
        view={view}
        onViewChange={(v) => schedulerRef.current?.setView(v)}
        canUndo={canUndo}
        onUndo={undo}
        canRedo={canRedo}
        onRedo={redo}
      />
      <div className="app-layout">
        <div className="main-content">
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <Scheduler
              ref={schedulerRef}
              hideToolbar
              resources={resources}
              events={events}
              instructors={instructors}
              classTypes={classTypes}
              dayStartHour={DEFAULT_DAY_START_HOUR}
              dayEndHour={DEFAULT_DAY_END_HOUR}
              canUndo={canUndo}
              onUndo={undo}
              canRedo={canRedo}
              onRedo={redo}
              onEventMove={(event, newResourceId, newStart, newEnd) => {
                setDoc((prev) => ({
                  ...prev,
                  events: prev.events.map((e) => (e.id === event.id ? { ...e, resourceId: newResourceId, start: newStart, end: newEnd } : e)),
                }))
              }}
              onEventResizeEnd={(event, newStart, newEnd) => {
                setDoc((prev) => ({
                  ...prev,
                  events: prev.events.map((e) => (e.id === event.id ? { ...e, start: newStart, end: newEnd } : e)),
                }))
              }}
              onEventEdit={(event, updates) => {
                setDoc((prev) => ({
                  ...prev,
                  events: prev.events.map((e) => (e.id === event.id ? { ...e, ...updates } : e)),
                }))
              }}
              onEventDelete={(event) => {
                setDoc((prev) => ({ ...prev, events: prev.events.filter((e) => e.id !== event.id) }))
              }}
              onUnscheduleEvent={(event) => {
                setDoc((prev) => ({
                  ...prev,
                  events: prev.events.filter((e) => e.id !== event.id),
                  unplacedClasses: [...prev.unplacedClasses, unplacedClassFromEvent(event)],
                }))
              }}
              onDuplicateEvent={(event) => {
                // Same room/time as the original, deliberately — the existing
                // overlap-lane layout squishes them side by side automatically
                // (same mechanism a genuine double-booking already renders
                // with), and the copy is real enough to drag to its own spot
                // right away. Never carries the original's own `pinned` (a
                // duplicate isn't automatically protected just because its
                // source was) or `classRequestId` (it's not the same roster
                // occurrence — a future regenerate should treat it as its own
                // independent, manually-created event, not silently collide
                // with the original's own slot in that pass).
                const duplicate: SchedulerEvent = { ...event, id: crypto.randomUUID(), pinned: false, classRequestId: undefined }
                setDoc((prev) => ({ ...prev, events: [...prev.events, duplicate] }))
              }}
              onRecurrenceScopedEdit={(event, newRecurrence, scope: RecurrenceEditScope) => {
                setDoc((prev) => applyRecurrenceEdit(prev, event.id, newRecurrence, scope))
              }}
              onClassFieldScopedEdit={(event, updates, scope: ClassFieldEditScope) => {
                setDoc((prev) => ({
                  ...prev,
                  events: prev.events.map((e) => {
                    if (scope === 'this') return e.id === event.id ? { ...e, ...updates } : e
                    return e.classRequestId != null && e.classRequestId === event.classRequestId ? { ...e, ...updates } : e
                  }),
                }))
              }}
              onCreateEvent={(draft) => {
                setDoc((prev) => ({ ...prev, events: [...prev.events, { ...draft, id: crypto.randomUUID() }] }))
              }}
              onViewChange={setView}
              onTitleChange={setTitle}
              onDrawerOpenChange={setDrawerOpen}
              onDateChange={handleDateChange}
              onImport={() => availabilityFileInputRef.current?.click()}
              onImportClassProfiles={() => classProfileFileInputRef.current?.click()}
              onGenerateRoster={handleGenerateRoster}
              canGenerateRoster={canGenerateRoster}
              onMergeRoster={handleMergeRoster}
              onRegenerateWeek={handleRegenerateWeek}
              onClearAllPins={handleClearAllPins}
              onLoad={() => saveFileInputRef.current?.click()}
              onSave={() => void exportScheduleState(doc)}
              onExport={() => void exportScheduleToXlsx(events, resources)}
              onAddResource={(resource) => setDoc((prev) => ({ ...prev, resources: [...prev.resources, resource] }))}
              onEditResource={(resourceId, updates) =>
                setDoc((prev) => ({
                  ...prev,
                  resources: prev.resources.map((r) => (r.id === resourceId ? { ...r, ...updates } : r)),
                }))
              }
              onAddClassType={(classType) => setDoc((prev) => ({ ...prev, classTypes: [...prev.classTypes, classType] }))}
              onClassTypeColorChange={(name, color) =>
                setDoc((prev) => ({
                  ...prev,
                  classTypes: prev.classTypes.map((ct) => (ct.name === name ? { ...ct, color } : ct)),
                }))
              }
              onEditInstructor={(instructorId, updates) => {
                setDoc((prev) => ({
                  ...prev,
                  instructors: prev.instructors.map((i) => (i.id === instructorId ? { ...i, ...updates } : i)),
                  // instructorName on events is a denormalized copy — a rename needs to
                  // cascade to their existing events, or those would keep showing the old name.
                  events: updates.name
                    ? prev.events.map((e) => (e.instructorId === instructorId ? { ...e, instructorName: updates.name! } : e))
                    : prev.events,
                }))
              }}
              onAddInstructor={(instructor) => setDoc((prev) => ({ ...prev, instructors: [...prev.instructors, instructor] }))}
              reviewIssues={reviewIssues}
              onResolveReviewIssue={handleResolveReviewIssue}
              unplacedClasses={unplacedClasses}
              onPlaceUnplacedClass={(id, resourceId, start, end) => {
                const unplaced = doc.unplacedClasses.find((u) => u.id === id)
                if (!unplaced) return
                const newEvent = {
                  id: crypto.randomUUID(),
                  resourceId,
                  start,
                  end,
                  title: unplaced.title,
                  type: unplaced.type,
                  instructorId: unplaced.instructorId,
                  instructorName: unplaced.instructorName,
                  roomNeeds: unplaced.roomNeeds,
                  deliveryFormats: unplaced.deliveryFormats,
                  maxParticipation: unplaced.maxParticipation,
                  intensity: unplaced.intensity,
                  note: unplaced.note,
                }
                setDoc((prev) => ({
                  ...prev,
                  events: [...prev.events, newEvent],
                  unplacedClasses: prev.unplacedClasses.filter((u) => u.id !== id),
                }))
              }}
              onDismissUnplacedClass={(id) =>
                setDoc((prev) => ({ ...prev, unplacedClasses: prev.unplacedClasses.filter((u) => u.id !== id) }))
              }
              onEditUnplacedClass={(id, updates) =>
                setDoc((prev) => ({
                  ...prev,
                  unplacedClasses: prev.unplacedClasses.map((u) => (u.id === id ? { ...u, ...updates } : u)),
                }))
              }
              // Mirrors onDuplicateEvent's own convention (new id, otherwise a
              // plain copy) — there's no room/time or pinned/classRequestId
              // state to reset here the way a placed event's own duplicate
              // needs to, since an unplaced class never has any of that yet.
              onDuplicateUnplacedClass={(item) => {
                const duplicate: UnplacedClass = { ...item, id: crypto.randomUUID() }
                setDoc((prev) => ({ ...prev, unplacedClasses: [...prev.unplacedClasses, duplicate] }))
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}
