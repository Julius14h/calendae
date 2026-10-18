import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ClipboardList, Copy, Eye, Pencil, StickyNote, Trash2, Users, X } from 'lucide-react';
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
import { DeliveryIcon, DomainIcon, IntensityIcon, PersonIcon } from './EventPopover';
import { NeedsPillGrid } from './NeedsPillGrid';
import needsPillGridStyles from './NeedsPillGrid.module.css';
import { SearchableSelect } from './SearchableSelect';
import type { ClassTypeOption, InstructorOption, Resource, UnplacedClass } from './Scheduler.types';
import styles from './EventPopover.module.css';

export type UnplacedClassPopoverEdit = Partial<
  Pick<UnplacedClass, 'title' | 'instructorId' | 'instructorName' | 'type' | 'roomNeeds' | 'maxParticipation' | 'deliveryFormats' | 'intensity' | 'note'>
>;

export interface UnplacedClassPopoverProps {
  item: UnplacedClass | null;
  /** The clicked chip's own bounding rect (viewport coordinates) — where this popover anchors itself, same convention as EventPopover's own anchorRect. */
  anchorRect: DOMRect | null;
  color: string;
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  /** Feeds the edit modal's own Room needs field — see EventPopover.tsx's own getRoomNeedPills. */
  resources: Resource[];
  onClose: () => void;
  onEdit: (updates: UnplacedClassPopoverEdit) => void;
  onDismiss: () => void;
  /** Omit entirely to hide the header's Duplicate button — same convention as EventPopover's own onDuplicate. */
  onDuplicate?: () => void;
  onViewInstructor: (instructorId: number) => void;
}

const ICON_COLOR = 'var(--sched-accent)';
const POPOVER_MARGIN_PX = 12;

/**
 * A click-to-view popover for an UnplacedClass chip in
 * UnplacedClassesDrawer.tsx — deliberately its own component rather than
 * EventPopover.tsx directly (that one is tightly coupled to a real placed
 * SchedulerEvent's own start/end/resourceId/recurrence/pinned/
 * classRequestId, none of which a not-yet-placed class has), but reuses
 * every piece of EventPopover.tsx that doesn't actually depend on those —
 * the same read-only row layout/icons/fallback text, the same
 * ClassEditModal shell, the same Room needs/Delivery pill vocabulary and
 * mutual-exclusivity mutation rules (toggleRoomNeedValue/addRoomNeedValue/
 * toggleDeliveryFormatValue/getRoomNeedPills), and the same header action
 * icons — Edit/Duplicate/Delete/Close — for the fields both kinds of class
 * genuinely share. The only header actions that DON'T carry over are Pin
 * (nothing to pin in time yet) and "Move to classes bin" (this class is
 * already there); the only edit-modal fields that don't carry over are
 * Repeat/Ends (no date to recur on yet).
 */
