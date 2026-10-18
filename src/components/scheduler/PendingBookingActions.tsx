import { useLayoutEffect, useRef, useState } from 'react';
import { SearchableSelect } from './SearchableSelect';
import { UNASSIGNED_INSTRUCTOR_ID } from './Scheduler.types';
import type { InstructorOption } from './Scheduler.types';
import styles from './PendingBookingActions.module.css';

export interface PendingBookingActionsProps {
  /** The pending event block's own bounding rect (viewport coordinates) — where this anchors itself, same idea as EventPopover's own `anchorRect`. Null hides it (e.g. while the block is being actively dragged/resized — see Scheduler.tsx). */
  anchorRect: DOMRect | null;
  /** Selectable instructors for the "assign an instructor" picker — only rendered while `selectedInstructorId` is undefined. */
  instructors: InstructorOption[];
  /** Undefined means this class has no verified schedulable instructor yet (see ReviewIssue's own `bookableClass` doc comment) — the picker shows and Book stays disabled until one's chosen. */
  selectedInstructorId?: number;
  /** Real instructors (matched by NAME, not email — see buildRoster.ts's own `possibleInstructors`) that might be this same person under a different email — listed first, in their own group, ahead of the full instructor list. Matched here by `id`, not by re-comparing names. Carries each candidate's own already-claimed classes (not email — this app never carries that past buildRoster.ts) as the one bit of extra context for telling two same-named instructors apart. */
  suggestedInstructors?: { id: number; name: string; classes: string[] }[];
  onAssignInstructor: (instructorId: number) => void;
  onBook: () => void;
  onCancel: () => void;
}

const MARGIN_PX = 12;

/**
 * The small "confirm this placement" popup next to a manually-booked
 * pending class (see Scheduler.tsx's `pendingBooking`) — deliberately not
 * the full EventPopover (no title/type to edit here, those are already
 * fixed from the review issue it came from), just an instructor picker
 * (when needed) plus Book/Cancel. Clicking away from both the pending block
 * and this popup is treated as "Book" too, but only once an instructor is
 * actually assigned (see Scheduler.tsx's own outside-click handling) —
 * Cancel is the only way to actually discard it.
 */
export function PendingBookingActions({
  anchorRect,
  instructors,
  selectedInstructorId,
  suggestedInstructors,
  onAssignInstructor,
  onBook,
  onCancel,
}: PendingBookingActionsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const needsInstructor = selectedInstructorId == null;

  const suggestedClassesById = new Map((suggestedInstructors ?? []).map((s) => [s.id, s.classes]));
  const suggested = instructors.filter((instructor) => suggestedClassesById.has(instructor.id));
  const rest = suggestedClassesById.size > 0 ? instructors.filter((instructor) => !suggestedClassesById.has(instructor.id)) : instructors;

  useLayoutEffect(() => {
    if (!anchorRect || !rootRef.current) {
      setPosition(null);
      return;
    }
    const rect = rootRef.current.getBoundingClientRect();
    let left = anchorRect.right + MARGIN_PX;
    if (left + rect.width > window.innerWidth - MARGIN_PX) {
      left = anchorRect.left - rect.width - MARGIN_PX;
    }
    left = Math.max(MARGIN_PX, Math.min(left, window.innerWidth - rect.width - MARGIN_PX));
    const top = Math.max(MARGIN_PX, Math.min(anchorRect.top, window.innerHeight - rect.height - MARGIN_PX));
    setPosition({ top, left });
    // Re-measures when the instructor picker appears/disappears too — that
    // changes this popup's own height, which the position clamp above
    // needs to account for.
  }, [anchorRect, needsInstructor]);

  if (!anchorRect) return null;

  return (
    <div
      ref={rootRef}
      data-pending-booking-actions
      className={[styles.root, needsInstructor ? styles.rootStacked : ''].join(' ').trim()}
      style={{ top: position?.top ?? anchorRect.top, left: position?.left ?? anchorRect.right + MARGIN_PX }}
      role="dialog"
      aria-label="Confirm class placement"
    >
      {needsInstructor && (
        <SearchableSelect
          value=""
          options={[
            // Ungrouped (no `group`) so it renders first, plain, ahead of
            // whichever grouped/full instructor list follows — a
            // deliberate "book it anyway, without an instructor" escape
            // hatch (see UNASSIGNED_INSTRUCTOR_ID's own doc comment) for
            // when the class shouldn't stay stuck just because nobody's
            // been identified for it yet.
            { value: UNASSIGNED_INSTRUCTOR_ID, label: 'No instructor (book anyway)' },
            ...(suggested.length > 0
              ? [
                  ...suggested.map((instructor) => {
                    // Classes appended here specifically — two different real
                    // instructors can share a name with nothing else to tell
                    // them apart (see buildRoster.ts's own possibleInstructors
                    // doc comment); deliberately not email, which this app
                    // never carries past buildRoster.ts in the first place.
                    const classes = suggestedClassesById.get(instructor.id);
                    const label = classes && classes.length > 0 ? `${instructor.name} — teaches ${classes.join(', ')}` : instructor.name;
                    return { value: instructor.id, label, group: 'Possible match (same name, different email)' };
                  }),
                  ...rest.map((instructor) => ({ value: instructor.id, label: instructor.name, group: 'All instructors' })),
                ]
              : instructors.map((instructor) => ({ value: instructor.id, label: instructor.name }))),
          ]}
          onChange={onAssignInstructor}
          ariaLabel="Assign instructor"
          placeholder="Assign instructor…"
          searchPlaceholder="Search instructors…"
        />
      )}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.bookButton} onClick={onBook} disabled={needsInstructor}>
          Book
        </button>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
