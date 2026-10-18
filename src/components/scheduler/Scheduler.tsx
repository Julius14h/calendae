import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Toolbar } from './Toolbar';
import { SchedulerDrawer } from './SchedulerDrawer';
import { EventPopover } from './EventPopover';
import { NewEventDrawer } from './NewEventDrawer';
import { InstructorViewDialog } from './InstructorViewDialog';
import type { InstructorDialogState } from './InstructorViewDialog';
import { MonthMoveConflictModal } from './MonthMoveConflictModal';
import { MonthDayPreviewModal } from './MonthDayPreviewModal';
import { TimelineView, ROW_HEIGHT, RESOURCE_COLUMN_WIDTH, MIN_SLOT_WIDTH_PX } from './TimelineView';
import { MonthView } from './MonthView';
import { WeekViewVertical, PX_PER_MINUTE as WEEK_VERTICAL_PX_PER_MINUTE } from './WeekViewVertical';
import { CreateFab } from './CreateFab';
import { ClassesToReviewModal } from './ClassesToReviewModal';
import { UnplacedClassesDrawer } from './UnplacedClassesDrawer';
import { UnplacedClassPopover } from './UnplacedClassPopover';
import { FlyingChip } from './FlyingChip';
import { PendingBookingActions } from './PendingBookingActions';
import { PendingBookingChip } from './PendingBookingChip';
import { RoomModal } from './RoomModal';
import type { RoomModalState } from './RoomModal';
import { GenerateModal } from './GenerateModal';
import { useSchedulerNavigation } from './hooks/useSchedulerNavigation';
import { useElementWidth } from './hooks/useElementWidth';
import { createTimelineGeometry, dateToX, xToDate } from './utils/timeGeometry';
import { eachDayOfRange, formatToolbarTitle, parseTimeString, startOfWeek } from './utils/dateMath';
import { computeEventColors } from './utils/eventColor';
import { findDropCellAt } from './utils/dropTarget';
import { DEFAULT_DAY_END_HOUR, DEFAULT_DAY_START_HOUR, UNASSIGNED_INSTRUCTOR_ID } from './Scheduler.types';
import type {
  ClassFieldEditScope,
  EventColorMode,
  PendingMonthMove,
  PendingSelection,
  RecurrenceEditScope,
  Resource,
  ReviewIssue,
  SchedulerEvent,
  SchedulerHandle,
  SchedulerProps,
  UnplacedClass,
} from './Scheduler.types';
import styles from './Scheduler.module.css';

// The one and only manually-placed "Book" pending event that can exist at a
// time (see `pendingBooking` below) — a fixed sentinel id rather than a
// generated one since it never touches the host app's own `events` array
// (and therefore never needs to coexist with a real event of the same id).
const PENDING_EVENT_ID = '__pending-booking__';
// Same idea as PENDING_EVENT_ID, for whichever UnplacedClass (if any) is
// currently being dragged out of UnplacedClassesDrawer — lets that drag
// drive the same instructor-availability overlay `detailsEvent`/
// `highlightEvent` already provides for the review modal's own pending
// chip, via a phantom SchedulerEvent (see `unplacedDragPhantom` below)
// instead of a second, parallel overlay mechanism.
const UNPLACED_DRAG_EVENT_ID = '__unplaced-drag__';
// Same idea, for whichever UnplacedClass's own details popover (opened by
// clicking, not dragging, a chip — see unplacedDetailsPhantom) is currently
// open — an independent sentinel/phantom rather than reusing
// UNPLACED_DRAG_EVENT_ID's own state, see unplacedDetailsPhantom's doc
// comment for why the two can't share one mechanism.
const UNPLACED_DETAILS_EVENT_ID = '__unplaced-details__';
// The stand-in event for a Classes Bin class being placed via Month view's
// placement modal (see `pendingMonthPlacement`) — never joins `events`.
const UNPLACED_MONTH_PLACEMENT_EVENT_ID = '__unplaced-month-placement__';
// Stable shared identity for "no same-class-type events to highlight right
// now" — see sameClassEventIds below.
const EMPTY_EVENT_ID_SET: ReadonlySet<string> = new Set();
/** The review modal's "Book" flow's in-progress placement (see `pendingBooking`) — instructorId/instructorName are only absent for a class with no verified schedulable instructor yet (see ReviewIssue's own `bookableClass`), until the user picks one via PendingBookingActions' own instructor select (which now also offers an explicit "No instructor" option — see UNASSIGNED_INSTRUCTOR_ID's own doc comment in Scheduler.types.ts). */
interface PendingBooking {
  resourceId: string;
  title: string;
  type?: string;
  start: Date;
  end: Date;
  instructorId?: number;
  instructorName?: string;
  roomNeeds?: string[];
  deliveryFormats?: string[];
  intensity?: string;
  /** Real instructors (with their own already-claimed classes, since name alone can't tell two same-named ones apart, and email isn't something this app carries past buildRoster.ts) that might be this same person under a different email — see ReviewIssue.bookableClass's own doc comment. Only meaningful while instructorId is still unset. */
  suggestedInstructors?: { id: number; name: string; classes: string[] }[];
  /** False until the user has actually dragged the floating "staging chip" (see PendingBookingChip.tsx/handlePendingChipDrop) onto a real room/time cell — resourceId/start/end above are still a placeholder guess until then, not rendered anywhere on the grid (see `displayEvents`). Always true for a booking made while Month view is active (see handleBookIssue): Month's own day-cell drag model doesn't have the "offscreen guessed position" problem this chip exists to solve, so it keeps the original guess-then-drag-normally behavior. */
  placed: boolean;
  /** The review issue this came from — resolved only once actually committed (see commitPendingBooking), not the moment Book/Assign is clicked. Cancelling (or abandoning it by starting a new Book elsewhere) never resolves it at all, so it simply stays in the review list, exactly as if nothing had been clicked. */
  issueId: string;
}

/**
 * Original resource-timeline scheduler: Day/Week views render resources as
 * rows with time running horizontally; Month view is a Google-Calendar-style
 * grid. Fully controlled — `events` is owned by the caller; drag/resize only
 * report tentative results via callbacks and never mutate the array.
 */
