import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react';

export type SchedulerView = 'day' | 'week' | 'month';

/** Default business-hours window for Day/Week views — also what the allocator uses to generate events, so scheduling never hardcodes its own separate copy of these hours. */
export const DEFAULT_DAY_START_HOUR = 8;
export const DEFAULT_DAY_END_HOUR = 20;

/** Placeholder `instructorId` for a booking with no real instructor assigned — either not yet chosen (a still-pending, unfinished booking), or deliberately left that way (PendingBookingActions' own "No instructor" option, which lets a class awaiting a review resolution get booked anyway rather than staying stuck). Never a real instructor id (those are always positive, 1-based), so `instructors.find(i => i.id === UNASSIGNED_INSTRUCTOR_ID)` reliably finds nothing — exactly right for the "not yet chosen" case, and exactly what lets a real, persisted event with this id keep rendering as "Instructor needed" indefinitely for the deliberate case. Shared here (not local to Scheduler.tsx, where it originated) so PendingBookingActions.tsx can reference the same sentinel without a circular import. */
export const UNASSIGNED_INSTRUCTOR_ID = -1;

export type ResizeEdge = 'start' | 'end';

export interface Resource {
  id: string;
  title: string;
  /** Room/space features this resource has (e.g. "Pool", "Mirrors", "Virtual (e.g. Zoom)") — matched against a Class's own roomNeeds by the allocator's room-matching logic. Undefined/empty means a general-purpose room with no special features. */
  roomNeeds?: string[];
  /** Max people this room can hold — compared against a Class's own maxParticipation by the allocator. Undefined means no known limit. */
  maxCapacity?: number;
}

export interface SchedulerEvent {
  id: string;
  resourceId: string;
  instructorId: number;
  /** The roster Class this event was generated from, if any — manually-created events (see onCreateEvent) have none. */
  classRequestId?: number;
  title: string;
  start: Date;
  end: Date;
  /** Explicit color; only used as a fallback when no "color by" filter resolves one. */
  color?: string;
  /** Free-form category used by the "color by type" filter, e.g. "consult", "therapy". */
  type?: string;
  instructorName: string;
  /** Room/space features this class needs (e.g. "Pool", "Mirrors") — shown as "Class needs" in the event popover, and feeds the move-target availability overlay's own yellow/green distinction (see utils/availabilityOverlay.ts's roomSuitsNeeds). From the originating Class's own roomNeeds; undefined for a manually-created event with no roster Class behind it. */
  roomNeeds?: string[];
  /** Which format(s) this class can run in this term, e.g. "In-Person", "Virtual", "Hybrid (In-Person + Virtual simultaneously)" — shown as "Delivery" in the event popover. */
  deliveryFormats?: string[];
  /** The reported class capacity, from the originating Class Profile submission's own `maxParticipation` — shown as "Capacity" in the event popover. Undefined for a manually-created event with no roster Class behind it, or when the submission left it blank. */
  maxParticipation?: number;
  /** The intended intensity for this class (e.g. "Low-Moderate", "Moderate-High"), from the originating Class Profile submission's own `intensity` — shown as "Intensity" in the event popover. Undefined for a manually-created event with no roster Class behind it, or when the submission left it blank. */
  intensity?: string;
  /** True only for the single in-progress placement CreateFab's "Classes to review" modal's "Book" button starts (see Scheduler.tsx's `pendingBooking`) — never true for anything in the host app's own controlled `events` array. Draggable/resizable like any other event, but rendered with a distinct dashed style and its own Book/Cancel mini-popup instead of the normal event popover, until confirmed (or cancelled). */
  pending?: boolean;
  /** Free-form staff note about this specific class, e.g. a scheduling caveat or a reminder for whoever covers it — written/edited via the event popover's own header pencil (opens ClassEditModal). Undefined means no note was ever added; an empty string is treated the same way. Survives an Unschedule/re-place round trip (see onUnscheduleEvent/onPlaceUnplacedClass) since UnplacedClass carries the same field. */
  note?: string;
  /** True once the user has pinned this event's room/time in place, via the event popover's own pin toggle — shown as a small gold pushpin in the corner (see EventBlock's own `.pinDot`). Doesn't affect manual drag/resize at all (a pinned event is still fully editable by hand); it's a signal to a future regenerate step to hold this event's placement constant while it reshuffles everything else. Undefined/false means not pinned. Meaningless on an UnplacedClass — pinning only makes sense once something HAS a room/time to hold constant. */
  pinned?: boolean;
  /** Set via the event popover's own "Repeat" field — marks this event as one occurrence of a recurring series. `seriesId` is generated once, the first time recurrence is turned on for an event, and copied onto every occurrence that series ever produces (see regenerateWeek.ts), so a future regenerate can recognize "these are all the same recurring booking" without guessing from title/instructor/time matching, which would break the moment one occurrence gets renamed. During a regenerate, EVERY occurrence of a series is treated exactly like a pinned event (held in place, never moved) — this is a deliberate behavioral overlap with `pinned` above, not a separate mechanism, but the two fields stay independent: turning recurrence off doesn't un-pin an event that was also explicitly pinned, and vice versa. A week that's "due" for an occurrence (per `pattern`, counted from the earliest occurrence in the series — the "anchor") but doesn't have one yet gets one created fresh, copying the anchor's own room/time-of-day/instructor/title/room-needs/delivery/capacity/note/color — see regenerateWeek.ts for the exact mechanics. Meaningless on an UnplacedClass, same reasoning as `pinned`. */
  recurrence?: {
    pattern: 'weekly' | 'biweekly' | 'monthly';
    seriesId: string;
    /** Set via the popover's own "Ends" field, right below "Repeat" — undefined means "never" (the default). `'on-date'` stops creating new occurrences once the next one's own date would fall after `date` (the anchor and every occurrence already created before that date still stand). `'after-occurrences'` stops once the series has produced `count` occurrences in total (the anchor counts as the first) — evaluated against how many already exist at regenerate time, so it self-corrects if occurrences were manually added/removed by hand. */
    end?: { type: 'on-date'; date: Date } | { type: 'after-occurrences'; count: number };
  };
}