export function UnplacedClassPopover({
  item,
  anchorRect,
  color,
  instructors,
  classTypes,
  resources,
  onClose,
  onEdit,
  onDismiss,
  onDuplicate,
  onViewInstructor,
}: UnplacedClassPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const open = item !== null && anchorRect !== null;

  useLayoutEffect(() => {
    if (!open || !anchorRect || !rootRef.current) {
      setPosition(null);
      return;
    }
    const root = rootRef.current;
    function recomputePosition() {
      const rect = root.getBoundingClientRect();
      let left = anchorRect!.right + POPOVER_MARGIN_PX;
      if (left + rect.width > window.innerWidth - POPOVER_MARGIN_PX) {
        left = anchorRect!.left - rect.width - POPOVER_MARGIN_PX;
      }
      left = Math.max(POPOVER_MARGIN_PX, Math.min(left, window.innerWidth - rect.width - POPOVER_MARGIN_PX));
      const top = Math.max(POPOVER_MARGIN_PX, Math.min(anchorRect!.top, window.innerHeight - rect.height - POPOVER_MARGIN_PX));
      setPosition({ top, left });
    }
    recomputePosition();
    // Re-clamps whenever the popover's own rendered size actually changes —
    // e.g. the edit modal opening, or the room-needs row expanding — same
    // reasoning as EventPopover.tsx's own identical ResizeObserver.
    const observer = new ResizeObserver(recomputePosition);
    observer.observe(root);
    return () => observer.disconnect();
  }, [open, anchorRect, item?.id]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (rootRef.current?.contains(target)) return;
      // InstructorViewDialog renders as a sibling, not a descendant, of this
      // popover (opening it from the "View instructor" button below closes
      // this one outright — see Scheduler.tsx's own
      // handleViewInstructorFromUnplacedPopover — but the fade between the
      // two shouldn't read as "clicked away from this").
      if (target.closest('[data-instructor-dialog]')) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || !item || !anchorRect) return null;

  return (
    <div
      ref={rootRef}
      className={styles.popover}
      style={{ top: position?.top ?? anchorRect.top, left: position?.left ?? anchorRect.right + POPOVER_MARGIN_PX }}
      role="dialog"
      aria-label={item.title || 'Unplaced class details'}
    >
      {/* Keyed by id so switching to a different bin item (without the
          popover ever fully unmounting via `open`) resets in-progress
          title/note drafts and the room-needs row's own expand/collapse
          state — same reasoning as EventPopover.tsx's own identical key on
          EventPopoverContent. */}
      <UnplacedClassPopoverContent
        key={item.id}
        item={item}
        color={color}
        instructors={instructors}
        classTypes={classTypes}
        resources={resources}
        onClose={onClose}
        onEdit={onEdit}
        onDismiss={onDismiss}
        onDuplicate={onDuplicate}
        onViewInstructor={onViewInstructor}
      />
    </div>
  );
}

