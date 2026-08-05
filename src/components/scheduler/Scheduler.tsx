import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Toolbar } from './Toolbar';
import { SchedulerDrawer } from './SchedulerDrawer';
import { EventDetailsDrawer } from './EventDetailsDrawer';
import { NewEventDrawer } from './NewEventDrawer';
import { InstructorViewDialog } from './InstructorViewDialog';
import { MonthMoveConflictModal } from './MonthMoveConflictModal';
import { MonthDayPreviewModal } from './MonthDayPreviewModal';
import { TimelineView, ROW_HEIGHT, RESOURCE_COLUMN_WIDTH, MIN_SLOT_WIDTH_PX } from './TimelineView';
import { MonthView } from './MonthView';
import { WeekViewVertical } from './WeekViewVertical';
import { CreateFab } from './CreateFab';
import { useSchedulerNavigation } from './hooks/useSchedulerNavigation';
import { useElementWidth } from './hooks/useElementWidth';
import { createTimelineGeometry, dateToX, durationToWidthPx } from './utils/timeGeometry';
import { eachDayOfRange, formatToolbarTitle, parseTimeString } from './utils/dateMath';
import { computeEventColors } from './utils/eventColor';
import type { EventColorMode, PendingMonthMove, PendingSelection, SchedulerEvent, SchedulerHandle, SchedulerProps } from './Scheduler.types';
import styles from './Scheduler.module.css';

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
    dayStartHour: dayStartHourProp = 8,
    dayEndHour: dayEndHourProp = 20,
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
    onLoad,
    onSave,
    onExport,
    onAddResource,
    onAddClassType,
    onClassTypeColorChange,
    onEditInstructor,
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

  // Looked up by id (not stored as a snapshot) so the drawer reflects the
  // event's *current* fields live — a move/resize/edit that updates `events`
  // is picked up on the very next render with no extra plumbing.
  const [detailsEventId, setDetailsEventId] = useState<string | null>(null);
  const detailsEvent = useMemo(
    () => events.find((event) => event.id === detailsEventId) ?? null,
    [events, detailsEventId],
  );
  const handleEventDoubleClick = useCallback<NonNullable<SchedulerProps['onEventDoubleClick']>>(
    (event, e) => {
      // Double-clicking the event that's already open in the details drawer
      // closes it instead of just re-opening the same thing — a toggle,
      // like double-clicking usually is elsewhere in this app.
      setDetailsEventId((current) => (current === event.id ? null : event.id));
      setPendingSelection(null); // the details and new-event drawers are mutually exclusive
      onEventDoubleClick?.(event, e);
    },
    [onEventDoubleClick],
  );
  const handleEventEdit = useCallback(
    (updates: Parameters<NonNullable<SchedulerProps['onEventEdit']>>[1]) => {
      if (detailsEvent) onEventEdit?.(detailsEvent, updates);
    },
    [detailsEvent, onEventEdit],
  );
  const handleEventDelete = useCallback(() => {
    if (detailsEvent) onEventDelete?.(detailsEvent);
    setDetailsEventId(null);
  }, [detailsEvent, onEventDelete]);

  // Starting to actually move or resize an event (not just clicking it) opens
  // its details drawer too, same as a double-click — so the availability
  // overlay it drives is visible for the whole drag, not just after the fact.
  const handleEventInteractionStart = useCallback((event: SchedulerEvent) => {
    setDetailsEventId(event.id);
    setPendingSelection(null);
  }, []);

  // A drag-select on empty timeline space (see ResourceRow/ TimelineView)
  // opens this instead of immediately creating anything — the app only ever
  // learns about a new event once the drawer's Create button is used.
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const handleSelection = useCallback<NonNullable<SchedulerProps['onSelection']>>(
    (resourceId, selStart, selEnd) => {
      setPendingSelection({ resourceId, start: selStart, end: selEnd });
      setDetailsEventId(null); // mutually exclusive with the details drawer
      onSelection?.(resourceId, selStart, selEnd);
    },
    [onSelection],
  );
  const handleCreateEvent = useCallback(
    (draft: Parameters<NonNullable<SchedulerProps['onCreateEvent']>>[0]) => {
      onCreateEvent?.(draft);
      setPendingSelection(null);
    },
    [onCreateEvent],
  );

  // Opened from either the details drawer ("View instructor" under the
  // Instructor field) or the settings drawer's instructor list — a centered
  // modal rather than another side drawer, since it's not anchored to a
  // specific timeline selection the way the other two are.
  const [viewingInstructorId, setViewingInstructorId] = useState<number | null>(null);
  const viewingInstructor = useMemo(
    () => instructors.find((instructor) => instructor.id === viewingInstructorId) ?? null,
    [instructors, viewingInstructorId],
  );
  const handleEditInstructor = useCallback(
    (updates: Parameters<NonNullable<SchedulerProps['onEditInstructor']>>[1]) => {
      if (viewingInstructorId != null) onEditInstructor?.(viewingInstructorId, updates);
    },
    [viewingInstructorId, onEditInstructor],
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

  // Keeps the event open in the details drawer fully on-screen — both when
  // it's first selected (double-clicked somewhere already scrolled far from
  // it) and, critically, when the drawer's own width transitions in
  // afterward (0 -> 320px), which shrinks containerWidth and can push an
  // already-visible event (one near the far/late edge of the scrollable
  // timeline) out of the now-narrower view. Nothing else corrects for that
  // second case: it's easy to assume the browser's own scroll-anchoring
  // handles a resize like this "for free" (it does, most of the time — see
  // the containerWidth changes this doesn't even need to touch, at scroll
  // positions with real slack to anchor against), but exactly at the far
  // edge of the scrollable content there's nothing beyond the viewport left
  // to anchor to, so that heuristic has nothing to work with and simply
  // leaves the event stranded behind where the drawer now sits. Only
  // meaningful for horizontal Day/Week — Month has no shared horizontal
  // timeline, and WeekViewVertical owns its own separate scroll container.
  //
  // When a correction is needed at all, it jumps to the *farthest* position
  // that still keeps the event's own start on-screen — min(maxScrollLeft,
  // startX) — rather than the bare minimum needed to reveal just the
  // event's end. The minimum-adjustment version left later same-day content
  // (e.g. the last room in the week's last day-group) stranded just past
  // the new, narrower edge even though it was visible a moment ago: nothing
  // about opening the drawer should make already-visible later content
  // disappear if there's a scroll position that keeps both it *and* the
  // clicked event in view.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !detailsEvent || view === 'month' || weekOrientation === 'vertical') return;
    const startX = dateToX(detailsEvent.start, geometry);
    const endX = startX + durationToWidthPx(detailsEvent.start, detailsEvent.end, geometry);
    const requiredMinScrollLeft = RESOURCE_COLUMN_WIDTH + endX - containerWidth;
    if (container.scrollLeft > startX || container.scrollLeft < requiredMinScrollLeft) {
      const maxScrollLeft = container.scrollWidth - container.clientWidth;
      container.scrollLeft = Math.min(maxScrollLeft, startX);
    }
  }, [detailsEvent, geometry, containerWidth, view, weekOrientation]);

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
        onWeekOrientationChange={setWeekOrientation}
        resources={resources}
        onAddResource={onAddResource}
        instructors={instructors}
        onViewInstructor={setViewingInstructorId}
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
            events={events}
            eventColors={eventColors}
            anchorDate={anchorDate}
            weekStartsOn={weekStartsOn}
            selectedEventId={detailsEventId}
            hiddenClassTypes={hiddenClassTypes}
            hiddenInstructorIds={hiddenInstructorIds}
            editable={editable}
            onEventMove={onEventMove}
            onEventMoveConflict={(event, newStart, newEnd) => setPendingMonthMove({ event, newStart, newEnd })}
            renderEvent={renderEvent}
            onEventClick={onEventClick}
            onEventDoubleClick={handleEventDoubleClick}
            onDateClick={onDateClick}
            onOpenDayPreview={(day) => {
              setPreviewDay(day);
              // Mutually exclusive with both, same reasoning as
              // handleEventDoubleClick/handleSelection above — this used to
              // rely on EventDetailsDrawer's own generic "click outside"
              // close instead, which raced against this same click (see
              // MonthView's "View day" button comment) and could silently
              // eat the first click.
              setDetailsEventId(null);
              setPendingSelection(null);
            }}
          />
        ) : view === 'week' && weekOrientation === 'vertical' ? (
          <WeekViewVertical
            key={`${view}-vertical`}
            days={days}
            resources={resources}
            events={events}
            eventColors={eventColors}
            instructors={instructors}
            highlightEvent={detailsEvent}
            dayStartHour={dayStartHour}
            dayEndHour={dayEndHour}
            slotMinutes={slotMinutes}
            snapMinutes={snapMinutes}
            editable={editable}
            autoScrollThreshold={autoScrollThreshold}
            autoScrollSpeed={autoScrollSpeed}
            selectedEventId={detailsEventId}
            onEventInteractionStart={handleEventInteractionStart}
            hiddenClassTypes={hiddenClassTypes}
            hiddenInstructorIds={hiddenInstructorIds}
            renderEvent={renderEvent}
            onEventClick={onEventClick}
            onEventDoubleClick={handleEventDoubleClick}
            onEventMove={onEventMove}
            onEventResizeStart={onEventResizeStart}
            onEventResize={onEventResize}
            onEventResizeEnd={onEventResizeEnd}
          />
        ) : (
          <TimelineView
            key={view}
            resources={resources}
            events={events}
            instructors={instructors}
            highlightEvent={detailsEvent}
            pendingSelection={pendingSelection}
            eventColors={eventColors}
            geometry={geometry}
            editable={editable}
            autoScrollThreshold={autoScrollThreshold}
            autoScrollSpeed={autoScrollSpeed}
            selectedEventId={detailsEventId}
            onEventInteractionStart={handleEventInteractionStart}
            hiddenClassTypes={hiddenClassTypes}
            hiddenInstructorIds={hiddenInstructorIds}
            expandedResourceIds={expandedResourceIds}
            onToggleResourceExpanded={toggleResourceExpanded}
            renderEvent={renderEvent}
            onEventClick={onEventClick}
            onEventDoubleClick={handleEventDoubleClick}
            onEventMove={onEventMove}
            onEventResizeStart={onEventResizeStart}
            onEventResize={onEventResize}
            onEventResizeEnd={onEventResizeEnd}
            onDateClick={onDateClick}
            onSelection={handleSelection}
            disableRowSelection
            scrollContainerRef={scrollContainerRef}
          />
        )}
      </div>

      <EventDetailsDrawer
        event={detailsEvent}
        resources={resources}
        instructors={instructors}
        classTypes={classTypes}
        onClose={() => setDetailsEventId(null)}
        onEdit={handleEventEdit}
        onDelete={handleEventDelete}
        onViewInstructor={setViewingInstructorId}
      />

      <NewEventDrawer
        selection={pendingSelection}
        resources={resources}
        instructors={instructors}
        classTypes={classTypes}
        onClose={() => setPendingSelection(null)}
        onCreate={handleCreateEvent}
      />

      <InstructorViewDialog
        instructor={viewingInstructor}
        events={events}
        onClose={() => setViewingInstructorId(null)}
        onEdit={handleEditInstructor}
      />

      <MonthMoveConflictModal
        pendingMove={pendingMonthMove}
        resources={resources}
        instructors={instructors}
        events={events}
        dayStartHour={dayStartHour}
        dayEndHour={dayEndHour}
        slotMinutes={slotMinutes}
        snapMinutes={snapMinutes}
        autoScrollThreshold={autoScrollThreshold}
        autoScrollSpeed={autoScrollSpeed}
        onCancel={() => setPendingMonthMove(null)}
        onConfirm={(resourceId, start, end) => {
          if (pendingMonthMove) onEventMove?.(pendingMonthMove.event, resourceId, start, end);
          setPendingMonthMove(null);
        }}
      />

      <MonthDayPreviewModal
        day={previewDay}
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
        highlightEvent={detailsEvent}
        hiddenClassTypes={hiddenClassTypes}
        hiddenInstructorIds={hiddenInstructorIds}
        expandedResourceIds={expandedResourceIds}
        onToggleResourceExpanded={toggleResourceExpanded}
        renderEvent={renderEvent}
        onEventClick={onEventClick}
        onEventDoubleClick={handleEventDoubleClick}
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

      <CreateFab />
    </div>
  );
});