/** Everything needed to create a new event, minus the `id` — the app assigns that when it commits the event to its own state. */
export type NewEventDraft = Omit<SchedulerEvent, 'id'>;

/** A drag-select on empty timeline space, awaiting the "new event" drawer's Create/Cancel — kept around (not just a transient drag state) so the selected region can stay highlighted while that drawer is open. */
export interface PendingSelection {
  resourceId: string;
  start: Date;
  end: Date;
}

/** One issue surfaced in CreateFab's "Classes to Review" modal — the host app maps whatever warning types its own scheduling/import pipeline produces (e.g. an unscheduled class, a room that doesn't fully fit a class's needs) into this one generic shape, so this component stays decoupled from that data layer (see SchedulerPage.tsx). */
export interface ReviewIssue {
  id: string;
  /** Groups related issues under one heading in the modal, e.g. "Couldn't be scheduled". */
  category: string;
  /** e.g. the instructor + class name. */
  title: string;
  /** The specific reason/detail shown under the title. */
  detail: string;
  /** The actual booked event this issue is about, if any — e.g. a room-fit mismatch has one (the class WAS booked, just imperfectly); an unscheduled class doesn't (nothing was ever booked). Lets the modal offer a "View" button that jumps straight to it. */
  eventId?: string;
  /** How urgently this needs attention — 'blocking' (e.g. the instructor genuinely isn't available at this time, or is double-booked) gets a more prominent visual treatment on the calendar than the default 'advisory' (e.g. a room doesn't quite fit) — see EventBlock's own `flagged`/`blocking` props. Every issue category that existed before this field did (room-fit-mismatch, roster warnings) is 'advisory' by omission. */
  severity?: 'blocking' | 'advisory';
  /** Present only for issues where the class was never booked anywhere at all (e.g. "couldn't be scheduled", "needs an instructor") — lets the modal offer a "Book" button that manually places it on the calendar as a pending, draggable placeholder (see Scheduler.tsx's handleBookIssue) for the user to position and confirm themselves. `instructorId`/`instructorName` are omitted when there's no verified schedulable instructor for this class at all (e.g. a Class Profile nobody ever claimed on their Availability Form) — the pending placeholder's own popup then asks the user to pick a real one (from `instructors`) before it can be booked. */
  bookableClass?: {
    instructorId?: number;
    instructorName?: string;
    className: string;
    classDomain?: string;
    classDurationMinutes: number;
    roomNeeds?: string[];
    deliveryFormats?: string[];
    intensity?: string;
    /** Real instructors (from `instructors`, by id) who might be the same person under a different email — only meaningful alongside a missing `instructorId` above. Carries each candidate's own already-claimed class names too (not email — `Instructor`, the final model, never carries that; see buildRoster.ts's own `possibleInstructors` doc comment), since two different real instructors can share a name with nothing else to tell them apart — both the review modal's own quick-assign and the pending placeholder's instructor picker surface these ahead of the full list. */
    suggestedInstructors?: { id: number; name: string; classes: string[] }[];
  };
}