function UnplacedClassPopoverContent({
  item,
  color,
  instructors,
  classTypes,
  resources,
  onClose,
  onEdit,
  onDismiss,
  onDuplicate,
  onViewInstructor,
}: Omit<UnplacedClassPopoverProps, 'anchorRect'> & { item: UnplacedClass }) {
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Only Title/Note need a draft (applies on modal close, not per-keystroke)
  // — every other field applies live the instant it's changed, same split as
  // EventPopover.tsx's own titleDraft/noteDraft vs. its other fields.
  const [titleDraft, setTitleDraft] = useState(item.title);
  const [noteDraft, setNoteDraft] = useState(item.note ?? '');
  // Purely a display toggle for the read-only "Room needs" row below (see
  // ROOM_NEEDS_COLLAPSED_COUNT) — mirrors EventPopover.tsx's own identical
  // state.
  const [roomNeedsRowExpanded, setRoomNeedsRowExpanded] = useState(false);

  function commitTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== item.title) onEdit({ title: trimmed });
    else setTitleDraft(item.title);
  }

  function commitNote() {
    const trimmed = noteDraft.trim();
    if (trimmed !== (item.note ?? '').trim()) onEdit({ note: trimmed || undefined });
  }

  function closeEditModal() {
    commitTitle();
    commitNote();
    setEditModalOpen(false);
  }

  function cancelEditModal() {
    setTitleDraft(item.title);
    setNoteDraft(item.note ?? '');
    setEditModalOpen(false);
  }

  // Same mutation rules as EventPopover.tsx's own toggleRoomNeed/addRoomNeed/
  // toggleDeliveryFormat (see toggleRoomNeedValue's own doc comment) — just
  // applied through a plain onEdit rather than editClassField, since there's
  // no other placed occurrence of a not-yet-placed class to scope a change
  // across.
  function toggleRoomNeed(need: string) {
    onEdit({ roomNeeds: toggleRoomNeedValue(item.roomNeeds, need) });
  }

  function addRoomNeed(name: string) {
    onEdit({ roomNeeds: addRoomNeedValue(item.roomNeeds, name) });
  }

  function toggleDeliveryFormat(format: string) {
    onEdit({ deliveryFormats: toggleDeliveryFormatValue(item.deliveryFormats, format) });
  }

  const roomNeedPills = getRoomNeedPills(resources, item.roomNeeds);

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
          {onDuplicate && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onDuplicate}
              aria-label="Duplicate class"
              title="Duplicate — adds a copy to the classes bin"
            >
              <Copy size={19} />
            </button>
          )}
          <button
            type="button"
            className={styles.iconButton}
            onClick={onDismiss}
            aria-label="Remove from classes bin"
            title="Remove from classes bin"
          >
            <Trash2 size={19} />
          </button>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className={styles.headerTitleRow}>
          <span className={styles.colorDot} style={{ background: color }} aria-hidden="true" />
          <h3 className={styles.title}>{item.title}</h3>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.dateTimeLine}>{item.durationMinutes} min · not yet placed</div>

        <button
          type="button"
          className={[styles.row, styles.instructorRow].join(' ')}
          onClick={() => onViewInstructor(item.instructorId)}
          aria-label={`View ${item.instructorName}`}
          title="View instructor"
        >
          <span className={styles.instructorIconStack}>
            <PersonIcon size={16} color={ICON_COLOR} className={styles.instructorIconDefault} />
            <Eye size={16} color={ICON_COLOR} strokeWidth={1.6} className={styles.instructorIconHover} />
          </span>
          <span className={styles.readOnlyRowText}>{item.instructorName}</span>
        </button>

        <div className={styles.row}>
          <DomainIcon size={16} color={ICON_COLOR} />
          <span className={styles.readOnlyRowText}>{item.type || 'No domain set'}</span>
        </div>

        <div className={styles.row}>
          <DeliveryIcon size={16} color={ICON_COLOR} />
          <span className={styles.readOnlyRowText}>{(item.deliveryFormats ?? []).join(', ') || 'No delivery mode set'}</span>
        </div>

        <div className={[styles.row, styles.rowAlignStart].join(' ')}>
          <ClipboardList size={16} color={ICON_COLOR} aria-hidden="true" style={{ marginTop: 2 }} />
          {(item.roomNeeds ?? []).length === 0 ? (
            <span className={styles.readOnlyRowText}>No room needs set</span>
          ) : (
            <div className={styles.readOnlyRowStack}>
              {(roomNeedsRowExpanded ? item.roomNeeds! : item.roomNeeds!.slice(0, ROOM_NEEDS_COLLAPSED_COUNT)).map((need) => (
                <span key={need} className={styles.readOnlyRowText}>
                  {need}
                </span>
              ))}
              {item.roomNeeds!.length > ROOM_NEEDS_COLLAPSED_COUNT && (
                <button type="button" className={styles.expandRowButton} onClick={() => setRoomNeedsRowExpanded((expanded) => !expanded)}>
                  {roomNeedsRowExpanded ? 'Show less' : `+${item.roomNeeds!.length - ROOM_NEEDS_COLLAPSED_COUNT} more`}
                </button>
              )}
            </div>
          )}
        </div>

        <div className={styles.row}>
          <Users size={16} color={ICON_COLOR} aria-hidden="true" />
          <span className={styles.readOnlyRowText}>
            {item.maxParticipation != null ? `${item.maxParticipation} participants` : 'No capacity set'}
          </span>
        </div>

        <div className={styles.row}>
          <IntensityIcon size={16} color={ICON_COLOR} />
          <span className={styles.readOnlyRowText}>{item.intensity || 'Not set'}</span>
        </div>

        <div className={[styles.row, styles.rowAlignStart].join(' ')}>
          <StickyNote size={16} color={ICON_COLOR} strokeWidth={1.6} aria-hidden="true" style={{ marginTop: 2 }} />
          {item.note?.trim() ? <p className={styles.noteText}>{item.note.trim()}</p> : <p className={styles.noteEmptyText}>No note added</p>}
        </div>
      </div>

      <ClassEditModal open={editModalOpen} title={item.title || '(No title)'} onClose={closeEditModal} onCancel={cancelEditModal}>
        <div className={styles.modalField}>
          <label className={styles.modalFieldLabel} htmlFor="unplaced-edit-title">
            Title
          </label>
          <input
            id="unplaced-edit-title"
            type="text"
            className={styles.modalTextInput}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            // Deliberately NOT onBlur={commitTitle} — same reasoning as
            // EventPopover.tsx's own identical Title field: Cancel needs the
            // draft to still be discardable a tick after this blurs.
          />
        </div>

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Instructor</span>
          <SearchableSelect
            value={item.instructorId}
            options={[
              ...(!instructors.some((i) => i.id === item.instructorId)
                ? [{ value: item.instructorId, label: item.instructorName }]
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
            value={item.type ?? ''}
            options={[
              ...(item.type && !classTypes.some((ct) => ct.name === item.type) ? [{ value: item.type, label: item.type }] : []),
              ...classTypes.map((classType) => ({ value: classType.name, label: classType.name })),
            ]}
            onChange={(type) => onEdit({ type })}
            ariaLabel="Domain"
            searchPlaceholder="Search domains…"
            variant="plain"
          />
        </div>

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Delivery</span>
          <NeedsPillGrid
            options={DELIVERY_FORMAT_OPTIONS}
            optionTitles={DELIVERY_FORMAT_TITLES}
            selected={item.deliveryFormats ?? []}
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
              (item.roomNeeds ?? []).includes(NO_ROOM_FEATURES) ? needsPillGridStyles.needListItemSelected : '',
            ]
              .join(' ')
              .trim()}
            aria-pressed={(item.roomNeeds ?? []).includes(NO_ROOM_FEATURES)}
            onClick={() => toggleRoomNeed(NO_ROOM_FEATURES)}
          >
            {NO_ROOM_FEATURES}
          </button>
          <NeedsPillGrid
            options={roomNeedPills}
            selected={item.roomNeeds ?? []}
            onToggle={toggleRoomNeed}
            onAddNew={addRoomNeed}
            variant="list"
            addLabel="+ Add need"
            newPlaceholder="New room need"
          />
        </div>

        <div className={styles.modalField}>
          <label className={styles.modalFieldLabel} htmlFor="unplaced-edit-capacity">
            Capacity
          </label>
          <input
            id="unplaced-edit-capacity"
            type="number"
            min={1}
            className={styles.modalTextInput}
            value={item.maxParticipation ?? ''}
            placeholder="e.g. 20"
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onEdit({ maxParticipation: undefined });
                return;
              }
              const count = Number(raw);
              if (!Number.isFinite(count) || count < 1) return;
              onEdit({ maxParticipation: count });
            }}
          />
        </div>

        <div className={styles.modalField}>
          <span className={styles.modalFieldLabel}>Intensity</span>
          <SearchableSelect
            value={item.intensity ?? ''}
            options={[
              { value: '', label: 'Not set' },
              ...INTENSITY_OPTIONS.map((option) => ({ value: option, label: option })),
            ]}
            onChange={(value) => onEdit({ intensity: value || undefined })}
            ariaLabel="Intensity"
            variant="plain"
          />
        </div>

        <div className={styles.modalField}>
          <label className={styles.modalFieldLabel} htmlFor="unplaced-edit-note">
            Note
          </label>
          <textarea
            id="unplaced-edit-note"
            className={styles.modalTextarea}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            // Deliberately NOT onBlur={commitNote} — same reasoning as
            // EventPopover.tsx's own identical Note field: Cancel needs the
            // draft to still be discardable a tick after this blurs.
            placeholder="Add a note…"
          />
        </div>
      </ClassEditModal>
    </>
  );
}
