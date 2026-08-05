import { useEffect, useState } from 'react';
import { Calendar, Check, ChevronDown, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { formatBusinessHourLabel, formatHourLabel } from './utils/dateMath';
import { initialsFor } from './utils/initials';
import type { InstructorAvailabilityBlock, InstructorOption, SchedulerDayOfWeek, SchedulerEvent } from './Scheduler.types';
import styles from './InstructorViewDialog.module.css';

const DAYS_OF_WEEK: SchedulerDayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export interface InstructorViewDialogProps {
  instructor: InstructorOption | null;
  events: SchedulerEvent[];
  onClose: () => void;
  onEdit: (updates: Partial<Pick<InstructorOption, 'name' | 'availability'>>) => void;
}

/**
 * The one centered-modal (backdrop + card) pattern in the scheduler — every
 * other overlay here is a side drawer. A modal fits better for "look up an
 * instructor" since it's opened from two different, unrelated places (the
 * details drawer and the settings drawer's instructor list) rather than
 * being anchored to a specific timeline selection.
 */
export function InstructorViewDialog({ instructor, events, onClose, onEdit }: InstructorViewDialogProps) {
  useEffect(() => {
    if (!instructor) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [instructor, onClose]);

  if (!instructor) return null;

  return (
    // data-instructor-dialog: lets EventDetailsDrawer's own click-outside
    // listener recognize a click in here as "not actually outside" — this
    // dialog renders as a sibling, not a descendant, of that drawer (it can
    // be opened from the settings drawer's instructor list too, not just
    // from an event), so without this its close button reads as an outside
    // click and closes the event drawer underneath along with it.
    <div className={styles.backdrop} data-instructor-dialog onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${instructor.name} — instructor details`}>
        {/* Keyed by id so switching to a different instructor resets in-progress edits (rename draft, add-block form) via remount rather than an effect. */}
        <InstructorViewContent key={instructor.id} instructor={instructor} events={events} onClose={onClose} onEdit={onEdit} />
      </div>
    </div>
  );
}

function InstructorViewContent({
  instructor,
  events,
  onClose,
  onEdit,
}: {
  instructor: InstructorOption;
  events: SchedulerEvent[];
  onClose: () => void;
  onEdit: (updates: Partial<Pick<InstructorOption, 'name' | 'availability'>>) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(instructor.name);
  const [newDay, setNewDay] = useState<SchedulerDayOfWeek>('Monday');
  const [newStartHour, setNewStartHour] = useState(9);
  const [newEndHour, setNewEndHour] = useState(17);
  // Which availability row's "..." menu (Edit / Delete) is open, if any, and
  // where to render it. Positioned via `fixed` + the button's own measured
  // coordinates (not CSS-relative to the row) so it isn't clipped by — or
  // added to the scrollable height of — .boxList's own overflow: auto; it
  // used to sit inside that scroll area and both of those actually happened.
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  // Which row is being edited in place, and its in-progress draft values.
  const [editingBlockIndex, setEditingBlockIndex] = useState<number | null>(null);
  const [editDraftDay, setEditDraftDay] = useState<SchedulerDayOfWeek>('Monday');
  const [editDraftStartHour, setEditDraftStartHour] = useState(9);
  const [editDraftEndHour, setEditDraftEndHour] = useState(17);

  useEffect(() => {
    if (openMenuIndex === null) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('[data-more-menu]')) return;
      setOpenMenuIndex(null);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openMenuIndex]);

  const instructorEvents = events.filter((e) => e.instructorId === instructor.id);
  const countsByClass = new Map<string, number>();
  for (const e of instructorEvents) countsByClass.set(e.title, (countsByClass.get(e.title) ?? 0) + 1);
  const classCounts = Array.from(countsByClass.entries()).sort(([a], [b]) => a.localeCompare(b));

  function handleToggleEditName() {
    if (editingName) {
      // Clicking the pencil again while already editing cancels, same as Escape.
      setEditingName(false);
      return;
    }
    setNameDraft(instructor.name);
    setEditingName(true);
  }

  function handleSaveName() {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    onEdit({ name: trimmed });
    setEditingName(false);
  }

  function handleAddBlock() {
    const block: InstructorAvailabilityBlock = { day: newDay, startMinutes: newStartHour * 60, endMinutes: newEndHour * 60 };
    onEdit({ availability: [...instructor.availability, block] });
  }

  function handleRemoveBlock(index: number) {
    onEdit({ availability: instructor.availability.filter((_, i) => i !== index) });
    setOpenMenuIndex(null);
    if (editingBlockIndex === index) setEditingBlockIndex(null);
  }

  // Edit and Delete are now distinct: Delete removes immediately; Edit turns
  // this same row into an inline form (day/start/end selects in place of the
  // static text) and only changes anything once its own Save is clicked —
  // previously "Edit" silently removed the row too, which read as "both
  // buttons just delete."
  function handleStartEditBlock(index: number) {
    const block = instructor.availability[index];
    setEditDraftDay(block.day);
    setEditDraftStartHour(Math.floor(block.startMinutes / 60));
    setEditDraftEndHour(Math.floor(block.endMinutes / 60));
    setEditingBlockIndex(index);
    setOpenMenuIndex(null);
  }

  function handleSaveEditBlock(index: number) {
    const updated: InstructorAvailabilityBlock = {
      day: editDraftDay,
      startMinutes: editDraftStartHour * 60,
      endMinutes: editDraftEndHour * 60,
    };
    onEdit({ availability: instructor.availability.map((b, i) => (i === index ? updated : b)) });
    setEditingBlockIndex(null);
  }

  return (
    <>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.editNameButton}
          onClick={handleToggleEditName}
          aria-label={editingName ? 'Cancel editing name' : 'Edit name'}
          title={editingName ? 'Cancel editing name' : 'Edit name'}
        >
          <Pencil size={20} />
        </button>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
      </div>

      <div className={styles.identity}>
        <div className={styles.avatar}>{initialsFor(instructor.name)}</div>
        <div className={styles.identityText}>
          {editingName ? (
            <div className={styles.nameEditRow}>
              <input
                className={styles.nameInput}
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
              />
              <button type="button" className={styles.saveNameButton} onClick={handleSaveName} aria-label="Save name">
                <Check size={20} />
              </button>
              <button
                type="button"
                className={styles.cancelNameButton}
                onClick={() => setEditingName(false)}
                aria-label="Cancel editing name"
              >
                <X size={20} />
              </button>
            </div>
          ) : (
            <h2 className={styles.title}>{instructor.name}</h2>
          )}
          <span className={styles.roleLabel}>Instructor</span>
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Weekly Availability</h3>
          {instructor.availability.length === 0 ? (
            <p className={styles.emptyState}>No availability set</p>
          ) : (
            <div className={styles.boxList}>
              {instructor.availability.map((block, i) =>
                editingBlockIndex === i ? (
                  <div key={i} className={styles.boxRow}>
                    <span className={styles.statusDot} />
                    <select
                      className={styles.daySelect}
                      value={editDraftDay}
                      onChange={(e) => setEditDraftDay(e.target.value as SchedulerDayOfWeek)}
                    >
                      {DAYS_OF_WEEK.map((day) => (
                        <option key={day} value={day}>{day}</option>
                      ))}
                    </select>
                    <HourRangePicker
                      startHour={editDraftStartHour}
                      endHour={editDraftEndHour}
                      onStartChange={setEditDraftStartHour}
                      onEndChange={setEditDraftEndHour}
                    />
                    <button
                      type="button"
                      className={styles.inlineSaveButton}
                      onClick={() => handleSaveEditBlock(i)}
                      aria-label="Save changes"
                      title="Save changes"
                    >
                      <Check size={20} />
                    </button>
                    <button
                      type="button"
                      className={styles.inlineCancelButton}
                      onClick={() => setEditingBlockIndex(null)}
                      aria-label="Cancel editing"
                      title="Cancel editing"
                    >
                      <X size={20} />
                    </button>
                  </div>
                ) : (
                  <div key={i} className={styles.boxRow}>
                    <span className={styles.statusDot} />
                    <span className={styles.dayName}>{block.day}</span>
                    <span className={styles.timeRange}>
                      {formatHourLabel(Math.floor(block.startMinutes / 60))} – {formatHourLabel(Math.floor(block.endMinutes / 60))}
                    </span>
                    <div className={styles.moreMenuWrapper} data-more-menu>
                      <button
                        type="button"
                        className={styles.moreButton}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                          setOpenMenuIndex((current) => (current === i ? null : i));
                        }}
                        aria-label="Availability block options"
                        aria-haspopup="menu"
                        aria-expanded={openMenuIndex === i}
                      >
                        <MoreHorizontal size={22} />
                      </button>
                      {openMenuIndex === i && menuPosition && (
                        <div
                          className={styles.moreMenu}
                          role="menu"
                          style={{ position: 'fixed', top: menuPosition.top, right: menuPosition.right }}
                        >
                          <button
                            type="button"
                            className={styles.moreMenuItem}
                            role="menuitem"
                            onClick={() => handleStartEditBlock(i)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={[styles.moreMenuItem, styles.moreMenuItemDanger].join(' ')}
                            role="menuitem"
                            onClick={() => handleRemoveBlock(i)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}

          <div className={styles.addRowBox}>
            <Calendar size={16} className={styles.calendarIcon} aria-hidden="true" />
            <select className={styles.daySelect} value={newDay} onChange={(e) => setNewDay(e.target.value as SchedulerDayOfWeek)}>
              {DAYS_OF_WEEK.map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
            <HourRangePicker
              startHour={newStartHour}
              endHour={newEndHour}
              onStartChange={setNewStartHour}
              onEndChange={setNewEndHour}
            />
            <button type="button" className={styles.addButtonGhost} onClick={handleAddBlock} aria-label="Add availability block">
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Classes Scheduled</h3>
          {classCounts.length === 0 ? (
            <p className={styles.emptyState}>No classes scheduled yet</p>
          ) : (
            <>
              <div className={styles.boxList}>
                {classCounts.map(([name, count]) => (
                  <div key={name} className={styles.boxRow}>
                    <span className={styles.className}>{name}</span>
                    <span className={styles.countBadge}>{count}</span>
                  </div>
                ))}
              </div>
              <div className={styles.totalBox}>
                <span>Total</span>
                <span className={styles.statValue}>{instructorEvents.length}</span>
              </div>
            </>
          )}
        </section>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.footerCloseButton} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

/**
 * Shared start–end hour range control for both an availability row's inline
 * edit form and the "add new" row below it — a single pill (filled
 * background, no border) with a plain-text "to" in the middle instead of a
 * dash, matching SchedulerDrawer's business hours control.
 */
function HourRangePicker({
  startHour,
  endHour,
  onStartChange,
  onEndChange,
}: {
  startHour: number;
  endHour: number;
  onStartChange: (hour: number) => void;
  onEndChange: (hour: number) => void;
}) {
  return (
    <div className={styles.hourRangeBox}>
      <span className={styles.hourRangeSelectWrapper}>
        <select
          className={styles.hourRangeSelect}
          value={startHour}
          onChange={(e) => onStartChange(Number(e.target.value))}
          aria-label="Availability start"
        >
          {HOURS.filter((h) => h < endHour).map((h) => (
            <option key={h} value={h}>{formatBusinessHourLabel(h)}</option>
          ))}
        </select>
        <ChevronDown className={styles.hourRangeChevron} size={14} />
      </span>
      <span className={styles.hourRangeTo}>to</span>
      <span className={styles.hourRangeSelectWrapper}>
        <select
          className={styles.hourRangeSelect}
          value={endHour}
          onChange={(e) => onEndChange(Number(e.target.value))}
          aria-label="Availability end"
        >
          {HOURS.filter((h) => h > startHour).map((h) => (
            <option key={h} value={h}>{formatBusinessHourLabel(h)}</option>
          ))}
        </select>
        <ChevronDown className={styles.hourRangeChevron} size={14} />
      </span>
    </div>
  );
}