/** A Month-view drag-to-a-different-day that landed on a conflict (room or instructor already booked) — held while MonthMoveConflictModal is open, awaiting Confirm/Cancel. `newStart`/`newEnd` are the *original* tentative placement (same room/time-of-day as before, only the date changed); the modal's own local state tracks any further repositioning within it. */
export interface PendingMonthMove {
  event: SchedulerEvent;
  newStart: Date;
  newEnd: Date;
}

/**
 * A class with no room/time yet — either newly imported (a roster merge
 * added it, see SchedulerPage.tsx's mergeRosterIntoSchedule) or sent back
 * from a placed event via the event popover's "Unschedule" button — shown
 * in the "Unplaced Classes" drawer for the user to drag onto the calendar
 * themselves. Deliberately never auto-allocated: the allocator has no
 * awareness of an already hand-edited schedule, so placement here is always
 * a manual, one-at-a-time drag-and-drop decision.
 */
export interface UnplacedClass {
  /** Client-generated (crypto.randomUUID()) — unrelated to any roster/class id, which aren't stable across re-imports anyway (see buildRoster.ts's own doc comment on Instructor.id/Class.id). */
  id: string;
  title: string;
  /** Class domain, e.g. "Fitness & Aquatics" — shown as the chip's color dot. */
  type?: string;
  durationMinutes: number;
  instructorId: number;
  instructorName: string;
  roomNeeds?: string[];
  deliveryFormats?: string[];
  maxParticipation?: number;
  intensity?: string;
  /** Same free-form note as SchedulerEvent's own `note` — see there for the full doc comment. Carried across an Unschedule/re-place round trip. */
  note?: string;
}

/** What to do with a class that still can't be placed after GenerateModal's regenerate runs its normal search — see RegenerateWeekOptions. */
export type OverflowPolicy = 'force-place' | 'archive-to-bin';

/** What to do with an event that has no roster class definition behind it at all (created by hand, not by any import) during a regenerate — see RegenerateWeekOptions. */
export type ManualEventPolicy = 'preserve' | 'reposition' | 'delete';

/**
 * Which occurrences of a recurring series a change to its Repeat/Ends
 * settings (including turning recurrence off) applies to — asked via the
 * event popover's own inline prompt whenever the event being edited already
 * has earlier occurrences in its series (editing the series' own anchor
 * needs no such choice, since both scopes come out the same there).
 * Deliberately re-declared here rather than imported from
 * src/lib/allocator/regenerateWeek.ts's own identical type, same reasoning
 * as ManualEventPolicy/OverflowPolicy above.
 */
export type RecurrenceEditScope = 'all' | 'this-and-following';

/**
 * Which events a Domain/Room-needs/Capacity change applies to — asked via
 * the event popover's own inline prompt whenever the edited event shares a
 * `classRequestId` with at least one other event already on the calendar
 * (editing a manually-created event, or the only placed occurrence of a
 * class, needs no such choice — there's nothing else to apply it to).
 * 'this' touches only the one event being edited; 'all' touches every event
 * sharing that same `classRequestId`, anywhere in the document (not just the
 * currently-visible week) — a hand correction to a class's own room-needs/
 * capacity/domain, same as the equivalent recurring-event/regenerate
 * mechanics elsewhere in this app.
 */
