import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { CalendarX, ClipboardList, Copy, Eye, PackageOpen, Pencil, Pin, PinOff, Repeat, StickyNote, Trash2, Users, X } from 'lucide-react';
import { formatTimeRange, fromDateInputValue, monthLabel, toDateInputValue, weekdayLabel } from './utils/dateMath';
import { ClassEditModal } from './ClassEditModal';
import {
  addRoomNeedValue,
  DELIVERY_FORMAT_OPTIONS,
  DELIVERY_FORMAT_TITLES,
  getRoomNeedPills,
  INTENSITY_OPTIONS,
  NO_ROOM_FEATURES,
  ROOM_NEEDS_COLLAPSED_COUNT,
  toggleDeliveryFormatValue,
  toggleRoomNeedValue,
} from './classFieldOptions';
import { ColorPresetMenu } from './ColorPresetMenu';
import { NeedsPillGrid } from './NeedsPillGrid';
// Reused directly (rather than a second, duplicate stylesheet) for the
// standalone "No specific room features required" pill below, which isn't
// rendered through NeedsPillGrid itself — see NO_ROOM_FEATURES's own doc
// comment on why it needs to sit outside that component's scrollable list.
import needsPillGridStyles from './NeedsPillGrid.module.css';
import { SearchableSelect } from './SearchableSelect';
import type { ClassFieldEditScope, ClassTypeOption, InstructorOption, RecurrenceEditScope, Resource, ReviewIssue, SchedulerEvent } from './Scheduler.types';
import styles from './EventPopover.module.css';

export type EventPopoverEdit = Partial<
  Pick<
    SchedulerEvent,
    'title' | 'type' | 'instructorId' | 'instructorName' | 'note' | 'pinned' | 'recurrence' | 'roomNeeds' | 'maxParticipation' | 'deliveryFormats' | 'intensity'
  >
>;

/** The class-level fields a "Just this class / All classes of this type" scope choice can apply to — see needsClassFieldScopeChoice below. */
type ClassFieldEdit = Partial<Pick<SchedulerEvent, 'type' | 'roomNeeds' | 'maxParticipation' | 'deliveryFormats' | 'intensity'>>;

export interface EventPopoverProps {
  event: SchedulerEvent | null;
  /** The clicked event block's own bounding rect (viewport coordinates) — where this popover anchors itself. Null closes it, same as `event` being null. */
  anchorRect: DOMRect | null;
  /** Resolved fill for the small color dot in the header — same color the event block itself renders with. */
  color: string;
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  /** The full controlled event list — used only to look up the rest of this event's own recurring series (see needsRecurrenceScopeChoice below) and other placed occurrences sharing this event's own classRequestId (see needsClassFieldScopeChoice), never rendered directly. */
  events: SchedulerEvent[];
  /** Every room, for the "Room needs" field's own pill grid — the offered options are the union of every room's own roomNeeds (see NewEventDrawer.tsx/RoomModal.tsx, which already derive their "Class needs"/"Features" options the same way), so this stays in sync with what rooms actually offer instead of a separately-maintained list. */
  resources: Resource[];
  onClose: () => void;
  onEdit: (updates: EventPopoverEdit) => void;
  /** Fired instead of onEdit for a Repeat/Ends change (including turning recurrence off) when this event isn't its series' own anchor and already has earlier occurrences — after the user picks a scope in this popover's own inline prompt. Omitted entirely when the host app doesn't support it, in which case such a change just falls back to a plain onEdit with no prompt (today's behavior). */
  onRecurrenceScopedEdit?: (newRecurrence: SchedulerEvent['recurrence'], scope: RecurrenceEditScope) => void;
  /** Fired instead of onEdit for a Domain/Room-needs/Capacity change when this event has a classRequestId shared by at least one OTHER event in `events` — after the user picks a scope in this popover's own inline prompt ("Just this class" vs "All classes of this type"). Omitted entirely when the host app doesn't support it, in which case such a change just falls back to a plain onEdit with no prompt. */
  onClassFieldScopedEdit?: (updates: ClassFieldEdit, scope: ClassFieldEditScope) => void;
  onDelete: () => void;
  /** Sends this event back to the "Unplaced Classes" drawer instead of deleting it — unlike Delete, this is reversible (drag it back in), so it's a single click with no confirm step. Omitted entirely when the host app doesn't support it. */
  onUnschedule?: () => void;
  /** Adds a copy of this event in the SAME room/time slot (squished alongside the original via the existing overlap-lane layout) — unlike Unschedule, the original event is left exactly where it is. Omitted entirely when the host app doesn't support it. */
  onDuplicate?: () => void;
  onViewInstructor: (instructorId: number) => void;
  /** Recolors the event's class type itself (every event of that type, not just this one) — same effect as picking a color in the settings drawer's Class Types list. Optional/omitted the same way SchedulerDrawer's own prop is. */
  onClassTypeColorChange?: (name: string, color: string) => void;
  /** The unresolved "Classes to review" issue for this specific event, if any (see Scheduler.tsx, which looks this up by matching `issue.eventId` against `event.id`) — shown as an extra section with its own Resolve button, regardless of whether the popover got here via a normal click or CreateFab's "View" button. */
  issue?: ReviewIssue | null;
  onResolveIssue?: (issueId: string) => void;
}

const ICON_COLOR = 'var(--sched-accent)';
const POPOVER_MARGIN_PX = 12;
// Matches .popoverClosing's own animation-duration in EventPopover.module.css
// — how long the fade-out plays before this actually unmounts.
const EXIT_ANIMATION_MS = 140;
// Matches .confirmDeleteClosing's own animation-duration.
const CONFIRM_DELETE_EXIT_MS = 160;
// How long after the pointer leaves the color swatch (or the color menu
// itself) before the menu actually closes — long enough to move the mouse
// from one to the other without it vanishing mid-move.
const COLOR_MENU_CLOSE_DELAY_MS = 200;

