import { useEffect, useRef, useState } from 'react';
import { Clock, Eye, MapPin, Star, Tag, Trash2, User, X } from 'lucide-react';
import { formatTimeOfDay, monthLabel, weekdayLabel } from './utils/dateMath';
import type { ClassTypeOption, InstructorOption, Resource, SchedulerEvent } from './Scheduler.types';
import styles from './EventDetailsDrawer.module.css';

export type EventDetailsEdit = Partial<Pick<SchedulerEvent, 'resourceId' | 'type' | 'instructorId' | 'instructorName'>>;

export interface EventDetailsDrawerProps {
  event: SchedulerEvent | null;
  resources: Resource[];
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  onClose: () => void;
  onEdit: (updates: EventDetailsEdit) => void;
  onDelete: () => void;
  onViewInstructor: (instructorId: number) => void;
}

function formatEventDate(event: SchedulerEvent): string {
  return `${weekdayLabel(event.start)}, ${monthLabel(event.start)} ${event.start.getDate()}, ${event.start.getFullYear()}`;
}

function formatEventTimeRange(event: SchedulerEvent): string {
  return `${formatTimeOfDay(event.start)} – ${formatTimeOfDay(event.end)}`;
}

// Every field icon (not the class-type color) — a fixed app-wide blue,
// consistent regardless of the event's own category color.
const ICON_COLOR = 'var(--sched-accent)';

/**
 * Right-side sidebar showing an event's details, opened by double-clicking it
 * (see Scheduler.tsx). Width-animated like `SchedulerDrawer`, so it slides in
 * as its own sibling rather than overlaying the timeline. `event` is looked
 * up live by id in Scheduler.tsx, so a drag/resize/edit elsewhere is
 * reflected here immediately, and closes on any click outside itself.
 */
export function EventDetailsDrawer({ event, resources, instructors, classTypes, onClose, onEdit, onDelete, onViewInstructor }: EventDetailsDrawerProps) {
  const open = event !== null;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !event) return;
    const eventId = event.id;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (rootRef.current?.contains(target)) return; // inside the drawer itself
      // Starting a drag/resize on the highlighted event fires this same
      // mousedown — that's "using" the highlighted event, not clicking away
      // from it, so it shouldn't close the drawer out from under the drag.
      const targetEvent = target.closest('[data-scheduler-event]');
      if (targetEvent?.getAttribute('data-scheduler-event') === eventId) return;
      // The "View instructor" modal renders as a sibling, not a descendant,
      // of this drawer — closing *it* (including via its own close button)
      // shouldn't also read as "clicked outside the event drawer" and take
      // this one down too. Same reasoning for the Month-view move-conflict
      // modal: it can be open at the same time as this drawer (e.g. this
      // drawer showing event A while a drag on event B in Month view hits
      // a conflict).
      if (target.closest('[data-instructor-dialog]')) return;
      if (target.closest('[data-month-move-dialog]')) return;
      onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, event, onClose]);

  return (
    <div ref={rootRef} className={[styles.drawer, open ? styles.drawerOpen : ''].join(' ').trim()} aria-hidden={!open}>
      <div className={styles.content}>
        {event && (
          // Keyed by id, not just conditionally rendered — remounting on a
          // genuinely different event (not a live field update to this same
          // one) is what resets "are you sure?" without an effect for it.
          <EventDetailsContent
            key={event.id}
            event={event}
            resources={resources}
            instructors={instructors}
            classTypes={classTypes}
            onClose={onClose}
            onEdit={onEdit}
            onDelete={onDelete}
            onViewInstructor={onViewInstructor}
          />
        )}
      </div>
    </div>
  );
}

function EventDetailsContent({
  event,
  resources,
  instructors,
  classTypes,
  onClose,
  onEdit,
  onDelete,
  onViewInstructor,
}: {
  event: SchedulerEvent;
  resources: Resource[];
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  onClose: () => void;
  onEdit: (updates: EventDetailsEdit) => void;
  onDelete: () => void;
  onViewInstructor: (instructorId: number) => void;
}) {
  const roomTitle = (id: string) => resources.find((r) => r.id === id)?.title ?? id;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const preferredRooms = event.preferredRooms ?? [];

  return (
    <>
      <div className={styles.header}>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close event details">
          <X size={20} />
        </button>
        <h3 className={styles.title}>{event.title}</h3>
      </div>

      <div className={styles.fieldsWrapper}>
        <div className={styles.fields}>
          <div className={styles.dateTimeRow}>
            <Clock size={19} color={ICON_COLOR} />
            <div className={styles.dateTimeText}>
              <span className={styles.dateLine}>{formatEventDate(event)}</span>
              <span className={styles.timeLine}>{formatEventTimeRange(event)}</span>
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.fieldLabelRow}>
              <User size={17} color={ICON_COLOR} />
              <span className={styles.fieldLabel}>Instructor</span>
              <button
                type="button"
                className={styles.viewInstructorButton}
                onClick={() => onViewInstructor(event.instructorId)}
                aria-label="View instructor"
                title="View instructor"
              >
                <Eye size={18} color={ICON_COLOR} />
              </button>
            </div>
            <select
              className={styles.select}
              value={event.instructorId}
              onChange={(e) => {
                const instructor = instructors.find((i) => i.id === Number(e.target.value));
                if (instructor) onEdit({ instructorId: instructor.id, instructorName: instructor.name });
              }}
            >
              {!instructors.some((i) => i.id === event.instructorId) && (
                <option value={event.instructorId}>{event.instructorName}</option>
              )}
              {instructors.map((instructor) => (
                <option key={instructor.id} value={instructor.id}>
                  {instructor.name}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.twoColumnRow}>
            <div className={styles.field}>
              <div className={styles.fieldLabelRow}>
                <MapPin size={17} color={ICON_COLOR} />
                <span className={styles.fieldLabel}>Room</span>
              </div>
              <select className={styles.select} value={event.resourceId} onChange={(e) => onEdit({ resourceId: e.target.value })}>
                {resources.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.title}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <div className={styles.fieldLabelRow}>
                <Tag size={17} color={ICON_COLOR} />
                <span className={styles.fieldLabel}>Class Type</span>
              </div>
              <select className={styles.select} value={event.type ?? ''} onChange={(e) => onEdit({ type: e.target.value })}>
                {event.type && !classTypes.some((ct) => ct.name === event.type) && (
                  <option value={event.type}>{event.type}</option>
                )}
                {classTypes.map((classType) => (
                  <option key={classType.name} value={classType.name}>
                    {classType.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.fieldLabelRow}>
              <Star size={17} color={ICON_COLOR} />
              <span className={styles.fieldLabel}>Preferred Rooms</span>
            </div>
            {preferredRooms.length > 0 ? (
              <div className={styles.chipRow}>
                {preferredRooms.map((id) => (
                  <span key={id} className={styles.chip}>
                    {roomTitle(id)}
                  </span>
                ))}
              </div>
            ) : (
              <span className={styles.fieldValue}>—</span>
            )}
          </div>
        </div>

        {confirmingDelete ? (
          <div className={styles.confirmDelete}>
            <span className={styles.confirmDeleteText}>Delete this event?</span>
            <div className={styles.confirmDeleteActions}>
              <button type="button" className={styles.cancelDeleteButton} onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
              <button type="button" className={styles.confirmDeleteButton} onClick={onDelete}>
                Delete
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={styles.deleteButton} onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={18} />
            <span>Delete Event</span>
          </button>
        )}
      </div>
    </>
  );
}