export type ClassFieldEditScope = 'this' | 'all';

/**
 * The options GenerateModal collects and hands to `onRegenerateWeek` —
 * deliberately re-declared here (the same shape as
 * src/lib/allocator/regenerateWeek.ts's own `RegenerateWeekOptions`, not
 * imported from it) to keep this component package decoupled from that
 * app-specific data/business layer, same reasoning as ReviewIssue/
 * UnplacedClass's own loosened fields elsewhere in this file.
 */
export interface RegenerateWeekOptions {
  rangeStart: Date;
  rangeEnd: Date;
  overflowPolicy: OverflowPolicy;
  manualEventPolicy: ManualEventPolicy;
  includeBinItems: boolean;
}

/** Drawer filter: derive each event's color from its resource ("room") or its `type`. */
export type EventColorMode = 'resource' | 'type';

export type SchedulerDayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';

/** A weekly recurring window an instructor is available, e.g. Monday 9am-5pm. */
export interface InstructorAvailabilityBlock {
  day: SchedulerDayOfWeek;
  /** Minutes since midnight, e.g. 9:15am -> 555. */
  startMinutes: number;
  endMinutes: number;
}

/** A selectable instructor for the event popover's "Instructor" field, and for the move-target availability overlay. */
export interface InstructorOption {
  id: number;
  name: string;
  availability: InstructorAvailabilityBlock[];
  /** Max class sessions this instructor can teach in a week — null/undefined means no stated cap (a fixed-choice "Unsure/Flexible" answer, or left blank). */
  maxSessionsPerWeek?: number | null;
  /** Max class sessions this instructor can teach in one day — null/undefined means no stated cap. */
  maxSessionsPerDay?: number | null;
  /** Their stated preference for scheduling multiple same-day classes, verbatim survey choice text (or '' if left blank) — a plain `string` here (not the roster data layer's own fixed-choice union) to keep this component decoupled from that layer, same reasoning as ReviewIssue's own fields. */
  consecutiveComfort?: string;
  /** Preferred gap, in minutes, between same-day classes — null/undefined means no stated preference (not "no gap needed"). */
  preferredGapMinutes?: number | null;
  /** Stated blockout dates, verbatim free text, never parsed/interpreted. */
  blockedOutDates?: string[];
  /** Free text from "anything else you'd like to share" — verbatim, never parsed/interpreted. */
  anythingElse?: string;
}

/** A named class type and its display color — managed in the drawer's "Class Types" section. */
export interface ClassTypeOption {
  name: string;
  color: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface EventRenderContext {
  selected: boolean;
  hovered: boolean;
  dragging: boolean;
  /** True when this event shares a `classRequestId` with whichever event's popover is currently open — see EventBlock.tsx's own `sameClassType` prop doc comment. */
  sameClassType: boolean;
}

export interface SchedulerProps {
  /** Resources rendered as timeline rows (Day/Week) — passed in by the consumer. */
  resources: Resource[];
  /** Controlled event list — the component never mutates this array itself. */
  events: SchedulerEvent[];
  /** Selectable instructors for the event popover's "Instructor" field. */
  instructors: InstructorOption[];
  /** Selectable class types (and their colors) for the "color by type" filter and the event popover's "Class type" field. */
  classTypes: ClassTypeOption[];

  initialView?: SchedulerView;
  initialDate?: Date;

  /** Minimum interval (minutes) that drag/resize snaps to. Default 15. */
  snapMinutes?: number;
  /** Width, in minutes, of one timeline column. Default 30. */
  slotMinutes?: number;
  /** First displayed hour in Day/Week timeline. Default DEFAULT_DAY_START_HOUR (8). */
  dayStartHour?: number;
  /** Last displayed hour (exclusive) in Day/Week timeline. Default DEFAULT_DAY_END_HOUR (20). */
  dayEndHour?: number;
  /** 0 = Sunday, 1 = Monday. Default 0. */
  weekStartsOn?: 0 | 1;
  /** Layout of the Week view: rooms as rows / continuous time as columns, or days as column-groups (each split into room sub-columns) with time flowing top-to-bottom. Default 'horizontal'. */
  weekOrientation?: 'horizontal' | 'vertical';