function formatEventDateTime(event: SchedulerEvent): string {
  return `${weekdayLabel(event.start)}, ${monthLabel(event.start)} ${event.start.getDate()}, ${event.start.getFullYear()} · ${formatTimeRange(event.start, event.end)}`;
}

/** Plain-text label for the read-only "Repeat" row — see the same options in the Repeat SearchableSelect inside ClassEditModal below, which this must stay in sync with. */
function recurrenceLabel(recurrence: SchedulerEvent['recurrence']): string {
  switch (recurrence?.pattern) {
    case 'weekly':
      return 'Repeats weekly';
    case 'biweekly':
      return 'Repeats biweekly';
    case 'monthly':
      return 'Repeats monthly';
    default:
      return 'Not repeating';
  }
}

/** Plain-text label for the read-only "Ends" row — only ever called when `recurrence` is set (the row itself is conditional on that). */
function recurrenceEndLabel(recurrence: NonNullable<SchedulerEvent['recurrence']>): string {
  const end = recurrence.end;
  if (!end) return 'Never ends';
  if (end.type === 'on-date') {
    return `Ends ${monthLabel(end.date)} ${end.date.getDate()}, ${end.date.getFullYear()}`;
  }
  return `Ends after ${end.count} classes`;
}

/** Shared stroke treatment for the field-row icons below — 1.6 stroke-width, round joins, matching the reference mockup's own `.field svg` rule exactly (lucide's own default strokeWidth is 2, which reads visibly heavier next to these). */
function FieldIcon({ size, color, className, children }: { size: number; color: string; className?: string; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Instructor row's default (non-hover) icon — a plain person glyph, pixel-matched to the reference mockup's own Instructor row icon rather than lucide's `User` (whose proportions read subtly different at this size). Swapped for lucide's `Eye` on hover/focus — see .instructorRow in EventPopover.module.css. Exported for UnplacedClassPopover.tsx's own matching Instructor row. */
export function PersonIcon({ size, color, className }: { size: number; color: string; className?: string }) {
  return (
    <FieldIcon size={size} color={color} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </FieldIcon>
  );
}

/** Domain row's icon — pixel-matched to the reference mockup (plain stacked lines), rather than lucide's `Tag`. Exported for UnplacedClassPopover.tsx's own matching Domain row. */
export function DomainIcon({ size, color }: { size: number; color: string }) {
  return (
    <FieldIcon size={size} color={color}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </FieldIcon>
  );
}

/** Delivery row's icon — pixel-matched to the reference mockup's own hard-edged camera glyph, rather than lucide's `Video` (whose lens is a soft curved hook shape at this size). Exported for UnplacedClassPopover.tsx's own matching Delivery row. */
export function DeliveryIcon({ size, color }: { size: number; color: string }) {
  return (
    <FieldIcon size={size} color={color}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M22 8l-6 4 6 4V8z" />
    </FieldIcon>
  );
}

/** Intensity row's icon — pixel-matched to the reference mockup's own plain jagged pulse line, rather than lucide's `Activity` (which rounds every joint). Exported for UnplacedClassPopover.tsx's own matching Intensity row. */
export function IntensityIcon({ size, color }: { size: number; color: string }) {
  return (
    <FieldIcon size={size} color={color}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </FieldIcon>
  );
}

/**
 * A small floating popover anchored to the clicked event — a Google
 * Calendar-style quick view, replacing the old full-height details drawer.
 * Opened on a single click (see Scheduler.tsx's handleEventClick), not a
 * double-click. Renders at a first-guess position next to `anchorRect`, then
 * (via useLayoutEffect, before the browser paints) re-measures its own real
 * size and clamps to the viewport so it never renders off-screen.
 */
export function EventPopover({
  event,
  anchorRect,
  color,
  instructors,
  classTypes,
  events,
  resources,
  onClose,
  onEdit,
  onRecurrenceScopedEdit,
  onClassFieldScopedEdit,
  onDelete,
  onUnschedule,
  onDuplicate,
  onViewInstructor,
  onClassTypeColorChange,
  issue,
  onResolveIssue,
}: EventPopoverProps) {
  const isOpenProp = event !== null && anchorRect !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // Snapshot of the last real (event, anchorRect, color) — the parent nulls
  // its own state out the instant it closes this, but the fade-out
  // animation needs something to keep rendering with while it plays, so
  // this holds on to the last non-null values for the duration of that.
  const [snapshot, setSnapshot] = useState<{ event: SchedulerEvent; anchorRect: DOMRect; color: string } | null>(
    isOpenProp ? { event: event as SchedulerEvent, anchorRect: anchorRect as DOMRect, color } : null,
  );
  const [phase, setPhase] = useState<'open' | 'closing' | 'closed'>(isOpenProp ? 'open' : 'closed');

  // Adjusting state during render (React's own documented pattern for this
  // — see WeekViewVertical.tsx's matching `prevDays` idiom) rather than in
  // an effect: this is genuinely derived from props, not a subscription to
  // an external system, so doing it here avoids an extra wasted render.
  // Three separate "did this prop actually change" trackers, not one
  // combined one: `event` alone can change (a live edit — instructor/type/
  // title — while the SAME event stays open) without `anchorRect` or
  // `isOpenProp` changing at all, and that still needs to resync the
  // snapshot so the popover reflects it immediately.
  const [prevEvent, setPrevEvent] = useState(event);
  const [prevAnchorRect, setPrevAnchorRect] = useState(anchorRect);
  const [prevColor, setPrevColor] = useState(color);
  if (isOpenProp && (event !== prevEvent || anchorRect !== prevAnchorRect || color !== prevColor)) {
    setSnapshot({ event: event as SchedulerEvent, anchorRect: anchorRect as DOMRect, color });
    setPhase('open');
  } else if (!isOpenProp && phase === 'open') {
    // The close transition — a direct switch from one open event straight
    // to another never reaches here, since isOpenProp stays true the whole
    // time for that (handled by the branch above instead).
    setPhase('closing');
  }
  if (event !== prevEvent) setPrevEvent(event);
  if (anchorRect !== prevAnchorRect) setPrevAnchorRect(anchorRect);
  if (color !== prevColor) setPrevColor(color);

  // The closing → closed timer is a genuine effect (a subscription to the
  // passage of time, not state derived from props) — keeps the snapshot
  // on-screen, fading out via .popoverClosing, for exactly this long
  // before actually unmounting.
  useEffect(() => {
    if (phase !== 'closing') return;
    const timer = setTimeout(() => setPhase('closed'), EXIT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const open = phase !== 'closed' && snapshot !== null;
  const anchor = snapshot?.anchorRect ?? null;

  useLayoutEffect(() => {
    if (!open || !anchor || !rootRef.current) {
      setPosition(null);
      return;
    }
    const root = rootRef.current;
    function recomputePosition() {
      const rect = root.getBoundingClientRect();
      // Prefer opening to the right of the event, flipping to the left when
      // that would overflow — then clamp both axes so a click near any edge
      // of the viewport still leaves the whole card on-screen.
      let left = anchor!.right + POPOVER_MARGIN_PX;
      if (left + rect.width > window.innerWidth - POPOVER_MARGIN_PX) {
        left = anchor!.left - rect.width - POPOVER_MARGIN_PX;
      }
      left = Math.max(POPOVER_MARGIN_PX, Math.min(left, window.innerWidth - rect.width - POPOVER_MARGIN_PX));
      const top = Math.max(
        POPOVER_MARGIN_PX,
        Math.min(anchor!.top, window.innerHeight - rect.height - POPOVER_MARGIN_PX),
      );
      setPosition({ top, left });
    }
    recomputePosition();
    // Re-clamps whenever the popover's own rendered size actually changes —
    // e.g. the recurrence/class-field scope prompt appearing, the Ends
    // row's inline date/count input showing, the delete-confirm block
    // expanding, or the room-needs pill grid wrapping onto another line.
    // Without this, content that grows the card AFTER its initial position
    // was computed (this effect otherwise only re-runs when the event/
    // anchor itself changes, not on every re-render) could push its own
    // bottom — and any buttons inside it — below the viewport with no way
    // to reach them, since this is a `position: fixed` card with no scroll
    // of its own. Confirmed live: the class-field scope prompt's own
    // buttons landing off-screen on a shorter viewport/Month view.
    const observer = new ResizeObserver(recomputePosition);
    observer.observe(root);
    return () => observer.disconnect();
  }, [open, anchor, snapshot?.event.id]);

  useEffect(() => {
    // Only the fully-open phase listens — a closing (fading-out) popover is
    // already on its way out and shouldn't still be reacting to clicks,
    // scrolls, or Escape.
    if (phase !== 'open' || !snapshot) return;
    const eventId = snapshot.event.id;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (rootRef.current?.contains(target)) return; // inside the popover itself
      // Starting a drag/resize on the popover's own event fires this same
      // mousedown — that's "using" the event, not clicking away from it, so
      // it shouldn't close the popover out from under the drag. Mirrors
      // the old EventDetailsDrawer's identical guard.
      const targetEvent = target.closest('[data-scheduler-event]');
      if (targetEvent?.getAttribute('data-scheduler-event') === eventId) return;
      // The Month-view move-conflict modal renders as a sibling, not a
      // descendant, of this popover — closing it (including via its own
      // close button) shouldn't also read as "clicked outside the popover"
      // and take this down too. (The "View instructor" dialog isn't
      // exempted here: opening it now closes this popover outright — see
      // Scheduler.tsx's handleViewInstructorFromPopover.)
      if (target.closest('[data-month-move-dialog]')) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // The Month-move-conflict modal owns its own Escape handler (closing
      // itself) — deferring to it while it's open, same as the mousedown
      // guard above, keeps a single Escape press from also closing this
      // popover underneath it.
      if (document.querySelector('[data-month-move-dialog]')) return;
      onClose();
    }
    // Scroll events don't bubble, but a capturing listener on `document`
    // still sees them fire on their way down to whatever actually
    // scrolled — the only way to catch scrolling in any of the scheduler's
    // several independent scroll containers (horizontal timeline, vertical
    // week view, month grid) from one place.
    function handleScroll(e: Event) {
      if (rootRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [phase, snapshot, onClose]);

  if (!open || !snapshot || !anchor) return null;

  const popoverTop = position?.top ?? anchor.top;
  const popoverLeft = position?.left ?? anchor.right + POPOVER_MARGIN_PX;

  return (
    <>
      {/* A thin accent strip peeking out just above the card, like a second
          sheet sitting behind it — purely decorative (aria-hidden,
          pointer-events: none), positioned from the exact same top/left the
          popover itself resolves to, just offset up a few px and drawn
          BEHIND it (lower z-index) so most of its own height stays hidden
          under the card and only the top sliver ever shows. */}
      <div
        className={styles.popoverAccentStrip}
        style={{ top: popoverTop - 5, left: popoverLeft }}
        aria-hidden="true"
      />
      <div
        ref={rootRef}
        data-event-popover
        className={[styles.popover, phase === 'closing' ? styles.popoverClosing : ''].join(' ').trim()}
        style={{
          top: popoverTop,
          left: popoverLeft,
        }}
        role="dialog"
        aria-label={snapshot.event.title || 'Event details'}
      >
      {/* Keyed by id so switching to a different event (without the popover
          ever fully unmounting via `open`) resets in-progress title edits
          and any pending delete confirmation. */}
      <EventPopoverContent
        key={snapshot.event.id}
        event={snapshot.event}
        color={snapshot.color}
        instructors={instructors}
        classTypes={classTypes}
        events={events}
        resources={resources}
        onClose={onClose}
        onEdit={onEdit}
        onRecurrenceScopedEdit={onRecurrenceScopedEdit}
        onClassFieldScopedEdit={onClassFieldScopedEdit}
        onDelete={onDelete}
        onUnschedule={onUnschedule}
        onDuplicate={onDuplicate}
        onViewInstructor={onViewInstructor}
        onClassTypeColorChange={onClassTypeColorChange}
        issue={issue}
        onResolveIssue={onResolveIssue}
      />
      </div>
    </>
  );
}

function EventPopoverContent({
  event,
  color,
  instructors,
  classTypes,
  events,
  resources,
  onClose,
  onEdit,
  onRecurrenceScopedEdit,
  onClassFieldScopedEdit,
  onDelete,
  onUnschedule,
  onDuplicate,
  onViewInstructor,
  onClassTypeColorChange,
  issue,
  onResolveIssue,
}: Omit<EventPopoverProps, 'anchorRect'> & { event: SchedulerEvent }) {
  // 'closed' unmounts the confirm block entirely; 'closing' plays its
  // collapse-out animation (triggered by Cancel) before actually unmounting,
  // the same open/closing/closed shape EventPopover itself uses for its own
  // fade-out.
  const [deletePhase, setDeletePhase] = useState<'closed' | 'open' | 'closing'>('closed');

  // Every class-detail field (Title, Instructor, Domain, Repeat, Delivery,
  // Room needs, Capacity, Intensity, Note) is edited inside this modal —
  // opened via the header's own pencil button — rather than through inline
  // controls on the popover's own field rows, which now render as plain
  // read-only text (see the .body section below). Title and Note both apply
  // on blur/close rather than per-keystroke (same reasoning the old inline
  // title editor had): closeEditModal below always commits both drafts
  // first, so nothing typed is lost regardless of which of the modal's own
  // several close affordances (X, backdrop, Escape, Done) triggered it.
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(event.title);
  const [noteDraft, setNoteDraft] = useState(event.note ?? '');
  // Purely a display toggle for the read-only "Room needs" row below (see
  // ROOM_NEEDS_COLLAPSED_COUNT) — not part of the document/undo history,
  // since it doesn't change anything about the event itself.
  const [roomNeedsRowExpanded, setRoomNeedsRowExpanded] = useState(false);

  function commitTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== event.title) onEdit({ title: trimmed });
    else setTitleDraft(event.title);
  }

  function commitNote() {
    const trimmed = noteDraft.trim();
    if (trimmed !== (event.note ?? '').trim()) onEdit({ note: trimmed || undefined });
  }

  function closeEditModal() {
    commitTitle();
    commitNote();
    resolveClassFieldScopeChoice();
    setEditModalOpen(false);
  }

  // The modal's own explicit Cancel button — discards whatever's currently
  // typed in Title/Note (resetting the drafts back to the event's own
  // current values) rather than committing it, and drops any still-open
  // class-field scope choice unresolved. Every other field already applied
  // live the instant it was changed (see editClassField's own doc comment),
  // so this can't "undo" those too — only Title/Note, and whether a pending
  // scope choice propagates, have anything left uncommitted to discard.
  function cancelEditModal() {
    setTitleDraft(event.title);
    setNoteDraft(event.note ?? '');
    setPendingClassFieldChange(null);
    setClassFieldScopeChoice(null);
    setEditModalOpen(false);
  }

  // True only when this event is a NON-anchor occurrence of an EXISTING
  // multi-occurrence series — the only case where "all" and "this and
  // following" actually differ (from the anchor itself, both scopes come out
  // identical, so asking would be pointless). Recomputed straight from
  // `events` on every render rather than cached — cheap (one filter/reduce
  // over what's usually a small series) and always correct even as `events`
  // changes out from under an open popover.
  const seriesAnchorId = event.recurrence
    ? events.filter((e) => e.recurrence?.seriesId === event.recurrence!.seriesId).reduce((earliest, e) => (e.start < earliest.start ? e : earliest), event).id
    : null;
  const needsRecurrenceScopeChoice = seriesAnchorId !== null && seriesAnchorId !== event.id;

  // Wraps `{ value }` (rather than storing the recurrence value bare) so a
  // pending "turn recurrence off" (value: undefined) is distinguishable from
  // "nothing pending" (null).
  const [pendingRecurrence, setPendingRecurrence] = useState<{ value: SchedulerEvent['recurrence'] } | null>(null);

  function editRecurrence(newRecurrence: SchedulerEvent['recurrence']) {
    if (needsRecurrenceScopeChoice && onRecurrenceScopedEdit) {
      setPendingRecurrence({ value: newRecurrence });
    } else {
      onEdit({ recurrence: newRecurrence });
    }
  }

  function chooseRecurrenceScope(scope: RecurrenceEditScope) {
    if (pendingRecurrence) onRecurrenceScopedEdit?.(pendingRecurrence.value, scope);
    setPendingRecurrence(null);
  }

  // True when at least one OTHER event in the whole document shares this
  // event's own classRequestId — the only case where "just this class" and
  // "all classes of this type" actually differ. A manually-created event
  // (classRequestId undefined) or one whose class has no other placed
  // occurrence right now both skip the prompt entirely, same reasoning as
  // needsRecurrenceScopeChoice skipping it for a series' own anchor.
  const needsClassFieldScopeChoice =
    event.classRequestId != null && events.some((e) => e.id !== event.id && e.classRequestId === event.classRequestId);

  const [pendingClassFieldChange, setPendingClassFieldChange] = useState<ClassFieldEdit | null>(null);
  // Non-null once a choice is made — see the confirm block's own render
  // below: picking either option now just highlights that choice (staying
  // open, so it's still changeable) rather than resolving/dismissing the
  // prompt immediately. The actual scoped edit only fires on Save (see
  // closeEditModal) or is dropped on Cancel (see cancelEditModal).
  const [classFieldScopeChoice, setClassFieldScopeChoice] = useState<'just-this' | 'all' | null>(null);

  function editClassField(updates: ClassFieldEdit) {
    // Applied to THIS event immediately, always — a room-need pill (or
    // Domain/Capacity/Delivery/Intensity) toggling visibly the instant it's
    // clicked, not only once a scope choice is made, was the whole point of
    // this redesign: gating the visible checkmark/chip update behind an
    // unresolved prompt read as "clicking it does nothing" even once that
    // prompt was reliably scrolled into view — the change legitimately
    // hadn't happened yet at that point.
    onEdit(updates);
    // Multiple edits made before the propagate offer is resolved (e.g.
    // toggling two different room needs in a row) accumulate into one
    // merged pending object, rather than each new click discarding the
    // previous one — "All classes of this type" then propagates the FULL
    // set of changes made since the last resolution, not just the latest.
    if (needsClassFieldScopeChoice && onClassFieldScopedEdit) {
      setPendingClassFieldChange((prev) => ({ ...prev, ...updates }));
    }
  }

  // Resolves whatever choice is currently highlighted (see
  // classFieldScopeChoice's own doc comment) — called from closeEditModal,
  // once, when the modal actually saves. "All classes of this type" is the
  // only scope this ever sends onward — "Just this class" (or no choice
  // made at all) has nothing left to DO (see editClassField's own doc
  // comment: the change already landed on this event the instant it was
  // made), so anything other than an explicit 'all' is just a no-op.
  function resolveClassFieldScopeChoice() {
    if (pendingClassFieldChange && classFieldScopeChoice === 'all') {
      onClassFieldScopedEdit?.(pendingClassFieldChange, 'all');
    }
    setPendingClassFieldChange(null);
    setClassFieldScopeChoice(null);
  }

  // "What's available" for Room needs — see getRoomNeedPills's own doc
  // comment.
  const roomNeedPills = getRoomNeedPills(resources, event.roomNeeds);

  // See toggleRoomNeedValue/addRoomNeedValue's own doc comments for the
  // actual mutation rules (shared verbatim with UnplacedClassPopover.tsx) —
  // these just apply them THROUGH editClassField, so a room-need change also
  // feeds the class-field scope-choice prompt like every other field here.
  function toggleRoomNeed(need: string) {
    editClassField({ roomNeeds: toggleRoomNeedValue(event.roomNeeds, need) });
  }

  function addRoomNeed(name: string) {
    editClassField({ roomNeeds: addRoomNeedValue(event.roomNeeds, name) });
  }

  // The room-needs editor lives in a section that expands inline within the
  // card itself (toggled via the row's own trailing "+" button) rather than
  // a floating dropdown — the card's own ResizeObserver-driven reposition
  // (see EventPopover's own useLayoutEffect) already keeps the whole thing
  // on-screen as it grows, the same way it does for the Ends row or a scope
  // prompt appearing, so there's no need for a separate escape-the-card
  // overlay mechanism the way ColorPresetMenu's own .colorMenu needs.
  // See toggleDeliveryFormatValue's own doc comment for the actual rule.
  function toggleDeliveryFormat(format: string) {
    editClassField({ deliveryFormats: toggleDeliveryFormatValue(event.deliveryFormats, format) });
  }

  useEffect(() => {
    if (deletePhase !== 'closing') return;
    const timer = setTimeout(() => setDeletePhase('closed'), CONFIRM_DELETE_EXIT_MS);
    return () => clearTimeout(timer);
  }, [deletePhase]);

  // The header's color dot doubles as a hover-triggered class-type color
  // picker (see the header below) — reuses SchedulerDrawer.tsx's own
  // ColorPresetMenu so a color picked here looks and behaves identically to
  // picking one in the settings drawer's Class Types list (it recolors the
  // type everywhere, not just this one event).
  const currentClassType = classTypes.find((ct) => ct.name === event.type) ?? null;
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [colorMenuPosition, setColorMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const colorMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const classTypeColorInputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (colorMenuCloseTimer.current) clearTimeout(colorMenuCloseTimer.current);
    },
    [],
  );

  function cancelCloseColorMenu() {
    if (colorMenuCloseTimer.current) {
      clearTimeout(colorMenuCloseTimer.current);
      colorMenuCloseTimer.current = null;
    }
  }

  function scheduleCloseColorMenu() {
    cancelCloseColorMenu();
    colorMenuCloseTimer.current = setTimeout(() => setColorMenuOpen(false), COLOR_MENU_CLOSE_DELAY_MS);
  }

  function openColorMenu(e: ReactMouseEvent<HTMLElement>) {
    cancelCloseColorMenu();
    const rect = e.currentTarget.getBoundingClientRect();
    setColorMenuPosition({ top: rect.bottom + 6, left: rect.left });
    setColorMenuOpen(true);
  }

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setEditModalOpen(true)}
            aria-label="Edit class details"
            title="Edit class details"
          >
            <Pencil size={19} />
          </button>
          <button
            type="button"
            className={[styles.iconButton, event.pinned ? styles.iconButtonPinned : ''].join(' ').trim()}
            onClick={() => onEdit({ pinned: !event.pinned })}
            aria-label={event.pinned ? 'Unpin event' : 'Pin event'}
            title={
              event.pinned
                ? 'Unpin — a future regenerate will be free to move this again'
                : 'Pin — a future regenerate will hold this room/time in place'
            }
          >
            {event.pinned ? <PinOff size={19} /> : <Pin size={19} />}
          </button>
          {onDuplicate && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onDuplicate}
              aria-label="Duplicate class"
              title="Duplicate — adds a copy in the same spot for you to drag elsewhere"
            >
              <Copy size={19} />
            </button>
          )}
          {onUnschedule && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onUnschedule}
              aria-label="Move to classes bin"
              title="Move to classes bin (reversible — drag it back in later)"
            >
              <PackageOpen size={19} />
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setDeletePhase('open')}
            aria-label="Delete event"
            title="Delete event"
          >
            <Trash2 size={19} />
          </button>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close event details">
            <X size={20} />
          </button>
        </div>
        <div className={styles.headerTitleRow}>
          {currentClassType ? (
            <button
              type="button"
              className={styles.colorDot}
              style={{ background: color }}
              onMouseEnter={openColorMenu}
              onMouseLeave={scheduleCloseColorMenu}
              aria-label={`Change ${currentClassType.name} colour`}
              aria-haspopup="menu"
              aria-expanded={colorMenuOpen}
              title="Change class colour"
            />
          ) : (
            <span className={styles.colorDot} style={{ background: color }} aria-hidden="true" />
          )}
          <h3 className={styles.title}>{event.title || '(No title)'}</h3>
        </div>
      </div>

      {currentClassType && (
        <>
          {/* Real native picker behind the "Custom color" option below — same
              hidden-input-forwards-a-click pattern as SchedulerDrawer.tsx's
              own per-class-type color input. */}
          <input
            type="color"
            ref={classTypeColorInputRef}
            className={styles.hiddenColorInput}
            value={currentClassType.color}
            onChange={(e) => onClassTypeColorChange?.(currentClassType.name, e.target.value)}
            tabIndex={-1}
            aria-hidden="true"
          />
          {colorMenuOpen && colorMenuPosition && (
            <ColorPresetMenu
              position={colorMenuPosition}
              selectedColor={currentClassType.color}
              onPick={(pickedColor) => {
                onClassTypeColorChange?.(currentClassType.name, pickedColor);
                setColorMenuOpen(false);
              }}
              onOpenWheel={() => {
                setColorMenuOpen(false);
                classTypeColorInputRef.current?.click();
              }}
              onMouseEnter={cancelCloseColorMenu}
              onMouseLeave={scheduleCloseColorMenu}
            />
          )}
        </>
      )}

      <div className={styles.body}>
        <div className={styles.dateTimeLine}>{formatEventDateTime(event)}</div>

        <button
          type="button"
          className={[styles.row, styles.instructorRow].join(' ')}
          onClick={() => onViewInstructor(event.instructorId)}
          aria-label={`View ${event.instructorName}`}
          title="View instructor"
        >
          <span className={styles.instructorIconStack}>
            <PersonIcon size={16} color={ICON_COLOR} className={styles.instructorIconDefault} />
            <Eye size={16} color={ICON_COLOR} strokeWidth={1.6} className={styles.instructorIconHover} />
          </span>
          <span className={styles.readOnlyRowText}>{event.instructorName}</span>
        </button>

        <div className={styles.row}>
          <DomainIcon size={16} color={ICON_COLOR} />
          <span className={styles.readOnlyRowText}>{event.type || 'No domain set'}</span>
        </div>

        <div className={styles.row}>
          <Repeat size={16} color={ICON_COLOR} strokeWidth={1.6} aria-hidden="true" />
          <span className={styles.readOnlyRowText}>{recurrenceLabel(event.recurrence)}</span>
        </div>

        {event.recurrence && (
          <div className={styles.row}>
            <CalendarX size={16} color={ICON_COLOR} strokeWidth={1.6} aria-hidden="true" />
            <span className={styles.readOnlyRowText}>{recurrenceEndLabel(event.recurrence)}</span>
          </div>
        )}

        <div className={styles.row}>
          <DeliveryIcon size={16} color={ICON_COLOR} />
          <span className={styles.readOnlyRowText}>{(event.deliveryFormats ?? []).join(', ') || 'No delivery mode set'}</span>
        </div>

        <div className={[styles.row, styles.rowAlignStart].join(' ')}>
          <ClipboardList size={16} color={ICON_COLOR} aria-hidden="true" style={{ marginTop: 2 }} />
          {(event.roomNeeds ?? []).length === 0 ? (
            <span className={styles.readOnlyRowText}>No room needs set</span>
          ) : (
            <div className={styles.readOnlyRowStack}>
              {(roomNeedsRowExpanded ? event.roomNeeds! : event.roomNeeds!.slice(0, ROOM_NEEDS_COLLAPSED_COUNT)).map((need) => (
                <span key={need} className={styles.readOnlyRowText}>
                  {need}
                </span>
              ))}
              {event.roomNeeds!.length > ROOM_NEEDS_COLLAPSED_COUNT && (
                <button type="button" className={styles.expandRowButton} onClick={() => setRoomNeedsRowExpanded((expanded) => !expanded)}>
                  {roomNeedsRowExpanded ? 'Show less' : `+${event.roomNeeds!.length - ROOM_NEEDS_COLLAPSED_COUNT} more`}
                </button>
              )}
            </div>
          )}
        </div>

        <div className={styles.row}>
          <Users size={16} color={ICON_COLOR} aria-hidden="true" />
          <span className={styles.readOnlyRowText}>
            {event.maxParticipation != null ? `${event.maxParticipation} participants` : 'No capacity set'}
          </span>
        </div>

        <div className={styles.row}>
          <IntensityIcon size={16} color={ICON_COLOR} />
          <span className={styles.readOnlyRowText}>{event.intensity || 'Not set'}</span>
        </div>

        <div className={[styles.row, styles.rowAlignStart].join(' ')}>
          <StickyNote size={16} color={ICON_COLOR} strokeWidth={1.6} aria-hidden="true" style={{ marginTop: 2 }} />
          {event.note?.trim() ? (
            <p className={styles.noteText}>{event.note.trim()}</p>
          ) : (
            <p className={styles.noteEmptyText}>No note added</p>
          )}
        </div>

        {issue && (
          <div className={styles.issueBox}>
            <span className={styles.issueBoxCategory}>{issue.category}</span>
            <p className={styles.issueBoxDetail}>{issue.detail}</p>
            <button type="button" className={styles.issueResolveButton} onClick={() => onResolveIssue?.(issue.id)}>
              Resolve
            </button>
          </div>
        )}

        {deletePhase !== 'closed' && (
          <div
            className={[styles.confirmDelete, deletePhase === 'closing' ? styles.confirmDeleteClosing : '']
              .join(' ')
              .trim()}
          >
            <span className={styles.confirmDeleteText}>Delete this event?</span>
            <div className={styles.confirmDeleteActions}>
              <button type="button" className={styles.cancelDeleteButton} onClick={() => setDeletePhase('closing')}>
                Cancel
              </button>
              <button type="button" className={styles.confirmDeleteButton} onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      <ClassEditModal open={editModalOpen} title={event.title || '(No title)'} onClose={closeEditModal} onCancel={cancelEditModal}>
        <div className={styles.modalField}>
          <label className={styles.modalFieldLabel} htmlFor="class-edit-title">
            Title
          </label>
          <input
            id="class-edit-title"
            type="text"
            className={styles.modalTextInput}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            // Deliberately NOT onBlur={commitTitle} — clicking the footer's
            // own Cancel button blurs this input first (any click outside it
            // does), which would commit the draft a tick before Cancel's own
            // handler had a chance to discard it, defeating the entire
            // point of a separate Cancel action. Saving happens only via
            // ClassEditModal's own onClose (Save/X/backdrop/Escape all
            // route there — see closeEditModal), never a plain blur.
          />
        </div>

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Instructor</span>
          <SearchableSelect
            value={event.instructorId}
            options={[
              ...(!instructors.some((i) => i.id === event.instructorId)
                ? [{ value: event.instructorId, label: event.instructorName }]
                : []),
              ...instructors.map((instructor) => ({ value: instructor.id, label: instructor.name })),
            ]}
            onChange={(instructorId) => {
              const instructor = instructors.find((i) => i.id === instructorId);
              if (instructor) onEdit({ instructorId: instructor.id, instructorName: instructor.name });
            }}
            ariaLabel="Instructor"
            searchPlaceholder="Search instructors…"
            variant="plain"
          />
        </div>

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Domain</span>
          <SearchableSelect
            value={event.type ?? ''}
            options={[
              ...(event.type && !classTypes.some((ct) => ct.name === event.type)
                ? [{ value: event.type, label: event.type }]
                : []),
              ...classTypes.map((classType) => ({ value: classType.name, label: classType.name })),
            ]}
            onChange={(type) => editClassField({ type })}
            ariaLabel="Domain"
            searchPlaceholder="Search domains…"
            variant="plain"
          />
        </div>

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Repeat</span>
          <SearchableSelect
            value={event.recurrence?.pattern ?? 'none'}
            options={[
              { value: 'none', label: 'Not repeating' },
              { value: 'weekly', label: 'Repeats weekly' },
              { value: 'biweekly', label: 'Repeats biweekly' },
              { value: 'monthly', label: 'Repeats monthly' },
            ]}
            onChange={(pattern) => {
              if (pattern === 'none') {
                editRecurrence(undefined);
              } else {
                // Switching between patterns (or just re-saving the same
                // one) on an already-recurring event keeps the same
                // seriesId AND its own "Ends" condition — it's still the
                // same recurring booking, just a different cadence. A new
                // seriesId is only minted the first time recurrence is
                // turned on at all.
                editRecurrence({ pattern, seriesId: event.recurrence?.seriesId ?? crypto.randomUUID(), end: event.recurrence?.end });
              }
            }}
            ariaLabel="Repeat"
            variant="plain"
          />
        </div>

        {event.recurrence && (
          <div className={styles.modalField}>
            <span className={styles.modalFieldLabel}>Ends</span>
            <SearchableSelect
              value={event.recurrence.end?.type ?? 'never'}
              options={[
                { value: 'never', label: 'Never ends' },
                { value: 'on-date', label: 'Ends on a date' },
                { value: 'after-occurrences', label: 'Ends after a number of classes' },
              ]}
              onChange={(endType) => {
                const { pattern, seriesId } = event.recurrence!;
                if (endType === 'never') {
                  editRecurrence({ pattern, seriesId });
                } else if (endType === 'on-date') {
                  const defaultDate = new Date();
                  defaultDate.setHours(0, 0, 0, 0);
                  editRecurrence({ pattern, seriesId, end: { type: 'on-date', date: defaultDate } });
                } else {
                  editRecurrence({ pattern, seriesId, end: { type: 'after-occurrences', count: 4 } });
                }
              }}
              ariaLabel="Ends"
              variant="plain"
            />
            {event.recurrence.end?.type === 'on-date' && (
              <input
                type="date"
                className={styles.modalTextInput}
                value={toDateInputValue(event.recurrence.end.date)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const { pattern, seriesId } = event.recurrence!;
                  editRecurrence({ pattern, seriesId, end: { type: 'on-date', date: fromDateInputValue(e.target.value) } });
                }}
                aria-label="Ends on"
              />
            )}
            {event.recurrence.end?.type === 'after-occurrences' && (
              <input
                type="number"
                min={1}
                className={styles.modalTextInput}
                value={event.recurrence.end.count}
                onChange={(e) => {
                  const count = Number(e.target.value);
                  if (!Number.isFinite(count) || count < 1) return;
                  const { pattern, seriesId } = event.recurrence!;
                  editRecurrence({ pattern, seriesId, end: { type: 'after-occurrences', count } });
                }}
                aria-label="Number of classes"
              />
            )}
          </div>
        )}

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Delivery</span>
          <NeedsPillGrid
            options={DELIVERY_FORMAT_OPTIONS}
            optionTitles={DELIVERY_FORMAT_TITLES}
            selected={event.deliveryFormats ?? []}
            onToggle={toggleDeliveryFormat}
            selectedStyle="outline"
          />
        </div>

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Room needs</span>
          <button
            type="button"
            className={[
              needsPillGridStyles.needListItem,
              (event.roomNeeds ?? []).includes(NO_ROOM_FEATURES) ? needsPillGridStyles.needListItemSelected : '',
            ]
              .join(' ')
              .trim()}
            aria-pressed={(event.roomNeeds ?? []).includes(NO_ROOM_FEATURES)}
            onClick={() => toggleRoomNeed(NO_ROOM_FEATURES)}
          >
            {NO_ROOM_FEATURES}
          </button>
          <NeedsPillGrid
            options={roomNeedPills}
            selected={event.roomNeeds ?? []}
            onToggle={toggleRoomNeed}
            onAddNew={addRoomNeed}
            variant="list"
            addLabel="+ Add need"
            newPlaceholder="New room need"
          />
        </div>

        <div className={styles.modalField}>
          <label className={styles.modalFieldLabel} htmlFor="class-edit-capacity">
            Capacity
          </label>
          <input
            id="class-edit-capacity"
            type="number"
            min={1}
            className={styles.modalTextInput}
            value={event.maxParticipation ?? ''}
            placeholder="e.g. 20"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                editClassField({ maxParticipation: undefined });
                return;
              }
              const count = Number(raw);
              if (!Number.isFinite(count) || count < 1) return;
              editClassField({ maxParticipation: count });
            }}
          />
        </div>

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Intensity</span>
          <SearchableSelect
            value={event.intensity ?? ''}
            options={[
              { value: '', label: 'Not set' },
              ...INTENSITY_OPTIONS.map((option) => ({ value: option, label: option })),
            ]}
            onChange={(value) => editClassField({ intensity: value || undefined })}
            ariaLabel="Intensity"
            variant="plain"
          />
        </div>

        <div className={styles.modalField}>
          <label className={styles.modalFieldLabel} htmlFor="class-edit-note">
            Note
          </label>
          <textarea
            id="class-edit-note"
            className={styles.modalTextarea}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            // See the Title input's own comment above on why this is
            // deliberately not onBlur={commitNote}.
            placeholder="Add a note…"
          />
        </div>

        {pendingRecurrence && (
          <div className={styles.confirmScope}>
            <span className={styles.confirmScopeText}>Apply this change to all classes in this series, or just this and future ones?</span>
            <div className={styles.confirmScopeActions}>
              <button type="button" className={styles.scopeButton} onClick={() => setPendingRecurrence(null)}>
                Cancel
              </button>
              <button type="button" className={styles.scopeButton} onClick={() => chooseRecurrenceScope('this-and-following')}>
                This and following classes
              </button>
              <button type="button" className={styles.scopeButtonPrimary} onClick={() => chooseRecurrenceScope('all')}>
                All classes in this series
              </button>
            </div>
          </div>
        )}

        {pendingClassFieldChange && (
          <div className={styles.confirmScope}>
            <span className={styles.confirmScopeText}>Also apply this change to every other class of this type?</span>
            <div className={styles.confirmScopeActions}>
              <button
                type="button"
                className={[styles.scopeButton, classFieldScopeChoice === 'just-this' ? styles.scopeButtonChosen : ''].join(' ').trim()}
                onClick={() => setClassFieldScopeChoice('just-this')}
              >
                Just this class
              </button>
              <button
                type="button"
                className={[styles.scopeButton, classFieldScopeChoice === 'all' ? styles.scopeButtonChosen : ''].join(' ').trim()}
                onClick={() => setClassFieldScopeChoice('all')}
              >
                All classes of this type
              </button>
            </div>
          </div>
        )}
      </ClassEditModal>
    </>
  );
}
