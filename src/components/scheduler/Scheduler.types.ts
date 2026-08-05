import type { ReactNode, MouseEvent as ReactMouseEvent } from 'react';

export type SchedulerView = 'day' | 'week' | 'month';

export type ResizeEdge = 'start' | 'end';

export interface Resource {
  id: string;
  title: string;
}

export interface SchedulerEvent {
  id: string;
  resourceId: string;
  instructorId: number;
  /** The ClassRequest this event was generated from, if any — manually-created events (see onCreateEvent) have none. */
  classRequestId?: number;
  title: string;
  start: Date;
  end: Date;
  /** Explicit color; only used as a fallback when no "color by" filter resolves one. */
  color?: string;
  /** Free-form category used by the "color by type" filter, e.g. "consult", "therapy". */
  type?: string;
  instructorName: string;
  /** Room ids the originating class request listed as acceptable, ranked by preference — shown in the event details drawer. */
  preferredRooms?: string[];
}

/** Everything needed to create a new event, minus the `id` — the app assigns that when it commits the event to its own state. */
export type NewEventDraft = Omit<SchedulerEvent, 'id'>;

/** A drag-select on empty timeline space, awaiting the "new event" drawer's Create/Cancel — kept around (not just a transient drag state) so the selected region can stay highlighted while that drawer is open. */
export interface PendingSelection {
  resourceId: string;
  start: Date;
  end: Date;
}

/** A Month-view drag-to-a-different-day that landed on a conflict (room or instructor already booked) — held while MonthMoveConflictModal is open, awaiting Confirm/Cancel. `newStart`/`newEnd` are the *original* tentative placement (same room/time-of-day as before, only the date changed); the modal's own local state tracks any further repositioning within it. */
export interface PendingMonthMove {
  event: SchedulerEvent;
  newStart: Date;
  newEnd: Date;
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

/** A selectable instructor for the event details drawer's "Instructor" field, and for the move-target availability overlay. */
export interface InstructorOption {
  id: number;
  name: string;
  availability: InstructorAvailabilityBlock[];
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
}

export interface SchedulerProps {
  /** Resources rendered as timeline rows (Day/Week) — passed in by the consumer. */
  resources: Resource[];
  /** Controlled event list — the component never mutates this array itself. */
  events: SchedulerEvent[];
  /** Selectable instructors for the event details drawer's "Instructor" field. */
  instructors: InstructorOption[];
  /** Selectable class types (and their colors) for the "color by type" filter and the details drawer's "Class type" field. */
  classTypes: ClassTypeOption[];

  initialView?: SchedulerView;
  initialDate?: Date;

  /** Minimum interval (minutes) that drag/resize snaps to. Default 15. */
  snapMinutes?: number;
  /** Width, in minutes, of one timeline column. Default 30. */
  slotMinutes?: number;
  /** First displayed hour in Day/Week timeline. Default 7. */
  dayStartHour?: number;
  /** Last displayed hour (exclusive) in Day/Week timeline. Default 19. */
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
  /** Fired when the details drawer edits an event's type, room, or instructor directly (not a drag/resize). */
  onEventEdit?: (
    event: SchedulerEvent,
    updates: Partial<Pick<SchedulerEvent, 'resourceId' | 'type' | 'instructorId' | 'instructorName'>>,
  ) => void;
  /** Fired when the details drawer's Delete button is used. */
  onEventDelete?: (event: SchedulerEvent) => void;
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
  onLoad?: () => void;
  onSave?: () => void;
  onExport?: () => void;

  /** Fired when a new room is added via the drawer's "Rooms" section. */
  onAddResource?: (resource: Resource) => void;
  /** Fired when a new class type is added via the drawer's "Class Types" section. */
  onAddClassType?: (classType: ClassTypeOption) => void;
  /** Fired when a class type's color swatch changes in the drawer's "Class Types" section. */
  onClassTypeColorChange?: (name: string, color: string) => void;
  /** Fired when the instructor view/edit dialog saves a name or availability change. */
  onEditInstructor?: (instructorId: number, updates: Partial<Pick<InstructorOption, 'name' | 'availability'>>) => void;
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