  /** Distance in px from the scroll edge that triggers auto-scroll while dragging. Default 48. */
  autoScrollThreshold?: number;
  /** Max px nudged per animation frame at the edge. Default 16. */
  autoScrollSpeed?: number;

  /** Custom event rendering; falls back to the built-in card when omitted. */
  renderEvent?: (event: SchedulerEvent, ctx: EventRenderContext) => ReactNode;

  /**
   * Suppresses the built-in top toolbar (today/prev/next/title, Day-Week-Month
   * switcher) — for embedding those controls in a host app's own header
   * instead. Drive the scheduler via the imperative ref
   * (`gotoToday`/`gotoPrev`/`gotoNext`/`setView`) and mirror its state via
   * `onTitleChange`/`onViewChange`. The drawer and its toggle still render;
   * pass `toggleDrawer`/`onDrawerOpenChange` if that also needs to move.
   * Default false.
   */
  hideToolbar?: boolean;

  /** Whether the host app's undo history has anything to undo/redo — surfaced only for the Month-view "View day" modal's own Undo/Redo buttons, which mirror the host's global undo/redo rather than owning any history themselves. Omit either pair to hide those buttons. */
  canUndo?: boolean;
  onUndo?: () => void;
  canRedo?: boolean;
  onRedo?: () => void;

  onEventMove?: (event: SchedulerEvent, newResourceId: string, newStart: Date, newEnd: Date) => void;
  onEventResizeStart?: (event: SchedulerEvent, edge: ResizeEdge) => void;
  onEventResize?: (event: SchedulerEvent, newStart: Date, newEnd: Date, edge: ResizeEdge) => void;
  onEventResizeEnd?: (event: SchedulerEvent, newStart: Date, newEnd: Date, edge: ResizeEdge) => void;
  onEventClick?: (event: SchedulerEvent, e: ReactMouseEvent) => void;
  onEventDoubleClick?: (event: SchedulerEvent, e: ReactMouseEvent) => void;
  /** Fired when the event popover edits an event's title, type, or instructor directly (not a drag/resize). */
  onEventEdit?: (
    event: SchedulerEvent,
    updates: Partial<
      Pick<
        SchedulerEvent,
        | 'title'
        | 'type'
        | 'instructorId'
        | 'instructorName'
        | 'note'
        | 'pinned'
        | 'recurrence'
        | 'roomNeeds'
        | 'maxParticipation'
        | 'deliveryFormats'
        | 'intensity'
      >
    >,
  ) => void;
  /** Fired when the event popover's Delete button is used. */
  onEventDelete?: (event: SchedulerEvent) => void;
  /** Fired when the event popover's Unschedule button is used — unlike Delete, this doesn't destroy the class: the host app is expected to turn it into an UnplacedClass and add it to `unplacedClasses` so it reappears in the "Unplaced Classes" drawer, reversible by dragging it back in. */
  onUnscheduleEvent?: (event: SchedulerEvent) => void;
  /** Fired when the event popover's Duplicate button is used — the original event is left exactly where it is; the host app is expected to add a NEW event with the same details in the SAME room/time slot (the existing overlap-lane layout squishes the two side by side, same as any other double-booking), for the user to drag to its own spot. */
  onDuplicateEvent?: (event: SchedulerEvent) => void;
  /** Fired instead of onEventEdit when a Repeat/Ends change (including turning recurrence off) is made to an event that already has earlier occurrences in its series — after the popover's own inline "All classes in this series" / "This and following classes" prompt. `newRecurrence` is the value the field was just changed to (undefined when stopping recurrence); the host app is expected to apply it across the series per `scope` — see applyRecurrenceEdit in src/lib/allocator/regenerateWeek.ts for the real implementation. When omitted, the popover falls back to a plain onEventEdit call with no scope choice offered (matches today's behavior). */
  onRecurrenceScopedEdit?: (event: SchedulerEvent, newRecurrence: SchedulerEvent['recurrence'], scope: RecurrenceEditScope) => void;
  /** Fired instead of onEventEdit when a Domain/Room-needs/Capacity change is made to an event that shares a classRequestId with at least one other placed event — after the popover's own inline "Just this class" / "All classes of this type" prompt. The host app is expected to apply `updates` to every event matching `event.classRequestId` when `scope` is 'all', or just `event` itself when 'this'. When omitted, the popover falls back to a plain onEventEdit call with no scope choice offered. */
  onClassFieldScopedEdit?: (
    event: SchedulerEvent,
    updates: Partial<Pick<SchedulerEvent, 'type' | 'roomNeeds' | 'maxParticipation' | 'deliveryFormats' | 'intensity'>>,
    scope: ClassFieldEditScope,
  ) => void;
  onDateClick?: (date: Date, resourceId?: string) => void;
  /** Still fires as before; a drag-select on empty timeline space also opens the internal "new event" drawer (see onCreateEvent). */
  onSelection?: (resourceId: string, start: Date, end: Date) => void;
  /** Fired when the "new event" drawer's Create button is used, after a timeline drag-select. The app assigns the final `id`. */
  onCreateEvent?: (draft: NewEventDraft) => void;
  onViewChange?: (view: SchedulerView) => void;
  onDateChange?: (range: DateRange) => void;
  /** Fires with the current formatted title (e.g. "July 13 – 19, 2026") on mount and on every change — for mirroring into an external header when `hideToolbar` is set. */
  onTitleChange?: (title: string) => void;
  /** Fires whenever the drawer opens/closes — for mirroring a hamburger toggle's active state into an external header. */
  onDrawerOpenChange?: (open: boolean) => void;

