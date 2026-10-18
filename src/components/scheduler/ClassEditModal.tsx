import { useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './ClassEditModal.module.css';

export interface ClassEditModalProps {
  open: boolean;
  title: string;
  /** X button, backdrop click, and Escape all treat closing as "save" — see EventPopover.tsx's own closeEditModal, which commits the Title/Note drafts before calling this. */
  onClose: () => void;
  /** The footer's own explicit Cancel button — distinct from onClose because it discards any in-progress (not yet committed) Title/Note edit instead of saving it; every other field already applied live the instant it was changed (see editClassField's own doc comment), so Cancel can't "undo" those — only Title/Note have anything left to discard. */
  onCancel: () => void;
  children: React.ReactNode;
}

/**
 * The generic backdrop+card shell for editing a class's own fields — see
 * EventPopover.tsx, which owns every actual field (Instructor, Domain,
 * Repeat, Delivery, Room needs, Capacity, Intensity, Note) as children here
 * rather than this component taking a prop per field, so those fields keep
 * using EventPopoverContent's own existing edit handlers/scope-choice state
 * directly instead of a long prop-drilled duplicate of it. Opened via the
 * popover's own header pencil button, now that every field row in the
 * popover itself is plain read-only text (see EventPopover.module.css's
 * .readOnlyRowText) rather than an inline editable control — editing a
 * class's details happens here instead, in one place, rather than scattered
 * across small always-visible controls competing with the popover's own
 * quick-glance layout. Mirrors RoomModal.tsx's own centered backdrop+card.
 */
export function ClassEditModal({ open, title, onClose, onCancel, children }: ClassEditModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Edit ${title}`}>
        <div className={styles.header}>
          <h2 className={styles.title}>Edit class details</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <X size={22} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        <div className={styles.footer}>
          <button type="button" className={styles.saveButton} onClick={onClose}>
            Save
          </button>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
