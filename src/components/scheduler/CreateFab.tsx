import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarPlus, DoorOpen, PackageOpen, Plus, UserPlus, X } from 'lucide-react';
import styles from './CreateFab.module.css';

/**
 * Bottom-right floating "create" button — the replacement for the old
 * click/drag-to-create-an-event affordance on the calendar canvas (see
 * Scheduler.tsx's own `disableRowSelection` and WeekViewVertical.tsx's
 * removed click-to-create). Present regardless of which view (Day/Week/
 * Month, either Week orientation) is currently showing, since it's rendered
 * once at Scheduler.tsx's own root rather than inside any per-view
 * component. Stays visible in its plain resting (non-hover) appearance at
 * all times — no animation tied to Day/Week/Month switching; that was tried
 * and consistently read as glitchy/flickery rather than smooth, so it's
 * gone rather than kept half-working. The "Classes to review" menu item only
 * renders (and the button itself flags red with a count badge) while
 * `reviewIssueCount` is positive — there's nothing useful for it to open
 * otherwise.
 */
export interface CreateFabProps {
  onAddClass?: () => void;
  onAddInstructor?: () => void;
  onAddRoom?: () => void;
  /** Opens the "Classes to Review" modal (see ClassesToReviewModal.tsx). */
  onOpenReview?: () => void;
  /** Flags the button itself red and shows a count badge — whether there's currently anything to review (see Scheduler.types.ts's `reviewIssues`). */
  reviewIssueCount?: number;
  /** Opens the "Unplaced Classes" drawer (see UnplacedClassesDrawer.tsx). Only rendered while `unplacedClassCount` is positive — nothing useful for it to open otherwise. */
  onOpenUnplacedClasses?: () => void;
  /** Shows a count badge on this menu item — not a danger state like reviewIssueCount (see `.menuItemBadgeNeutral`), just pending work. */
  unplacedClassCount?: number;
}

export function CreateFab({
  onAddClass,
  onAddInstructor,
  onAddRoom,
  onOpenReview,
  reviewIssueCount = 0,
  onOpenUnplacedClasses,
  unplacedClassCount = 0,
}: CreateFabProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Capture phase (the `true` argument), not bubbling — EventBlock's own
    // drag-start handler calls stopPropagation() on pointerdown, which would
    // otherwise stop this listener from ever seeing a click on an event
    // while the menu is open. Capture runs on the way down, before that
    // stopPropagation takes effect on the way back up, so this still fires.
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      {/* Always mounted (never conditionally rendered) so closing can
          transition out via CSS just as smoothly as opening transitions in
          — a conditional `{open && ...}` would unmount instantly on close,
          with no chance for an exit transition to play at all. */}
      <div className={[styles.menu, open ? styles.menuOpen : ''].join(' ').trim()} role="menu" inert={!open}>
        <button
          type="button"
          className={styles.menuItem}
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onAddClass?.();
          }}
        >
          <CalendarPlus size={18} strokeWidth={2.25} />
          Add class
        </button>
        <button
          type="button"
          className={styles.menuItem}
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onAddInstructor?.();
          }}
        >
          <UserPlus size={18} strokeWidth={2.25} />
          Add instructor
        </button>
        <button
          type="button"
          className={styles.menuItem}
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onAddRoom?.();
          }}
        >
          <DoorOpen size={18} strokeWidth={2.25} />
          Add room
        </button>
        {unplacedClassCount > 0 && (
          <button
            type="button"
            className={styles.menuItem}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenUnplacedClasses?.();
            }}
          >
            <PackageOpen size={18} strokeWidth={2.25} />
            Classes bin
            <span className={styles.menuItemBadgeNeutral}>{unplacedClassCount}</span>
          </button>
        )}
        {reviewIssueCount > 0 && (
          <button
            type="button"
            className={[styles.menuItem, styles.menuItemDanger].join(' ')}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenReview?.();
            }}
          >
            <AlertTriangle size={18} strokeWidth={2.25} />
            Classes to review
            <span className={styles.menuItemBadge}>{reviewIssueCount}</span>
          </button>
        )}
      </div>
      <button
        type="button"
        data-create-fab
        className={[styles.fab, open ? styles.fabOpen : '', reviewIssueCount > 0 ? styles.fabHasIssues : '']
          .join(' ')
          .trim()}
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? 'Close create menu' : reviewIssueCount > 0 ? `Create new (${reviewIssueCount} classes to review)` : 'Create new'}
        aria-expanded={open}
      >
        {open ? <X size={24} strokeWidth={2.5} /> : <Plus size={24} strokeWidth={2.5} />}
        {!open && reviewIssueCount > 0 && (
          <span className={styles.fabBadge} aria-hidden="true">
            {reviewIssueCount > 9 ? '9+' : reviewIssueCount}
          </span>
        )}
      </button>
    </div>
  );
}