  /** Drawer "Schedule" actions — no backend wiring here, just notify the caller. */
  onImport?: () => void;
  /** Second, independent roster import — the app's two source surveys (instructor availability, class profile) are exported by the org separately and can arrive at different times, so this is its own action rather than a step of `onImport`. */
  onImportClassProfiles?: () => void;
  /** Explicit "build a schedule from whatever's been imported" action — deliberately separate from onImport/onImportClassProfiles (which only stage a file) so nothing regenerates the schedule as a side effect of selecting a file. Fired from GenerateModal's own 'fresh' mode with the user's own chosen date range (`end` exclusive), not a hardcoded window. */
  onGenerateRoster?: (range: { start: Date; end: Date }) => void;
  /** Whether onGenerateRoster has enough imported to do anything — both the Availability and Class Profile CSVs need to be staged first. */
  canGenerateRoster?: boolean;
  /** "Add new instructors/classes" — merges the imported files into the CURRENT schedule instead of replacing it (see onGenerateRoster), so newly-added classes land in the "Unplaced Classes" drawer for manual placement rather than a full regeneration. Gated by the same canGenerateRoster (both files still need to be staged). */
  onMergeRoster?: () => void;
  onLoad?: () => void;
  onSave?: () => void;
  onExport?: () => void;

  /** Fired when GenerateModal's own "Generate" button is submitted — rebuilds `options.weekStart`'s week from the current roster's own class definitions, holding every pinned event in that week in place. Works on whatever's already loaded, no CSV staging required (unlike onGenerateRoster/onMergeRoster) — see the real implementation in src/lib/allocator/regenerateWeek.ts, kept out of this package to stay decoupled from that app-specific data layer. */
  onRegenerateWeek?: (options: RegenerateWeekOptions) => void;
  /** Fired when GenerateModal's own "Clear all pins" button is used — an immediate, separate action from the main Generate submit (see its own doc comment in GenerateModal.tsx), so a full reshuffle can be forced before choosing the rest of the options. */
  onClearAllPins?: () => void;

