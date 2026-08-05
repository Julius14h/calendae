import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatTimeOfDay, monthLabel, weekdayLabel } from './utils/dateMath';
import type { ClassTypeOption, InstructorOption, NewEventDraft, PendingSelection, Resource } from './Scheduler.types';
import styles from './EventDetailsDrawer.module.css';

export interface NewEventDrawerProps {
  selection: PendingSelection | null;
  resources: Resource[];
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  onClose: () => void;
  onCreate: (draft: NewEventDraft) => void;
}

function formatRange(start: Date, end: Date): string {
  const date = `${weekdayLabel(start)}, ${monthLabel(start)} ${start.getDate()}, ${start.getFullYear()}`;
  return `${date} · ${formatTimeOfDay(start)} – ${formatTimeOfDay(end)}`;
}

/**
 * Right-side sidebar for turning a timeline drag-select (see ResourceRow's
 * onSelection) into a real event — room and time come from the selection,
 * everything else is filled in here. Reuses EventDetailsDrawer's styling so
 * the two feel like one system rather than two different UIs.
 */
export function NewEventDrawer({ selection, resources, instructors, classTypes, onClose, onCreate }: NewEventDrawerProps) {
  const open = selection !== null;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (rootRef.current?.contains(target)) return;
      // The "View instructor" modal and the Month-view move-conflict modal
      // both render as siblings, not descendants, of this drawer — see
      // EventDetailsDrawer.tsx's matching guard.
      if (target.closest('[data-instructor-dialog]')) return;
      if (target.closest('[data-month-move-dialog]')) return;
      onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, onClose]);

  return (
    <div ref={rootRef} className={[styles.drawer, open ? styles.drawerOpen : ''].join(' ').trim()} aria-hidden={!open}>
      <div className={styles.content}>
        {selection && (
          // Keyed by the selection's own identity, not a stable id — a new
          // drag-select should always start the form fresh, and remounting
          // (rather than an effect that resets state after the fact) is the
          // straightforward way to get that.
          <NewEventForm
            key={`${selection.resourceId}-${selection.start.getTime()}`}
            selection={selection}
            resources={resources}
            instructors={instructors}
            classTypes={classTypes}
            onClose={onClose}
            onCreate={onCreate}
          />
        )}
      </div>
    </div>
  );
}

function NewEventForm({
  selection,
  resources,
  instructors,
  classTypes,
  onClose,
  onCreate,
}: {
  selection: PendingSelection;
  resources: Resource[];
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  onClose: () => void;
  onCreate: (draft: NewEventDraft) => void;
}) {
  const [className, setClassName] = useState('');
  const [classType, setClassType] = useState(classTypes[0]?.name ?? '');
  const [instructorId, setInstructorId] = useState<number | ''>(instructors[0]?.id ?? '');

  const roomTitle = resources.find((r) => r.id === selection.resourceId)?.title ?? selection.resourceId;

  function handleCreate() {
    const instructor = instructors.find((i) => i.id === instructorId);
    if (!className.trim() || !instructor) return;
    onCreate({
      resourceId: selection.resourceId,
      start: selection.start,
      end: selection.end,
      title: className.trim(),
      type: classType || undefined,
      instructorId: instructor.id,
      instructorName: instructor.name,
    });
  }

  return (
    <>
      <div className={styles.header}>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Cancel new event">
          <X size={20} />
        </button>
        <h3 className={styles.title}>New event</h3>
      </div>

      <div className={styles.fieldsWrapper}>
        <dl className={styles.fields}>
          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Time/date</dt>
            <dd className={styles.fieldValue}>{formatRange(selection.start, selection.end)}</dd>
          </div>

          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Room</dt>
            <dd className={styles.fieldValue}>{roomTitle}</dd>
          </div>

          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Class name</dt>
            <dd className={styles.fieldValue}>
              <input
                className={styles.select}
                type="text"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="e.g. Swimming"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
            </dd>
          </div>

          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Class type</dt>
            <dd className={styles.fieldValue}>
              <select className={styles.select} value={classType} onChange={(e) => setClassType(e.target.value)}>
                {classTypes.map((ct) => (
                  <option key={ct.name} value={ct.name}>
                    {ct.name}
                  </option>
                ))}
              </select>
            </dd>
          </div>

          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Instructor</dt>
            <dd className={styles.fieldValue}>
              <select className={styles.select} value={instructorId} onChange={(e) => setInstructorId(Number(e.target.value))}>
                {instructors.map((instructor) => (
                  <option key={instructor.id} value={instructor.id}>
                    {instructor.name}
                  </option>
                ))}
              </select>
            </dd>
          </div>
        </dl>

        <button type="button" className={styles.createButton} disabled={!className.trim() || instructorId === ''} onClick={handleCreate}>
          Create event
        </button>
      </div>
    </>
  );
}