export const Scheduler = forwardRef<SchedulerHandle, SchedulerProps>(function Scheduler(
  {
    resources,
    events,
    instructors,
    classTypes,
    initialView,
    initialDate,
    snapMinutes: snapMinutesProp = 5,
    slotMinutes: slotMinutesProp = 30,
    dayStartHour: dayStartHourProp = DEFAULT_DAY_START_HOUR,
    dayEndHour: dayEndHourProp = DEFAULT_DAY_END_HOUR,
    weekStartsOn: weekStartsOnProp = 0,
    weekOrientation: weekOrientationProp = 'vertical',
    autoScrollThreshold = 48,
    autoScrollSpeed = 16,
    hideToolbar = false,
    canUndo,
    onUndo,
    canRedo,
    onRedo,
    renderEvent,
    onEventMove,
    onEventResizeStart,
    onEventResize,
    onEventResizeEnd,
    onEventClick,
    onEventDoubleClick,
    onEventEdit,
    onEventDelete,
    onDateClick,
    onSelection,
    onCreateEvent,
    onViewChange,
    onDateChange,
    onTitleChange,
    onDrawerOpenChange,
    onImport,
    onImportClassProfiles,
    onGenerateRoster,
    canGenerateRoster,
    onMergeRoster,
    onRegenerateWeek,
    onClearAllPins,
    onLoad,
    onSave,
    onExport,
    onAddResource,
    onEditResource,
    onAddClassType,
    onClassTypeColorChange,
    onEditInstructor,
    onAddInstructor,
    onUnscheduleEvent,
    onDuplicateEvent,
    onRecurrenceScopedEdit,
    onClassFieldScopedEdit,
    reviewIssues,
    onResolveReviewIssue,
    unplacedClasses,
    onPlaceUnplacedClass,
    onDismissUnplacedClass,
    onEditUnplacedClass,
    onDuplicateUnplacedClass,
  },
  ref,
) {
  // These are exposed as adjustable settings in the drawer, so the props are
  // just their *initial* values — mirrors the initialView/initialDate pattern.
  const [snapMinutes, setSnapMinutes] = useState(snapMinutesProp);
  const [slotMinutes, setSlotMinutes] = useState(slotMinutesProp);
  const [dayStartHour, setDayStartHour] = useState(dayStartHourProp);
  const [dayEndHour, setDayEndHour] = useState(dayEndHourProp);
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(weekStartsOnProp);
  const [weekOrientation, setWeekOrientation] = useState<'horizontal' | 'vertical'>(weekOrientationProp);

  const { view, anchorDate, range, setView, gotoToday, gotoDate, gotoPrev, gotoNext } = useSchedulerNavigation({
    initialView,
    initialDate,
    weekStartsOn,
    onViewChange,
    onDateChange,
  });

  // Always on — there used to be a lock/edit toggle button in the host
  // app's header; the schedule is just always editable now.
  const editable = true;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleDrawer = useCallback(() => setDrawerOpen((current) => !current), []);
  const [colorMode, setColorMode] = useState<EventColorMode>('type');
  // Which class types / instructors to hide from the rendered grid — internal
  // display-only state (like colorMode above), never affecting availability or
  // conflict checks, which always need the true, complete `events` array.
  const [hiddenClassTypes, setHiddenClassTypes] = useState<Set<string>>(new Set());
  const [hiddenInstructorIds, setHiddenInstructorIds] = useState<Set<number>>(new Set());
  // Rooms manually expanded (via TimelineView's per-row toggle) to a taller
  // row so overlapping events each get a full-height lane instead of being
  // squished — also purely a display concern, same as the two above.
  const [expandedResourceIds, setExpandedResourceIds] = useState<Set<string>>(new Set());
  const toggleResourceExpanded = useCallback((id: string) => {
    setExpandedResourceIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleClassTypeVisibility = useCallback((name: string) => {
    setHiddenClassTypes((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  const toggleInstructorVisibility = useCallback((id: number) => {
    setHiddenInstructorIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // Toggles between "everything hidden" and "everything visible" — when
  // nothing's hidden, hides every current class type/instructor; otherwise
  // (some or all hidden) clears back to fully visible.
  const toggleAllClassTypesVisible = useCallback(() => {
    setHiddenClassTypes((current) => (current.size === 0 ? new Set(classTypes.map((c) => c.name)) : new Set()));
  }, [classTypes]);
  const toggleAllInstructorsVisible = useCallback(() => {
    setHiddenInstructorIds((current) => (current.size === 0 ? new Set(instructors.map((i) => i.id)) : new Set()));
  }, [instructors]);
  const eventColors = useMemo(
    () => computeEventColors(events, resources, colorMode, classTypes),
    [events, resources, colorMode, classTypes],
  );
  // Every real, booked event with an open "Classes to review" issue (see
  // ReviewIssue's own `eventId` doc comment — only issues about an ALREADY
  // booked event carry one; "needs an instructor"/"couldn't be scheduled"
  // issues have nothing on the grid yet to flag), split by `severity` — see
  // ReviewIssue's own doc comment. `reviewIssues` itself already excludes
  // anything the user's resolved (see SchedulerPage.tsx's own filter), so
  // this needs no separate resolved-check here. Passed down to all three
  // calendar surfaces so EventBlock (Day/Week) and MonthView's own event
  // bars can show the right treatment — see EventBlockProps' own `flagged`
  // (a small dot, advisory) / `blocking` (a red glow ring, blocking) doc
  // comments for why these are two different treatments, not one.
  const flaggedEventIds = useMemo(
    () =>
      new Set(
        reviewIssues?.filter((issue) => issue.eventId && issue.severity !== 'blocking').map((issue) => issue.eventId as string) ?? [],
      ),
    [reviewIssues],
  );
  const blockingEventIds = useMemo(
    () =>
      new Set(
        reviewIssues?.filter((issue) => issue.eventId && issue.severity === 'blocking').map((issue) => issue.eventId as string) ?? [],
      ),
    [reviewIssues],
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // `view` combined with `weekOrientation` doubles as the reset key:
  // MonthView/WeekViewVertical/TimelineView below are keyed accordingly, so
  // every Day/Week/Month switch AND every vertical<->horizontal Week toggle
  // each unmount and remount the scroll container (a *different* DOM node),
  // and the width-tracking effect needs to re-attach its observer at that
  // point — see useElementWidth's docs for why a plain ref alone can't
  // signal that. `view` alone used to be the only key here, which missed
  // the vertical<->horizontal swap entirely (it doesn't touch `view`,
  // WeekViewVertical also doesn't even share this ref in the first place —
  // see its own doc comment — so switching *to* horizontal is the specific
  // case that needs this): the observer kept watching whatever (detached,
  // width-0) node it had last attached to, silently freezing containerWidth
  // at 0 for the entire session after that switch.
  const containerWidth = useElementWidth(scrollContainerRef, `${view}-${weekOrientation}`);

  const days = useMemo(
    () => (view === 'month' ? [] : eachDayOfRange(range.start, range.end)),
    [view, range.start, range.end],
  );

  const geometry = useMemo(() => {
    const geometryDays = days.length > 0 ? days : [range.start];
    const slotsPerDay = ((dayEndHour - dayStartHour) * 60) / slotMinutes;
    const totalSlots = geometryDays.length * slotsPerDay;
    // Fill the available width when the columns fit; below that, fall back to
    // the minimum slot width and let the container scroll horizontally instead
    // of squeezing columns unreadably thin (e.g. a full week at fine granularity).
    const availableWidth = Math.max(0, containerWidth - RESOURCE_COLUMN_WIDTH);
    // Round to a whole pixel: header columns are real flex boxes (the browser
    // snaps them to device pixels), while row gridlines are a CSS background
    // pattern tiled at the exact value passed in — a fractional width lets
    // those two rendering paths round independently and drift apart.
    const slotWidthPx = Math.max(MIN_SLOT_WIDTH_PX, Math.floor(availableWidth / totalSlots));
    return createTimelineGeometry({
      days: geometryDays,
      slotMinutes,
      snapMinutes,
      slotWidthPx,
      dayStartHour,
      dayEndHour,
    });
  }, [days, range.start, slotMinutes, snapMinutes, dayStartHour, dayEndHour, containerWidth]);

  // A single-placeholder-day geometry mirroring WeekViewVertical's own
  // internal `timeGeometry` (time-of-day → pixel only, real day resolved
  // separately) — needed here, not just there, so handlePendingChipDrop
  // (further below) can convert a raw drop Y position back into a
  // time-of-day without WeekViewVertical needing to lift its own geometry
  // object up just for this one use.
  const verticalTimeGeometry = useMemo(
    () =>
      createTimelineGeometry({
        days: [range.start],
        slotMinutes,
        snapMinutes,
        slotWidthPx: slotMinutes * WEEK_VERTICAL_PX_PER_MINUTE,
        dayStartHour,
        dayEndHour,
      }),
    [range.start, slotMinutes, snapMinutes, dayStartHour, dayEndHour],
  );

  // Looked up by id (not stored as a snapshot) so the popover/availability
  // overlay reflect the event's *current* fields live — a move/resize/edit
  // that updates `events` is picked up on the very next render with no
  // extra plumbing.
  const [detailsEventId, setDetailsEventId] = useState<string | null>(null);
  // The review modal's "Book" flow's in-progress placement (see
  // `pendingBooking`/`handleBookIssue` further below) — declared up here,
  // ahead of `detailsEvent`, purely so `displayEvents` (the merged view
  // `detailsEvent`/every calendar surface actually renders) can exist before
  // it's needed. Lives entirely in this component (never touches the host
  // app's own controlled `events`) until it's confirmed.
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null);
  // The one merged view of "what actually renders on the calendar" — every
  // real, host-owned event, plus the in-progress pending placement (if any)
  // tacked on at the end. Passed to the three primary calendar surfaces
  // (Month/Week-vertical/Timeline) in place of the raw `events` prop;
  // deliberately NOT passed to MonthDayPreviewModal/MonthMoveConflictModal/
  // InstructorViewDialog further down, which are secondary, read-mostly
  // surfaces this feature doesn't extend to. Explicit field list (not a
  // spread) so an absent instructorId/instructorName resolves to the
  // "unassigned" placeholder rather than ending up literally `undefined` on
  // a SchedulerEvent, which every other piece of this component assumes is
  // always a real id/name.
  // Split out from `displayEvents` below specifically so `detailsEvent` can
  // still resolve to it (and drive the instructor-availability overlay —
  // see `detailsEvent`'s own comment) even before it's `placed` — while the
  // floating PendingBookingChip is still showing, not yet a real grid
  // position at all. Whether an instructor is already known (e.g. the
  // review modal's own "Assign" quick-pick, not just the plain "Book" flow)
  // decides whether that overlay actually shows anything: `instructorId`
  // falls back to UNASSIGNED_INSTRUCTOR_ID otherwise, which matches no real
  // instructor, so `availabilityBands` (WeekViewVertical/TimelineView's own)
  // naturally computes nothing for it — no separate "only when known" guard
  // needed here.
  const pendingPhantom = useMemo<SchedulerEvent | null>(() => {
    if (!pendingBooking) return null;
    return {
      id: PENDING_EVENT_ID,
      pending: true,
      resourceId: pendingBooking.resourceId,
      title: pendingBooking.title,
      type: pendingBooking.type,
      start: pendingBooking.start,
      end: pendingBooking.end,
      instructorId: pendingBooking.instructorId ?? UNASSIGNED_INSTRUCTOR_ID,
      instructorName: pendingBooking.instructorName ?? 'Instructor needed',
      roomNeeds: pendingBooking.roomNeeds,
      deliveryFormats: pendingBooking.deliveryFormats,
      intensity: pendingBooking.intensity,
    };
  }, [pendingBooking]);
  // Whichever UnplacedClass (if any) is currently being dragged out of
  // UnplacedClassesDrawer — reported via onDragStateChange, itself wired to
  // a stable (useCallback) handler below so the drawer's own per-row effect
  // only fires on a genuine start/stop, not every unrelated re-render.
  const [draggingUnplacedItem, setDraggingUnplacedItem] = useState<UnplacedClass | null>(null);
  // Same phantom-event trick as pendingPhantom, purely to drive the
  // instructor-availability overlay while dragging — never rendered on the
  // grid itself (never added to displayEvents, unlike pendingPhantom once
  // placed), just resolved via `detailsEvent` below through the
  // UNPLACED_DRAG_EVENT_ID sentinel. start/end are arbitrary (today, plus
  // the class's own duration) — computeAvailabilityBands only reads this
  // phantom's `id` (to exclude it from "this instructor's other bookings")
  // and `roomNeeds` (carried straight through from the unplaced class
  // itself, so the overlay's yellow/green distinction — whether a room
  // actually suits those needs — works correctly while dragging too, not
  // just for a real placed/pending event).
  const unplacedDragPhantom = useMemo<SchedulerEvent | null>(() => {
    if (!draggingUnplacedItem) return null;
    const start = new Date();
    const end = new Date(start.getTime() + draggingUnplacedItem.durationMinutes * 60000);
    return {
      id: UNPLACED_DRAG_EVENT_ID,
      resourceId: '',
      title: draggingUnplacedItem.title,
      type: draggingUnplacedItem.type,
      start,
      end,
      instructorId: draggingUnplacedItem.instructorId,
      instructorName: draggingUnplacedItem.instructorName,
      roomNeeds: draggingUnplacedItem.roomNeeds,
      deliveryFormats: draggingUnplacedItem.deliveryFormats,
      intensity: draggingUnplacedItem.intensity,
    };
  }, [draggingUnplacedItem]);
  const displayEvents = useMemo<SchedulerEvent[]>(() => {
    // Not rendered on the grid at all until it's actually `placed` — see
    // PendingBooking's own doc comment. The floating PendingBookingChip
    // (rendered separately, further below) stands in for it until then.
    if (!pendingPhantom || !pendingBooking?.placed) return events;
    return [...events, pendingPhantom];
  }, [events, pendingPhantom, pendingBooking?.placed]);
  // Looked up from `displayEvents` for every OTHER event, but the pending
  // placeholder specifically resolves straight from `pendingPhantom` —
  // that's what lets the instructor-availability overlay (`highlightEvent`
  // below) show for it the moment an instructor's known, not only once it's
  // actually `placed` on the grid (see `pendingPhantom`'s own comment).
  // Same reasoning for `unplacedDragPhantom` — it never joins
  // `displayEvents` at all (it's never a real placeable event, just a
  // stand-in purely for the overlay), so it has to be checked first here
  // too, ahead of the displayEvents lookup.
  const detailsEvent = useMemo(() => {
    if (detailsEventId === PENDING_EVENT_ID) return pendingPhantom;
    if (detailsEventId === UNPLACED_DRAG_EVENT_ID) return unplacedDragPhantom;
    return displayEvents.find((event) => event.id === detailsEventId) ?? null;
  }, [displayEvents, detailsEventId, pendingPhantom, unplacedDragPhantom]);
  // Every OTHER placed event sharing the open popover's own classRequestId —
  // "classes of this type" in the exact same sense as onClassFieldScopedEdit's
  // own 'all' scope (see EventPopover.tsx), so a viewer can see at a glance
  // which events a "apply to all classes of this type" edit would reach.
  // `detailsEvent` is never itself included (the open event already shows
  // its own `.selected` treatment instead) and never populated for the
  // pending/unplaced-drag/unplaced-details phantoms (none of them carry a
  // real classRequestId). A shared empty-Set constant when there's nothing
  // to highlight avoids handing EventBlock's memo comparator a fresh Set
  // identity on every render for the (usual) case of no popover being open.
  const sameClassEventIds = useMemo(() => {
    if (detailsEvent?.classRequestId == null) return EMPTY_EVENT_ID_SET;
    const ids = new Set<string>();
    for (const e of events) {
      if (e.id !== detailsEvent.id && e.classRequestId === detailsEvent.classRequestId) ids.add(e.id);
    }
    return ids;
  }, [events, detailsEvent]);
  // Where the event popover anchors itself — the clicked event block's own
  // bounding rect (see handleEventClick). Kept separate from
  // `detailsEventId` itself, since that also gets set from a drag/resize
  // start (see handleEventInteractionStart) purely to drive the
  // availability overlay, which has no click position to anchor a popover
  // to and shouldn't pop one up mid-drag anyway.
  const [eventPopoverAnchorRect, setEventPopoverAnchorRect] = useState<DOMRect | null>(null);
  const closeEventPopover = useCallback(() => {
    setDetailsEventId(null);
    setEventPopoverAnchorRect(null);
  }, []);
  // Reported by UnplacedClassesDrawer's own per-row effect on every genuine
  // start/stop of a drag (see its own doc comment) — starting one takes
  // over from any currently-open real event popover (same "a new dominant
  // interaction wins" reasoning as a new pendingBooking auto-committing the
  // old one in handleBookIssue below), closing it outright rather than
  // leaving it open with `detailsEvent` silently resolving to the wrong
  // thing underneath it.
  const handleUnplacedDragStateChange = useCallback(
    (item: UnplacedClass | null) => {
      setDraggingUnplacedItem(item);
      if (item) {
        closeEventPopover();
        setDetailsEventId(UNPLACED_DRAG_EVENT_ID);
      } else {
        setDetailsEventId((current) => (current === UNPLACED_DRAG_EVENT_ID ? null : current));
      }
    },
    [closeEventPopover],
  );
  const handleEventClick = useCallback<NonNullable<SchedulerProps['onEventClick']>>(
    (event, e) => {
      // The pending "Book" placeholder (see `pendingBooking`) has its own
      // dedicated Book/Cancel popup, always showing while it exists — a
      // plain click on it shouldn't also open the normal event popover
      // underneath/instead.
      if (event.id === PENDING_EVENT_ID) return;
      // Clicking the event whose popover is already open closes it instead
      // of just re-opening the same thing — a toggle, matching how
      // double-clicking used to behave for the old details drawer.
      if (detailsEventId === event.id) {
        setDetailsEventId(null);
        setEventPopoverAnchorRect(null);
      } else {
        setDetailsEventId(event.id);
        setEventPopoverAnchorRect(e.currentTarget.getBoundingClientRect());
      }
      setPendingSelection(null); // the popover and new-event drawers are mutually exclusive
      onEventClick?.(event, e);
    },
    [detailsEventId, onEventClick],
  );
  const handleEventEdit = useCallback(
    (updates: Parameters<NonNullable<SchedulerProps['onEventEdit']>>[1]) => {
      if (detailsEvent) onEventEdit?.(detailsEvent, updates);
    },
    [detailsEvent, onEventEdit],
  );
  const handleRecurrenceScopedEdit = useCallback(
    (newRecurrence: SchedulerEvent['recurrence'], scope: RecurrenceEditScope) => {
      if (detailsEvent) onRecurrenceScopedEdit?.(detailsEvent, newRecurrence, scope);
    },
    [detailsEvent, onRecurrenceScopedEdit],
  );
  const handleClassFieldScopedEdit = useCallback(
    (updates: Partial<Pick<SchedulerEvent, 'type' | 'roomNeeds' | 'maxParticipation' | 'deliveryFormats' | 'intensity'>>, scope: ClassFieldEditScope) => {
      if (detailsEvent) onClassFieldScopedEdit?.(detailsEvent, updates, scope);
    },
    [detailsEvent, onClassFieldScopedEdit],
  );
  const handleEventDelete = useCallback(() => {
    if (detailsEvent) onEventDelete?.(detailsEvent);
    closeEventPopover();
  }, [detailsEvent, onEventDelete, closeEventPopover]);
  // Purely decorative "the chip flew into the FAB" animation (see
  // FlyingChip.tsx) — never gates the real state change below, which fires
  // immediately regardless. `pendingFlightCount` is what makes the FAB's
  // own badge feel like it's actually counting these arrivals rather than
  // just mirroring `unplacedClasses.length`: it's subtracted from the real
  // count (see the CreateFab render below) the instant a flight starts
  // (canceling out that same instant's +1 to the real count, so the badge
  // doesn't visibly change yet) and only removed once the flight's
  // animation actually finishes, which is the moment the badge visibly
  // ticks up.
  const [flyingChips, setFlyingChips] = useState<
    { id: string; fromRect: { top: number; left: number; width: number; height: number }; title: string; color: string }[]
  >([]);
  const [pendingFlightCount, setPendingFlightCount] = useState(0);
  const handleEventUnschedule = useCallback(() => {
    if (detailsEvent && eventPopoverAnchorRect) {
      const rect = eventPopoverAnchorRect;
      setFlyingChips((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          fromRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          title: detailsEvent.title,
          color: eventColors.get(detailsEvent.id) ?? 'var(--sched-accent)',
        },
      ]);
      setPendingFlightCount((current) => current + 1);
    }
    if (detailsEvent) onUnscheduleEvent?.(detailsEvent);
    closeEventPopover();
  }, [detailsEvent, eventPopoverAnchorRect, eventColors, onUnscheduleEvent, closeEventPopover]);
  // Unlike Unschedule above, the copy lands in the SAME room/time as the
  // original (the existing overlap-lane layout squishes them side by side
  // automatically), so there's no "flies over to the bin" visual here —
  // closes the popover so the newly-squished copy is immediately reachable
  // to drag to its own spot.
  const handleEventDuplicate = useCallback(() => {
    if (detailsEvent) onDuplicateEvent?.(detailsEvent);
    closeEventPopover();
  }, [detailsEvent, onDuplicateEvent, closeEventPopover]);
  const handleFlightFinish = useCallback((id: string) => {
    setFlyingChips((current) => current.filter((chip) => chip.id !== id));
    setPendingFlightCount((current) => Math.max(0, current - 1));
  }, []);

  // Starting to actually move or resize an event (not just clicking it)
  // still drives its availability overlay (`detailsEventId`/`detailsEvent`),
  // so it's visible for the whole drag, not just after the fact — but any
  // open popover closes outright: clearing just the anchor rect (rather
  // than leaving it) means the popover can't keep floating, unmoving, over
  // wherever the event now visually is mid-drag.
  const handleEventInteractionStart = useCallback((event: SchedulerEvent) => {
    setDetailsEventId(event.id);
    setEventPopoverAnchorRect(null);
    setPendingSelection(null);
    // Hides the pending event's own Book/Cancel popup for the duration of
    // the drag/resize — its anchor rect only reflects the block's REST
    // position, and re-showing it mid-drag (still pointing at the old spot)
    // would visually detach from the block as it moves under the pointer.
    // The effect below recomputes and re-shows it once the drag/resize
    // actually commits (pendingBooking's own resourceId/start/end change).
    if (event.id === PENDING_EVENT_ID) setPendingActionsAnchorRect(null);
  }, []);

  // A drag/resize that never gets followed by a real popover-opening click
  // (i.e. `eventPopoverAnchorRect` stays null the whole time) leaves nothing
  // listening for a click elsewhere: EventPopover's own outside-click
  // listener only attaches while it's genuinely open (anchorRect non-null),
  // and views like WeekViewVertical have no background click handling of
  // their own at all. Without this, the move-target availability overlay
  // this id drives (`highlightEvent`/`selectedEventId`) would stay lit
  // indefinitely after finishing a move and clicking away. Mirrors
  // EventPopover's own guard: don't close for a click that's actually
  // starting a new interaction on the same event, or on the month-move
  // dialog.
  useEffect(() => {
    // The pending booking (see `pendingBooking`) owns its own overlay
    // lifecycle entirely — it should show for the WHOLE time it's
    // unresolved regardless of intervening clicks elsewhere (e.g. clicking
    // away while it still has no instructor assigned, which deliberately
    // leaves it pending rather than closing anything — see the outside-click
    // effect below), and stops showing on its own once resolved (`detailsEvent`
    // then simply stops resolving to anything, since displayEvents drops the
    // phantom). A generic "click away" here would otherwise race with that.
    if (detailsEventId === null || detailsEventId === PENDING_EVENT_ID || eventPopoverAnchorRect !== null) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const targetEvent = target.closest('[data-scheduler-event]');
      if (targetEvent?.getAttribute('data-scheduler-event') === detailsEventId) return;
      if (target.closest('[data-month-move-dialog]')) return;
      setDetailsEventId(null);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [detailsEventId, eventPopoverAnchorRect]);

  // A drag-select on empty timeline space (see ResourceRow/ TimelineView)
  // opens this instead of immediately creating anything — the app only ever
  // learns about a new event once the drawer's Create button is used.
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const handleSelection = useCallback<NonNullable<SchedulerProps['onSelection']>>(
    (resourceId, selStart, selEnd) => {
      setPendingSelection({ resourceId, start: selStart, end: selEnd });
      closeEventPopover(); // mutually exclusive with the event popover
      onSelection?.(resourceId, selStart, selEnd);
    },
    [onSelection, closeEventPopover],
  );
  const handleCreateEvent = useCallback(
    (draft: Parameters<NonNullable<SchedulerProps['onCreateEvent']>>[0]) => {
      onCreateEvent?.(draft);
      setPendingSelection(null);
    },
    [onCreateEvent],
  );

  // CreateFab's "Add class" — the drawer itself only lets the user fill in
  // name/domain/instructor, not room/time (see NewEventDrawer), so this
  // picks a fixed, predictable starting slot — the first room, at the
  // current view's business-hours opening time on whichever day is
  // currently anchored — as an immediately-usable default. From here, a
  // background drag on either calendar view redraws it (see
  // WeekViewVertical/ResourceRow's own onSelection, gated on
  // pendingSelection being non-null further down this file) — plain drags
  // pan everywhere else, but switch to select-a-new-range for exactly as
  // long as this drawer stays open, since there's nothing else a
  // background drag would mean while it's showing.
  const handleAddClassFab = useCallback(() => {
    const resource = resources[0];
    if (!resource) return;
    closeEventPopover();
    const start = new Date(anchorDate);
    start.setHours(dayStartHour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    setPendingSelection({ resourceId: resource.id, start, end });
  }, [resources, anchorDate, dayStartHour, closeEventPopover]);

  // CreateFab's "Add room" / the pencil icon shown on hovering an existing
  // room (WeekViewVertical/TimelineView, both view orientations) — one
  // shared modal (see RoomModal.tsx) for both adding a brand new room and
  // editing an existing one's name/features/capacity.
  const [roomModalState, setRoomModalState] = useState<RoomModalState | null>(null);
  const handleAddRoomFab = useCallback(() => {
    setRoomModalState({ mode: 'add' });
  }, []);
  const handleEditRoom = useCallback((resource: Resource) => {
    setRoomModalState({ mode: 'edit', resource });
  }, []);

  // SchedulerDrawer's "Generate" (mode 'fresh') and "Regenerate" (mode
  // 'regenerate') both open the same GenerateModal.tsx, just with different
  // sections shown. Default date range always starts from the Monday of
  // whichever week is currently in view, regardless of the toolbar's own
  // weekStartsOn display preference — the allocator's own week model (see
  // allocate.ts's getWeekStart) is fixed Monday-Sunday.
  const [generateModalMode, setGenerateModalMode] = useState<'fresh' | 'regenerate' | null>(null);
  const generateDefaultStart = useMemo(() => startOfWeek(anchorDate, 1), [anchorDate]);

  // CreateFab's "Classes to review" — see ClassesToReviewModal.tsx.
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const handleOpenReview = useCallback(() => {
    closeEventPopover();
    setReviewModalOpen(true);
  }, [closeEventPopover]);

  // The review modal's own "Book" button (for classes that couldn't be
  // scheduled at all) — manually places the class on the calendar as a
  // draggable, dashed "pending" placeholder (SchedulerEvent's own `pending`
  // flag) for the user to reposition, with its own small Book/Cancel popup
  // instead of the normal event popover. `pendingBooking`/`displayEvents`
  // themselves are declared up near `detailsEventId` — see that comment.
  // Lives entirely here (never touches the host app's own controlled
  // `events`) until it's actually confirmed — commitPendingBooking is the
  // only thing that ever calls onCreateEvent for it.
  const [pendingActionsAnchorRect, setPendingActionsAnchorRect] = useState<DOMRect | null>(null);

  // Reads `pendingBooking` from the closure rather than a setState updater
  // function — calling onCreateEvent (which itself calls the host app's own
  // setDoc) from inside an updater is exactly the "setState while rendering
  // a different component" pattern React warns about, since updaters can
  // run during render, not just at commit time. Only actually books it when
  // a real instructor has been assigned (see `pendingBooking`'s own doc
  // comment) — otherwise there's nothing valid to create, so this just
  // drops it. PendingBookingActions' own "Book" button is disabled until
  // then, so the only way to reach this branch is the "starting a new Book
  // abandons an unfinished previous one" path in handleBookIssue below.
  const commitPendingBooking = useCallback(() => {
    // `placed` too, not just instructorId/instructorName — resourceId/start/
    // end are still just a placeholder guess until the user's actually
    // dragged the floating staging chip onto a real cell (see
    // PendingBooking's own doc comment); committing before that would book
    // it somewhere nobody ever saw or chose.
    if (pendingBooking && pendingBooking.placed && pendingBooking.instructorId != null && pendingBooking.instructorName != null) {
      onCreateEvent?.({
        resourceId: pendingBooking.resourceId,
        instructorId: pendingBooking.instructorId,
        instructorName: pendingBooking.instructorName,
        title: pendingBooking.title,
        type: pendingBooking.type,
        start: pendingBooking.start,
        end: pendingBooking.end,
        roomNeeds: pendingBooking.roomNeeds,
        deliveryFormats: pendingBooking.deliveryFormats,
        intensity: pendingBooking.intensity,
      });
      // Only resolved HERE, once something's actually been booked — not the
      // moment Book/Assign was first clicked (see handleBookIssue and
      // PendingBooking's own `issueId` doc comment). Cancelling, or simply
      // never finishing (starting a different Book elsewhere abandons this
      // one via this same function), never reaches this line at all, so the
      // issue is left exactly as it was — still in the review list.
      onResolveReviewIssue?.(pendingBooking.issueId);
    }
    setPendingBooking(null);
  }, [pendingBooking, onCreateEvent, onResolveReviewIssue]);

  const cancelPendingBooking = useCallback(() => {
    setPendingBooking(null);
  }, []);

  const handleBookIssue = useCallback(
    (bookable: NonNullable<ReviewIssue['bookableClass']>, issueId: string, preselectedInstructor?: { id: number; name: string }) => {
      const resource = resources[0];
      if (!resource) return;
      commitPendingBooking(); // any still-pending placement books at its current spot first
      setReviewModalOpen(false);
      closeEventPopover();
      setPendingSelection(null);
      // Deliberately NOT resolved here — only commitPendingBooking resolves
      // it, once something's actually been booked (see its own comment and
      // PendingBooking's `issueId` doc comment). Resolving immediately on
      // click meant Cancel (or the X on the floating chip) still left the
      // issue looking "handled" and gone from the review list, even though
      // nothing was ever actually placed.
      // The current wall-clock hour (clamped to business hours), not a
      // fixed day-start-hour — much more likely to already be within
      // whatever's currently scrolled into view (the calendar itself is
      // deliberately never repositioned/scrolled for this), since a
      // business day is usually far taller than one screen's worth of rows.
      const now = new Date();
      const clampedHour = Math.min(Math.max(now.getHours(), dayStartHour), dayEndHour - 1);
      const start = new Date(anchorDate);
      start.setHours(clampedHour, 0, 0, 0);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + bookable.classDurationMinutes);
      setPendingBooking({
        resourceId: resource.id,
        // The review modal's own "View matches" list can pass a specific
        // suggested instructor straight in (its own quick "Assign" button —
        // see ClassesToReviewModal.tsx) — takes priority over whatever the
        // issue itself already carried, so picking a candidate there doesn't
        // still require picking again from PendingBookingActions' dropdown.
        instructorId: preselectedInstructor?.id ?? bookable.instructorId,
        instructorName: preselectedInstructor?.name ?? bookable.instructorName,
        title: bookable.className,
        type: bookable.classDomain,
        start,
        end,
        roomNeeds: bookable.roomNeeds,
        deliveryFormats: bookable.deliveryFormats,
        intensity: bookable.intensity,
        suggestedInstructors: bookable.suggestedInstructors,
        // Month view keeps the original "guess a spot, drag it like any
        // other event afterward" behavior (see PendingBooking's own doc
        // comment) — resourceId/start/end above are still a real, valid
        // guess either way, just not rendered on the grid until `placed`
        // for the other views (see `displayEvents` and PendingBookingChip).
        placed: view === 'month',
        issueId,
      });
      // Drives the instructor-availability overlay for the WHOLE time it's
      // unresolved (not just while actively being dragged, like a real
      // event) — cleared for free once pendingBooking is committed/
      // cancelled, since detailsEvent (looked up from displayEvents) then
      // simply stops resolving to anything for this id. Resolves to nothing
      // at all until `placed`, same reasoning (see displayEvents).
      setDetailsEventId(PENDING_EVENT_ID);
    },
    [resources, anchorDate, dayStartHour, dayEndHour, view, commitPendingBooking, closeEventPopover],
  );

  // PendingBookingActions' own instructor picker, shown only while the
  // pending booking has no real instructor yet (see `bookableClass`'s own
  // doc comment) — a plain local merge, no external side effect, so the
  // functional updater form is fine here (unlike commitPendingBooking).
  // Handles its own explicit "No instructor" option too (see
  // UNASSIGNED_INSTRUCTOR_ID's own doc comment) — picking it sets the SAME
  // sentinel id the pending placeholder already used as its "nothing
  // chosen yet" default, just now as a deliberate choice: commitPendingBooking's
  // own guard only checks that instructorId/instructorName aren't
  // null/undefined, which this satisfies just as well as a real instructor
  // would, so Book becomes clickable and the resulting event persists with
  // "Instructor needed" exactly like the pending placeholder already showed.
  const handleAssignPendingInstructor = useCallback(
    (instructorId: number) => {
      if (instructorId === UNASSIGNED_INSTRUCTOR_ID) {
        setPendingBooking((current) =>
          current ? { ...current, instructorId: UNASSIGNED_INSTRUCTOR_ID, instructorName: 'Instructor needed' } : current,
        );
        return;
      }
      const instructor = instructors.find((i) => i.id === instructorId);
      if (!instructor) return;
      setPendingBooking((current) => (current ? { ...current, instructorId: instructor.id, instructorName: instructor.name } : current));
    },
    [instructors],
  );

  // PendingBookingChip's own release handler — hit-tests the raw drop point
  // against whichever view is actually showing (each tags its own room/time
  // cells with data-pending-drop-resource-id — WeekViewVertical's own cells
  // additionally carry data-pending-drop-day-index, since its geometry is
  // time-of-day-only; TimelineView's ResourceRow cells don't need that,
  // their shared multi-day `geometry` resolves the day directly from X). A
  // drop outside any such cell (nothing found) leaves `pendingBooking`
  // completely untouched — the chip is still rendered (still unplaced) right
  // where it started, for another attempt, exactly like a native drag that
  // misses its target and snaps back.
  const handlePendingChipDrop = useCallback(
    (clientX: number, clientY: number) => {
      if (!pendingBooking) return;
      const cell = findDropCellAt(clientX, clientY);
      if (!cell) return;
      const resourceId = cell.dataset.pendingDropResourceId as string;
      const rect = cell.getBoundingClientRect();
      const durationMs = pendingBooking.end.getTime() - pendingBooking.start.getTime();
      let start: Date;
      if (cell.dataset.pendingDropDayIndex !== undefined) {
        // WeekViewVertical: Y = time-of-day (single-placeholder-day
        // geometry, see verticalTimeGeometry's own doc comment); the real
        // day comes from the cell's own day-index attribute instead.
        const dayIndex = Number(cell.dataset.pendingDropDayIndex);
        const timeOfDay = xToDate(clientY - rect.top, verticalTimeGeometry);
        const day = days[dayIndex] ?? anchorDate;
        start = new Date(
          day.getFullYear(), day.getMonth(), day.getDate(),
          timeOfDay.getHours(), timeOfDay.getMinutes(), 0, 0,
        );
      } else {
        // TimelineView: X = time, and its own multi-day `geometry` already
        // resolves which day directly from the raw offset.
        start = xToDate(clientX - rect.left, geometry);
      }
      const end = new Date(start.getTime() + durationMs);
      setPendingBooking((current) => (current ? { ...current, resourceId, start, end, placed: true } : current));
    },
    [pendingBooking, days, anchorDate, geometry, verticalTimeGeometry],
  );

  // CreateFab's "Unplaced classes" — a persistent drawer of many
  // simultaneously-draggable chips (see UnplacedClassesDrawer.tsx),
  // deliberately NOT built on top of the single pendingBooking/
  // PendingBookingChip mechanism above (that one is a singleton by design —
  // handleBookIssue auto-commits whatever's already pending before starting
  // a new one). This is its own, separate, array-based flow; only the
  // underlying hit-test convention (data-pending-drop-resource-id cells,
  // already grid-generic) is shared.
  const [unplacedDrawerOpen, setUnplacedDrawerOpen] = useState(false);
  // Month view has no room/time cells to drop onto, so a bin class dropped on
  // a Month day opens MonthMoveConflictModal (in 'place' mode) for that day
  // instead, where the user drags it into a room/time and confirms. `itemId`
  // is what actually gets placed on Confirm.
  const [pendingMonthPlacement, setPendingMonthPlacement] = useState<(PendingMonthMove & { itemId: string }) | null>(null);

  /** The stand-in for a bin class dropped on a Month `day` — only its day and duration matter: the modal has no default room/time, the class floats as a chip until the user drags it into the grid (see MonthMoveConflictModal). */
  const monthPlacementFor = useCallback(
    (item: UnplacedClass, day: Date): PendingMonthMove & { itemId: string } => {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), dayStartHour, 0, 0, 0);
      const end = new Date(start.getTime() + item.durationMinutes * 60000);
      const event: SchedulerEvent = {
        id: UNPLACED_MONTH_PLACEMENT_EVENT_ID,
        resourceId: '',
        title: item.title,
        type: item.type,
        start,
        end,
        instructorId: item.instructorId,
        instructorName: item.instructorName,
        roomNeeds: item.roomNeeds,
        deliveryFormats: item.deliveryFormats,
        intensity: item.intensity,
      };
      return { event, newStart: start, newEnd: end, itemId: item.id };
    },
    [dayStartHour],
  );

  const handleUnplacedChipDrop = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const item = unplacedClasses?.find((u) => u.id === id);
      if (!item) return;
      const cell = findDropCellAt(clientX, clientY);
      if (!cell) {
        // Month view: elementsFromPoint (plural), since an event bar or the
        // "+N more" button can sit on top of the day cell itself.
        const monthDayCell = document
          .elementsFromPoint(clientX, clientY)
          .find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.monthDropDay !== undefined);
        if (monthDayCell && resources.length > 0) {
          setPendingMonthPlacement(monthPlacementFor(item, new Date(Number(monthDayCell.dataset.monthDropDay))));
        }
        return;
      }
      const resourceId = cell.dataset.pendingDropResourceId as string;
      const rect = cell.getBoundingClientRect();
      const durationMs = item.durationMinutes * 60000;
      let start: Date;
      if (cell.dataset.pendingDropDayIndex !== undefined) {
        const dayIndex = Number(cell.dataset.pendingDropDayIndex);
        const timeOfDay = xToDate(clientY - rect.top, verticalTimeGeometry);
        const day = days[dayIndex] ?? anchorDate;
        start = new Date(
          day.getFullYear(), day.getMonth(), day.getDate(),
          timeOfDay.getHours(), timeOfDay.getMinutes(), 0, 0,
        );
      } else {
        start = xToDate(clientX - rect.left, geometry);
      }
      const end = new Date(start.getTime() + durationMs);
      onPlaceUnplacedClass?.(id, resourceId, start, end);
    },
    [unplacedClasses, days, anchorDate, geometry, verticalTimeGeometry, onPlaceUnplacedClass, resources.length, monthPlacementFor],
  );

  // Recomputes (or clears) the pending event's Book/Cancel popup position
  // whenever its placement actually changes (the initial "Book" click, or a
  // drag/resize committing — see handleEventInteractionStart's own
  // temporary clear during the drag itself) or the current view changes out
  // from under it. Same two-rAF "wait for the remount/layout to settle, then
  // measure the real DOM node" approach as handleViewIssueEvent's own
  // pending-scroll effect. Deliberately does NOT scroll the block into
  // view — handleBookIssue's own default placement (current wall-clock
  // hour, not a fixed day-start-hour) is chosen specifically so this rarely
  // needs to; the calendar's own scroll position is never touched here.
  useEffect(() => {
    if (!pendingBooking) {
      setPendingActionsAnchorRect(null);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-scheduler-event="${PENDING_EVENT_ID}"]`);
        setPendingActionsAnchorRect(el ? el.getBoundingClientRect() : null);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBooking?.resourceId, pendingBooking?.start.getTime(), pendingBooking?.end.getTime(), view, weekOrientation]);

  // Keeps the popup glued to the pending block as the calendar scrolls
  // (rather than staying fixed on-screen while the block scrolls away
  // underneath it, which is what a purely drag/resize/view-driven
  // recompute alone would do) — capturing phase catches a scroll on ANY of
  // the several independent scroll containers this app can have showing
  // (horizontal timeline, vertical week view, month grid), same reasoning
  // as EventPopover's own scroll listener. Unlike that one, this does NOT
  // close on scroll — it's meant to persist through the whole pending
  // lifetime, not just until the next scroll. The functional check
  // preserves `null` as-is (rather than resurrecting the popup) while it's
  // deliberately hidden for an active drag/resize (see
  // handleEventInteractionStart).
  useEffect(() => {
    if (!pendingBooking) return;
    function handleScroll() {
      setPendingActionsAnchorRect((current) => {
        if (current === null) return null;
        const el = document.querySelector<HTMLElement>(`[data-scheduler-event="${PENDING_EVENT_ID}"]`);
        return el ? el.getBoundingClientRect() : null;
      });
    }
    document.addEventListener('scroll', handleScroll, true);
    return () => document.removeEventListener('scroll', handleScroll, true);
  }, [pendingBooking]);

  // Clicking anywhere other than the pending event itself or its own
  // Book/Cancel popup commits it wherever it currently sits — per the
  // user's own instruction, "clicking away" always means Book here, never
  // Cancel; Cancel is the only way to actually discard it. Except: while it
  // still has no instructor assigned, OR hasn't been `placed` on a real cell
  // yet (see PendingBooking's own doc comment — the floating staging chip
  // has its own separate Cancel button for that case), there's nothing
  // valid to book yet, so an outside click is just ignored — it stays
  // pending until the user either finishes it (then a later outside click
  // WILL book it) or explicitly cancels.
  useEffect(() => {
    if (!pendingBooking) return;
    function handlePointerDown(e: MouseEvent) {
      if (pendingBooking?.instructorId == null || !pendingBooking.placed) return;
      const target = e.target as HTMLElement;
      if (target.closest(`[data-scheduler-event="${PENDING_EVENT_ID}"]`)) return;
      if (target.closest('[data-pending-booking-actions]')) return;
      commitPendingBooking();
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [pendingBooking, commitPendingBooking]);

  // onEventMove/onEventResizeEnd are shared by every real event AND the
  // pending placeholder — intercepted here so a drag/resize on the
  // placeholder updates `pendingBooking` locally instead of ever reaching
  // the host app's own onEventMove/onEventResizeEnd (which assume every
  // event they're given is already a real, committed one).
  const handleEventMove = useCallback<NonNullable<SchedulerProps['onEventMove']>>(
    (event, newResourceId, newStart, newEnd) => {
      if (event.id === PENDING_EVENT_ID) {
        setPendingBooking((current) => (current ? { ...current, resourceId: newResourceId, start: newStart, end: newEnd } : current));
        return;
      }
      onEventMove?.(event, newResourceId, newStart, newEnd);
    },
    [onEventMove],
  );
  const handleEventResizeEndWrapped = useCallback<NonNullable<SchedulerProps['onEventResizeEnd']>>(
    (event, newStart, newEnd, edge) => {
      if (event.id === PENDING_EVENT_ID) {
        setPendingBooking((current) => (current ? { ...current, start: newStart, end: newEnd } : current));
        return;
      }
      onEventResizeEnd?.(event, newStart, newEnd, edge);
    },
    [onEventResizeEnd],
  );

  // Opened from the event popover ("View instructor" under the Instructor
  // field), the settings drawer's instructor list, or CreateFab's "Add
  // instructor" — a centered modal rather than a side drawer, since it's not
  // anchored to a specific timeline selection the way the new-event drawer
  // is. One state covers both "viewing/editing an existing instructor" and
  // "filling out a brand new one", mirroring roomModalState above.
  const [instructorDialogState, setInstructorDialogState] = useState<InstructorDialogState | null>(null);
  // The event popover's own "View instructor" button — unlike the settings
  // drawer's instructor list (which has no popover to worry about), this
  // one closes the popover outright rather than leaving it open
  // underneath, so the instructor dialog (which renders above it) isn't
  // covering something that's still interactive.
  const handleViewInstructor = useCallback((instructorId: number) => {
    setInstructorDialogState({ mode: 'view', instructorId });
  }, []);
  const handleViewInstructorFromPopover = useCallback(
    (instructorId: number) => {
      handleViewInstructor(instructorId);
      closeEventPopover();
    },
    [handleViewInstructor, closeEventPopover],
  );
  const handleAddInstructorFab = useCallback(() => {
    setInstructorDialogState({ mode: 'add' });
  }, []);

  // UnplacedClassPopover — opened by clicking (not dragging) a chip in
  // UnplacedClassesDrawer. Looked up by id (not stored as a snapshot),
  // exactly like `detailsEvent` above, so an edit (instructor/domain) shows
  // up immediately without a stale-snapshot bug — see InstructorViewDialog's
  // own history earlier this session for exactly the failure mode this
  // avoids.
  const [unplacedDetailsId, setUnplacedDetailsId] = useState<string | null>(null);
  const [unplacedDetailsAnchorRect, setUnplacedDetailsAnchorRect] = useState<DOMRect | null>(null);
  const unplacedDetailsItem = useMemo(
    () => unplacedClasses?.find((u) => u.id === unplacedDetailsId) ?? null,
    [unplacedClasses, unplacedDetailsId],
  );
  // Drives the SAME instructor-availability overlay as an active drag (see
  // unplacedDragPhantom above) while this popover is open, so a user
  // deciding where to place a class can see room/time suitability whether
  // they're mid-drag OR just clicked to view details first. Deliberately a
  // SEPARATE phantom/state from unplacedDragPhantom/draggingUnplacedItem
  // rather than reusing them directly: a click that opens this popover (see
  // usePendingChipDrag's own click-vs-drop distinction) fires from the exact
  // same pointerup as the drag ending, and UnplacedClassesDrawer's own
  // drag-stop effect unconditionally clears whatever `draggingUnplacedItem`
  // holds the instant its own `dragging` flips false — reusing that same
  // state for "popover is open" would have it clear itself again on the
  // very next effect flush, immediately undoing the click's own attempt to
  // turn the overlay on. Keeping them independent sidesteps that race
  // entirely instead of trying to sequence around it.
  const unplacedDetailsPhantom = useMemo<SchedulerEvent | null>(() => {
    if (!unplacedDetailsItem) return null;
    const start = new Date();
    const end = new Date(start.getTime() + unplacedDetailsItem.durationMinutes * 60000);
    return {
      id: UNPLACED_DETAILS_EVENT_ID,
      resourceId: '',
      title: unplacedDetailsItem.title,
      type: unplacedDetailsItem.type,
      start,
      end,
      instructorId: unplacedDetailsItem.instructorId,
      instructorName: unplacedDetailsItem.instructorName,
      roomNeeds: unplacedDetailsItem.roomNeeds,
      deliveryFormats: unplacedDetailsItem.deliveryFormats,
      intensity: unplacedDetailsItem.intensity,
    };
  }, [unplacedDetailsItem]);
  const handleOpenUnplacedDetails = useCallback((item: UnplacedClass, anchorRect: DOMRect) => {
    setUnplacedDetailsId(item.id);
    setUnplacedDetailsAnchorRect(anchorRect);
  }, []);
  const closeUnplacedDetails = useCallback(() => {
    setUnplacedDetailsId(null);
    setUnplacedDetailsAnchorRect(null);
  }, []);
  const handleEditUnplacedClass = useCallback(
    (updates: Parameters<NonNullable<SchedulerProps['onEditUnplacedClass']>>[1]) => {
      if (unplacedDetailsId) onEditUnplacedClass?.(unplacedDetailsId, updates);
    },
    [unplacedDetailsId, onEditUnplacedClass],
  );
  const handleDismissUnplacedDetails = useCallback(() => {
    if (unplacedDetailsId) onDismissUnplacedClass?.(unplacedDetailsId);
    closeUnplacedDetails();
  }, [unplacedDetailsId, onDismissUnplacedClass, closeUnplacedDetails]);
  // Mirrors handleEventDuplicate's own convention exactly: closes the
  // popover right after firing, so the newly-added copy (a fresh chip at the
  // bottom of the Classes Bin list) is immediately visible/draggable rather
  // than sitting behind a popover still pointing at the original.
  const handleDuplicateUnplacedDetails = useCallback(() => {
    if (unplacedDetailsItem) onDuplicateUnplacedClass?.(unplacedDetailsItem);
    closeUnplacedDetails();
  }, [unplacedDetailsItem, onDuplicateUnplacedClass, closeUnplacedDetails]);
  const handleViewInstructorFromUnplacedPopover = useCallback(
    (instructorId: number) => {
      handleViewInstructor(instructorId);
      closeUnplacedDetails();
    },
    [handleViewInstructor, closeUnplacedDetails],
  );
  const handleEditInstructor = useCallback(
    (updates: Parameters<NonNullable<SchedulerProps['onEditInstructor']>>[1]) => {
      if (instructorDialogState?.mode === 'view') onEditInstructor?.(instructorDialogState.instructorId, updates);
    },
    [instructorDialogState, onEditInstructor],
  );

  // A Month-view drag-to-a-different-day that landed on a conflict — see
  // MonthView's onEventMoveConflict. Held here (not in MonthView itself) so
  // the resolution modal, like every other overlay in this component, is a
  // Scheduler.tsx-owned tree sibling rather than something a child view renders.
  const [pendingMonthMove, setPendingMonthMove] = useState<PendingMonthMove | null>(null);

  // A Month-view "View day" hover button — opens a full Day-view grid for
  // that date in a modal, without leaving Month view (see MonthView's
  // onOpenDayPreview and MonthDayPreviewModal).
  const [previewDay, setPreviewDay] = useState<Date | null>(null);

  // Mirrors state an external header (rendered via `hideToolbar`) needs but
  // can't compute itself — the title string and the drawer's open state.
  // Unlike onViewChange/onDateChange this fires immediately on mount too,
  // since a host header has no other way to get the initial value.
  const title = useMemo(
    () => formatToolbarTitle(view, anchorDate, weekStartsOn),
    [view, anchorDate, weekStartsOn],
  );

  // Today button stays "active" (blue) as long as today is somewhere in the
  // currently visible range — not just when it's the anchor — so e.g. Week
  // view stays lit for every day of the current week, not only when the
  // anchor lands exactly on today.
  const isTodayInView = useMemo(() => {
    const now = new Date();
    return now >= range.start && now < range.end;
  }, [range.start, range.end]);
  useEffect(() => {
    onTitleChange?.(title);
  }, [title, onTitleChange]);

  const isFirstDrawerEffect = useRef(true);
  useEffect(() => {
    if (isFirstDrawerEffect.current) {
      isFirstDrawerEffect.current = false;
      return;
    }
    onDrawerOpenChange?.(drawerOpen);
  }, [drawerOpen, onDrawerOpenChange]);

  // "Today" only changes the anchor date, which barely moves if you're already
  // looking at the current day/week — so if you'd scrolled the timeline to a
  // different day column, nothing would bring it back into view. Flag that a
  // scroll-to-today is due, then perform it once the (possibly unchanged)
  // range has settled into a `geometry` that's guaranteed to include today.
  const scrollToTodayPendingRef = useRef(false);

  const handleToday = useCallback(() => {
    gotoToday();
    scrollToTodayPendingRef.current = true;
  }, [gotoToday]);

  // Switching into Day/Week (from Month, or from each other) should land you
  // centered on "now" too, same as clicking Today — reuses the same pending
  // flag, since `view` is already a dependency of the centering effect below.
  const handleViewChange = useCallback(
    (nextView: Parameters<typeof setView>[0]) => {
      const applyViewChange = () => {
        setView(nextView);
        if (nextView !== 'month') scrollToTodayPendingRef.current = true;
      };
      // A real crossfade (the old view fading out while the new one fades
      // in, at the same time) needs the browser's View Transitions API — a
      // CSS animation on just the incoming element (the old approach here)
      // can only ever fade the new view in *after* the old one has already
      // vanished, which reads as an instant swap no matter how long that
      // fade-in is. Not supported everywhere (notably Firefox), so this is a
      // progressive enhancement: unsupported browsers just get the plain,
      // instant swap they'd have gotten anyway. `flushSync` forces the state
      // update (and the resulting DOM change) to happen synchronously inside
      // the callback, which is what the API needs to capture "before" vs.
      // "after" snapshots correctly — React's normal batching would otherwise
      // let the transition capture a stale "after" state.
      if (typeof document !== 'undefined' && 'startViewTransition' in document) {
        (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(() =>
          flushSync(applyViewChange),
        );
      } else {
        applyViewChange();
      }
    },
    [setView],
  );

  // Same real-crossfade treatment as handleViewChange above, for the
  // Horizontal/Vertical week-layout toggle — WeekViewVertical's own .grid
  // and TimelineView's own .scrollContainer already share the same
  // view-transition-name (see their own CSS), so this is the only piece
  // that was missing: the plain `setWeekOrientation` passed to
  // SchedulerDrawer's own onWeekOrientationChange never wrapped the change
  // in startViewTransition, so it always swapped instantly no matter what
  // the two view roots' own CSS was prepared for.
  const handleWeekOrientationChange = useCallback((nextOrientation: 'horizontal' | 'vertical') => {
    const applyOrientationChange = () => setWeekOrientation(nextOrientation);
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(() =>
        flushSync(applyOrientationChange),
      );
    } else {
      applyOrientationChange();
    }
  }, []);

  useEffect(() => {
    if (!scrollToTodayPendingRef.current) return;
    scrollToTodayPendingRef.current = false;
    const container = scrollContainerRef.current;
    if (!container || view === 'month' || weekOrientation === 'vertical') return;
    const now = new Date();
    // Centers on the whole visible screen, not just the canvas past the
    // sticky resource column — dateToX() is canvas-relative (0 = right after
    // the resource column), so its on-screen position is
    // RESOURCE_COLUMN_WIDTH + dateToX(now) - scrollLeft. Solving that for
    // scrollLeft such that the on-screen position lands at containerWidth/2
    // (true screen center) gives the line below.
    container.scrollLeft = Math.max(0, dateToX(now, geometry) + RESOURCE_COLUMN_WIDTH - containerWidth / 2);
  }, [geometry, view, weekOrientation, containerWidth]);

  // ClassesToReviewModal's "View" button — stays on whatever view is
  // currently active (Day/Week/Month, either Week orientation) and just
  // repositions the anchor date to the event's own date: gotoDate alone is
  // enough for that, since `range` is already derived from
  // `visibleRangeForView(view, anchorDate, ...)` — the CURRENT view, not a
  // hardcoded one — so a Week view lands on the week containing the event,
  // a Month view on its month, etc. Then opens its popover, same as a real
  // click would. Repositioning only *starts* that: the event's own
  // geometry-dependent position settles over the next couple of frames (and
  // TimelineView/WeekViewVertical/MonthView may remount entirely if the
  // date change also happens to land on a `key={view}` boundary), so the
  // actual DOM lookup + scrollIntoView + popover-opening is deferred to the
  // effect below via this pending id, rather than done here against a DOM
  // that doesn't reflect the new date yet.
  const [pendingViewEventId, setPendingViewEventId] = useState<string | null>(null);
  const handleViewIssueEvent = useCallback(
    (eventId: string) => {
      const event = events.find((e) => e.id === eventId);
      if (!event) return;
      setReviewModalOpen(false);
      gotoDate(event.start);
      setPendingViewEventId(eventId);
    },
    [events, gotoDate],
  );

  useEffect(() => {
    if (!pendingViewEventId) return;
    const id = pendingViewEventId;
    let raf2 = 0;
    let raf3 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-scheduler-event="${id}"]`);
        if (!el) {
          setPendingViewEventId(null);
          return;
        }
        el.scrollIntoView({ block: 'center', inline: 'center' });
        // One more frame before opening the popover, not immediately after
        // scrollIntoView — EventPopover's own click-outside effect treats
        // ANY scroll while it's open as "clicked away" and closes itself
        // right back up, and scrollIntoView's own scroll event can still be
        // arriving on the very next frame. Opening the popover only after
        // that settles avoids it closing itself the instant it opens.
        raf3 = requestAnimationFrame(() => {
          setDetailsEventId(id);
          setEventPopoverAnchorRect(el.getBoundingClientRect());
          setPendingSelection(null);
          setPendingViewEventId(null);
        });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
    };
  }, [pendingViewEventId]);

  useImperativeHandle(
    ref,
    (): SchedulerHandle => ({
      gotoToday: handleToday,
      gotoDate,
      gotoPrev,
      gotoNext,
      setView: handleViewChange,
      toggleDrawer,
      scrollToTime: (time: string) => {
        const container = scrollContainerRef.current;
        if (!container || view === 'month' || weekOrientation === 'vertical') return;
        const { hours, minutes } = parseTimeString(time);
        const target = new Date(geometry.days[0]);
        target.setHours(hours, minutes, 0, 0);
        container.scrollLeft = Math.max(0, dateToX(target, geometry) - RESOURCE_COLUMN_WIDTH);
      },
      scrollToResource: (resourceId: string) => {
        const container = scrollContainerRef.current;
        if (!container || view === 'month' || weekOrientation === 'vertical') return;
        const index = resources.findIndex((r) => r.id === resourceId);
        if (index === -1) return;
        // Approximate: assumes every row before this one is the default
        // ROW_HEIGHT. Only actually off when an earlier room is expanded
        // (see TimelineView's per-row expand/collapse) — exact positioning
        // would mean duplicating TimelineView's row-layout computation
        // (which depends on per-resource event-overlap lane counts) up here
        // just for this one imperative, rarely-called API.
        container.scrollTop = index * ROW_HEIGHT;
      },
      getVisibleRange: () => range,
    }),
    [
      handleToday,
      gotoDate,
      gotoPrev,
      gotoNext,
      handleViewChange,
      toggleDrawer,
      view,
      weekOrientation,
      geometry,
      resources,
      range,
    ],
  );

  return (
    <div className={styles.schedulerRoot}>
      <SchedulerDrawer
        open={drawerOpen}
        colorMode={colorMode}
        onColorModeChange={setColorMode}
        snapMinutes={snapMinutes}
        onSnapMinutesChange={setSnapMinutes}
        slotMinutes={slotMinutes}
        onSlotMinutesChange={setSlotMinutes}
        dayStartHour={dayStartHour}
        onDayStartHourChange={setDayStartHour}
        dayEndHour={dayEndHour}
        onDayEndHourChange={setDayEndHour}
        weekStartsOn={weekStartsOn}
        onWeekStartsOnChange={setWeekStartsOn}
        weekOrientation={weekOrientation}
        onWeekOrientationChange={handleWeekOrientationChange}
        resources={resources}
        onAddResource={onAddResource}
        onEditRoom={handleEditRoom}
        instructors={instructors}
        onViewInstructor={handleViewInstructor}
        hiddenInstructorIds={hiddenInstructorIds}
        onToggleInstructorVisibility={toggleInstructorVisibility}
        onToggleAllInstructorsVisible={toggleAllInstructorsVisible}
        classTypes={classTypes}
        onAddClassType={onAddClassType}
        onClassTypeColorChange={onClassTypeColorChange}
        hiddenClassTypes={hiddenClassTypes}
        onToggleClassTypeVisibility={toggleClassTypeVisibility}
        onToggleAllClassTypesVisible={toggleAllClassTypesVisible}
        onImport={onImport}
        onImportClassProfiles={onImportClassProfiles}
        onGenerateRoster={() => setGenerateModalMode('fresh')}
        canGenerateRoster={canGenerateRoster}
        onMergeRoster={onMergeRoster}
        onOpenGenerateModal={() => setGenerateModalMode('regenerate')}
        onLoad={onLoad}
        onSave={onSave}
        onExport={onExport}
      />

      <div className={styles.mainColumn}>
        {!hideToolbar && (
          <Toolbar
            view={view}
            anchorDate={anchorDate}
            weekStartsOn={weekStartsOn}
            drawerOpen={drawerOpen}
            onPrev={gotoPrev}
            onNext={gotoNext}
            onToday={handleToday}
            isTodayInView={isTodayInView}
            onViewChange={handleViewChange}
            onToggleDrawer={toggleDrawer}
          />
        )}

        {view === 'month' ? (
          <MonthView
            // Keyed by `view` so every Day/Week/Month switch remounts this
            // (not just a swap to/from Month) — that's what makes the CSS
            // fade-in in MonthView.module.css/TimelineView.module.css actually
            // replay on a Day<->Week switch, where the two views would
            // otherwise reuse the same TimelineView instance and never remount.
            key={view}
            events={displayEvents}
            eventColors={eventColors}
            anchorDate={anchorDate}
            weekStartsOn={weekStartsOn}
            selectedEventId={detailsEventId}
            sameClassEventIds={sameClassEventIds}
            hiddenClassTypes={hiddenClassTypes}
            hiddenInstructorIds={hiddenInstructorIds}
            flaggedEventIds={flaggedEventIds}
            blockingEventIds={blockingEventIds}
            editable={editable}
            onEventMove={handleEventMove}
            onEventMoveConflict={(event, newStart, newEnd) => {
              // The pending placeholder never has a real conflict to
              // resolve (there's nothing booked yet to conflict with in the
              // first place) — move it directly rather than opening a
              // confirmation modal that's really about two REAL bookings
              // clashing.
              if (event.id === PENDING_EVENT_ID) {
                handleEventMove(event, event.resourceId, newStart, newEnd);
                return;
              }
              setPendingMonthMove({ event, newStart, newEnd });
            }}
            renderEvent={renderEvent}
            onEventClick={handleEventClick}
            onEventDoubleClick={onEventDoubleClick}
            onDateClick={onDateClick}
            onOpenDayPreview={(day) => {
              setPreviewDay(day);
              // Mutually exclusive with both, same reasoning as
              // handleEventClick/handleSelection above — this used to rely
              // on the event popover's own generic "click outside" close
              // instead, which raced against this same click (see
              // MonthView's "View day" button comment) and could silently
              // eat the first click.
              closeEventPopover();
              setPendingSelection(null);
            }}
          />
        ) : (view === 'day' || view === 'week') && weekOrientation === 'vertical' ? (
          <WeekViewVertical
            key={`${view}-vertical`}
            days={days}
            resources={resources}
            events={displayEvents}
            eventColors={eventColors}
            instructors={instructors}
            highlightEvent={detailsEvent ?? unplacedDetailsPhantom}
            dayStartHour={dayStartHour}
            dayEndHour={dayEndHour}
            slotMinutes={slotMinutes}
            snapMinutes={snapMinutes}
            editable={editable}
            autoScrollThreshold={autoScrollThreshold}
            autoScrollSpeed={autoScrollSpeed}
            selectedEventId={detailsEventId}
            sameClassEventIds={sameClassEventIds}
            onEventInteractionStart={handleEventInteractionStart}
            hiddenClassTypes={hiddenClassTypes}
            hiddenInstructorIds={hiddenInstructorIds}
            flaggedEventIds={flaggedEventIds}
            blockingEventIds={blockingEventIds}
            pendingSelection={pendingSelection}
            onSelection={handleSelection}
            disableRowSelection={pendingSelection === null}
            onEditRoom={handleEditRoom}
            renderEvent={renderEvent}
            onEventClick={handleEventClick}
            onEventDoubleClick={onEventDoubleClick}
            onEventMove={handleEventMove}
            onEventResizeStart={onEventResizeStart}
            onEventResize={onEventResize}
            onEventResizeEnd={handleEventResizeEndWrapped}
          />
        ) : (
          <TimelineView
            key={view}
            resources={resources}
            events={displayEvents}
            instructors={instructors}
            highlightEvent={detailsEvent ?? unplacedDetailsPhantom}
            pendingSelection={pendingSelection}
            eventColors={eventColors}
            geometry={geometry}
            editable={editable}
            autoScrollThreshold={autoScrollThreshold}
            autoScrollSpeed={autoScrollSpeed}
            selectedEventId={detailsEventId}
            sameClassEventIds={sameClassEventIds}
            onEventInteractionStart={handleEventInteractionStart}
            hiddenClassTypes={hiddenClassTypes}
            hiddenInstructorIds={hiddenInstructorIds}
            flaggedEventIds={flaggedEventIds}
            blockingEventIds={blockingEventIds}
            expandedResourceIds={expandedResourceIds}
            onToggleResourceExpanded={toggleResourceExpanded}
            onEditRoom={handleEditRoom}
            renderEvent={renderEvent}
            onEventClick={handleEventClick}
            onEventDoubleClick={onEventDoubleClick}
            onEventMove={handleEventMove}
            onEventResizeStart={onEventResizeStart}
            onEventResize={onEventResize}
            onEventResizeEnd={handleEventResizeEndWrapped}
            onDateClick={onDateClick}
            onSelection={handleSelection}
            disableRowSelection={pendingSelection === null}
            scrollContainerRef={scrollContainerRef}
          />
        )}
      </div>

      <UnplacedClassesDrawer
        open={unplacedDrawerOpen}
        onClose={() => setUnplacedDrawerOpen(false)}
        unplacedClasses={unplacedClasses ?? []}
        classTypes={classTypes}
        onDrop={handleUnplacedChipDrop}
        onDismiss={(id) => onDismissUnplacedClass?.(id)}
        onOpenDetails={handleOpenUnplacedDetails}
        onDragStateChange={handleUnplacedDragStateChange}
      />

      <UnplacedClassPopover
        item={unplacedDetailsItem}
        anchorRect={unplacedDetailsAnchorRect}
        color={classTypes.find((ct) => ct.name === unplacedDetailsItem?.type)?.color ?? 'var(--sched-accent)'}
        instructors={instructors}
        classTypes={classTypes}
        resources={resources}
        onClose={closeUnplacedDetails}
        onEdit={handleEditUnplacedClass}
        onDismiss={handleDismissUnplacedDetails}
        onDuplicate={onDuplicateUnplacedClass ? handleDuplicateUnplacedDetails : undefined}
        onViewInstructor={handleViewInstructorFromUnplacedPopover}
      />

      <EventPopover
        event={detailsEvent}
        anchorRect={eventPopoverAnchorRect}
        color={(detailsEvent && eventColors.get(detailsEvent.id)) || 'var(--sched-accent)'}
        instructors={instructors}
        classTypes={classTypes}
        events={events}
        resources={resources}
        onClose={closeEventPopover}
        onEdit={handleEventEdit}
        onRecurrenceScopedEdit={onRecurrenceScopedEdit ? handleRecurrenceScopedEdit : undefined}
        onClassFieldScopedEdit={onClassFieldScopedEdit ? handleClassFieldScopedEdit : undefined}
        onDelete={handleEventDelete}
        onUnschedule={onUnscheduleEvent ? handleEventUnschedule : undefined}
        onDuplicate={onDuplicateEvent ? handleEventDuplicate : undefined}
        onViewInstructor={handleViewInstructorFromPopover}
        onClassTypeColorChange={onClassTypeColorChange}
        issue={reviewIssues?.find((issue) => issue.eventId === detailsEventId) ?? null}
        onResolveIssue={onResolveReviewIssue}
      />

      <NewEventDrawer
        selection={pendingSelection}
        resources={resources}
        instructors={instructors}
        classTypes={classTypes}
        onAddClassType={onAddClassType}
        onClose={() => setPendingSelection(null)}
        onCreate={handleCreateEvent}
      />

      <RoomModal
        state={roomModalState}
        resources={resources}
        onClose={() => setRoomModalState(null)}
        onAdd={(resource) => onAddResource?.(resource)}
        onSave={(resourceId, updates) => onEditResource?.(resourceId, updates)}
      />

      <GenerateModal
        open={generateModalMode !== null}
        mode={generateModalMode ?? 'regenerate'}
        defaultStart={generateDefaultStart}
        onClose={() => setGenerateModalMode(null)}
        onGenerateFresh={(range) => onGenerateRoster?.(range)}
        onRegenerate={(options) => onRegenerateWeek?.(options)}
        onClearAllPins={() => onClearAllPins?.()}
      />

      <InstructorViewDialog
        state={instructorDialogState}
        events={events}
        instructors={instructors}
        onClose={() => setInstructorDialogState(null)}
        onEdit={handleEditInstructor}
        onAdd={(instructor) => onAddInstructor?.(instructor)}
      />

      <MonthMoveConflictModal
        pendingMove={pendingMonthMove}
        resources={resources}
        instructors={instructors}
        events={events}
        eventColors={eventColors}
        dayStartHour={dayStartHour}
        dayEndHour={dayEndHour}
        slotMinutes={slotMinutes}
        snapMinutes={snapMinutes}
        autoScrollThreshold={autoScrollThreshold}
        autoScrollSpeed={autoScrollSpeed}
        onMoveOtherEvent={onEventMove}
        onCancel={() => setPendingMonthMove(null)}
        onConfirm={(resourceId, start, end) => {
          if (pendingMonthMove) onEventMove?.(pendingMonthMove.event, resourceId, start, end);
          setPendingMonthMove(null);
        }}
      />

      <MonthMoveConflictModal
        mode="place"
        pendingMove={pendingMonthPlacement}
        resources={resources}
        instructors={instructors}
        events={events}
        eventColors={eventColors}
        dayStartHour={dayStartHour}
        dayEndHour={dayEndHour}
        slotMinutes={slotMinutes}
        snapMinutes={snapMinutes}
        autoScrollThreshold={autoScrollThreshold}
        autoScrollSpeed={autoScrollSpeed}
        onMoveOtherEvent={onEventMove}
        onCancel={() => setPendingMonthPlacement(null)}
        onConfirm={(resourceId, start, end) => {
          if (pendingMonthPlacement) onPlaceUnplacedClass?.(pendingMonthPlacement.itemId, resourceId, start, end);
          setPendingMonthPlacement(null);
        }}
      />

      <MonthDayPreviewModal
        day={previewDay}
        weekOrientation={weekOrientation}
        resources={resources}
        instructors={instructors}
        events={events}
        eventColors={eventColors}
        dayStartHour={dayStartHour}
        dayEndHour={dayEndHour}
        slotMinutes={slotMinutes}
        snapMinutes={snapMinutes}
        editable={editable}
        autoScrollThreshold={autoScrollThreshold}
        autoScrollSpeed={autoScrollSpeed}
        selectedEventId={detailsEventId}
        sameClassEventIds={sameClassEventIds}
        highlightEvent={detailsEvent ?? unplacedDetailsPhantom}
        hiddenClassTypes={hiddenClassTypes}
        hiddenInstructorIds={hiddenInstructorIds}
        expandedResourceIds={expandedResourceIds}
        onToggleResourceExpanded={toggleResourceExpanded}
        renderEvent={renderEvent}
        onEventClick={handleEventClick}
        onEventDoubleClick={onEventDoubleClick}
        onEventInteractionStart={handleEventInteractionStart}
        onEventMove={onEventMove}
        onEventResizeStart={onEventResizeStart}
        onEventResize={onEventResize}
        onEventResizeEnd={onEventResizeEnd}
        onSelection={handleSelection}
        canUndo={canUndo}
        onUndo={onUndo}
        canRedo={canRedo}
        onRedo={onRedo}
        onClose={() => setPreviewDay(null)}
      />

      <CreateFab
        onAddClass={handleAddClassFab}
        onAddInstructor={handleAddInstructorFab}
        onAddRoom={handleAddRoomFab}
        onOpenReview={handleOpenReview}
        reviewIssueCount={reviewIssues?.length ?? 0}
        onOpenUnplacedClasses={() => setUnplacedDrawerOpen((current) => !current)}
        unplacedClassCount={Math.max(0, (unplacedClasses?.length ?? 0) - pendingFlightCount)}
      />
      {flyingChips.map((chip) => (
        <FlyingChip
          key={chip.id}
          fromRect={chip.fromRect}
          title={chip.title}
          color={chip.color}
          onFinish={() => handleFlightFinish(chip.id)}
        />
      ))}
      <ClassesToReviewModal
        open={reviewModalOpen}
        issues={reviewIssues ?? []}
        onClose={() => setReviewModalOpen(false)}
        onViewEvent={handleViewIssueEvent}
        onResolveIssue={onResolveReviewIssue}
        onBookIssue={handleBookIssue}
      />
      <PendingBookingActions
        anchorRect={pendingActionsAnchorRect}
        instructors={instructors}
        selectedInstructorId={pendingBooking?.instructorId}
        suggestedInstructors={pendingBooking?.suggestedInstructors}
        onAssignInstructor={handleAssignPendingInstructor}
        onBook={commitPendingBooking}
        onCancel={cancelPendingBooking}
      />
      {pendingBooking && !pendingBooking.placed && (
        <PendingBookingChip
          title={pendingBooking.title}
          durationMinutes={(pendingBooking.end.getTime() - pendingBooking.start.getTime()) / 60000}
          onDrop={handlePendingChipDrop}
          onCancel={cancelPendingBooking}
        />
      )}
    </div>
  );
});