  /** Fired when a new room is added via the drawer's "Rooms" section, or the "Add room" modal (see Scheduler.tsx's own roomModal state). */
  onAddResource?: (resource: Resource) => void;
  /** Fired when the same "Add room" modal, opened instead in edit mode (via the pencil icon shown on hovering an existing room, either view), saves changes to name/roomNeeds/maxCapacity. Mirrors onEditInstructor's own shape below. */
  onEditResource?: (resourceId: string, updates: Partial<Pick<Resource, 'title' | 'roomNeeds' | 'maxCapacity'>>) => void;
  /** Fired when a new class type is added via the drawer's "Class Types" section. */
  onAddClassType?: (classType: ClassTypeOption) => void;
  /** Fired when a class type's color swatch changes in the drawer's "Class Types" section. */
  onClassTypeColorChange?: (name: string, color: string) => void;
  /** Fired when the instructor view/edit dialog saves a change to any field. */
  onEditInstructor?: (instructorId: number, updates: Partial<Omit<InstructorOption, 'id'>>) => void;
  /** Fired when CreateFab's "Add instructor" opens the same dialog in "add" mode and its form is submitted — the dialog assigns the new instructor's id itself (next after the highest existing one), same as onAddResource computing its own new room id. */
  onAddInstructor?: (instructor: InstructorOption) => void;

  /** Issues to list in CreateFab's "Classes to Review" modal — see ReviewIssue. Flags the FAB itself (red) whenever non-empty. */
  reviewIssues?: ReviewIssue[];
  /** Fired when a review issue's "Resolve" button is used (from either the review modal or an event's own popover) — the host app decides what "resolved" means (e.g. just hiding it from the list; see SchedulerPage.tsx). */
  onResolveReviewIssue?: (issueId: string) => void;

  /** Classes with no room/time yet — see UnplacedClass. Listed in CreateFab's "Unplaced Classes" drawer as draggable chips; flags the FAB (non-error badge) whenever non-empty. */
  unplacedClasses?: UnplacedClass[];
  /** Fired when an unplaced class's chip is dropped onto a valid room/time cell — the host app is expected to create the real event and remove the id from `unplacedClasses` in one update. */
  onPlaceUnplacedClass?: (id: string, resourceId: string, start: Date, end: Date) => void;
  /** Fired when an unplaced class's own dismiss ("×") is used — the host app decides what that means (e.g. just removing it from the list). */
  onDismissUnplacedClass?: (id: string) => void;
  /** Fired when the unplaced-class details popover (opened by clicking, not dragging, a chip in the drawer) edits any of its own fields before it's placed — the same field set EventPopover's own edit modal offers for a placed event, minus Title's own recurrence-scoped counterparts (Repeat/Ends), which don't mean anything before there's a date to recur on. */
  onEditUnplacedClass?: (
    id: string,
    updates: Partial<Pick<UnplacedClass, 'title' | 'instructorId' | 'instructorName' | 'type' | 'roomNeeds' | 'maxParticipation' | 'deliveryFormats' | 'intensity' | 'note'>>,
  ) => void;
  /** Fired from the unplaced-class details popover's own header Duplicate button — the host app is expected to add a copy (new id) alongside this one in `unplacedClasses`, mirroring onDuplicateEvent's own convention for a placed event. */
  onDuplicateUnplacedClass?: (item: UnplacedClass) => void;
}

/** Imperative handle obtained via a forwarded ref, e.g. `schedulerRef.current.gotoToday()`. */
export interface SchedulerHandle {
  gotoToday: () => void;
  gotoDate: (date: Date) => void;
  gotoPrev: () => void;
  gotoNext: () => void;
  setView: (view: SchedulerView) => void;
  toggleDrawer: () => void;
  /** `time` is "HH:mm", e.g. "13:00". Only meaningful in Day/Week view with horizontal orientation. */
  scrollToTime: (time: string) => void;
  /** Only meaningful in Day/Week view with horizontal orientation. */
  scrollToResource: (resourceId: string) => void;
  getVisibleRange: () => DateRange;
}

/** Preview of a tentative move/resize applied while the pointer is still down. */
export interface EventPreview {
  eventId: string;
  resourceId: string;
  start: Date;
  end: Date;
}
