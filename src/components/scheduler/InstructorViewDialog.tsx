import { useEffect, useState, type ReactNode } from 'react';
import { Calendar, Check, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { formatMinutesOfDay } from './utils/dateMath';
import { initialsFor } from './utils/initials';
import { SearchableSelect } from './SearchableSelect';
import type { InstructorAvailabilityBlock, InstructorOption, SchedulerDayOfWeek, SchedulerEvent } from './Scheduler.types';
import styles from './InstructorViewDialog.module.css';

const DAYS_OF_WEEK: SchedulerDayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Either "viewing/editing an existing instructor" (by id, not a snapshot
 * object — view mode saves each field immediately and keeps displaying it
 * live while the dialog stays open, which a captured-at-open-time object
 * couldn't reflect once `instructors` changes) or "filling out a brand new
 * one". Mirrors RoomModalState's own {mode:'add'}|{mode:'edit',...} shape,
 * except RoomModal's own edit mode batches all changes into one final Save
 * instead of writing through per field, so a snapshot is fine there.
 */
export type InstructorDialogState = { mode: 'view'; instructorId: number } | { mode: 'add' };

export interface InstructorViewDialogProps {
  state: InstructorDialogState | null;
  events: SchedulerEvent[];
  /** Only read in 'add' mode, to compute the new instructor's id (highest existing id + 1). */
  instructors: InstructorOption[];
  onClose: () => void;
  onEdit: (updates: Partial<Omit<InstructorOption, 'id'>>) => void;
  onAdd: (instructor: InstructorOption) => void;
}

/**
 * The one centered-modal (backdrop + card) pattern in the scheduler — every
 * other overlay here is either a side drawer or (the event popover)
 * anchored to a specific event. A modal fits better for "look up an
 * instructor" since it's opened from three different, unrelated places (the
 * event popover, the settings drawer's instructor list, and CreateFab's "Add
 * instructor").
 */
export function InstructorViewDialog({ state, events, instructors, onClose, onEdit, onAdd }: InstructorViewDialogProps) {
  useEffect(() => {
    if (!state) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, onClose]);

  // Derived live from `instructors` on every render (not captured once at
  // open time) — view mode saves each field immediately via onEdit and
  // keeps displaying `instructor.foo` afterward, which needs a reference
  // that actually reflects the latest saved value.
  const viewInstructor = state?.mode === 'view' ? instructors.find((i) => i.id === state.instructorId) ?? null : null;

  if (!state || (state.mode === 'view' && !viewInstructor)) return null;

  return (
    // data-instructor-dialog: lets EventPopover's own click-outside listener
    // recognize a click in here as "not actually outside" — this dialog
    // renders as a sibling, not a descendant, of that popover (it can be
    // opened from the settings drawer's instructor list too, not just from
    // an event), so without this its close button reads as an outside click
    // and closes the event popover underneath along with it.
    <div className={styles.backdrop} data-instructor-dialog onClick={onClose}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === 'add' ? 'Add instructor' : `${viewInstructor!.name} — instructor details`}
      >
        {state.mode === 'add' ? (
          // No key needed here — 'add' never remounts to a different instructor mid-flight the way 'view' can.
          <AddInstructorForm instructors={instructors} onClose={onClose} onAdd={onAdd} />
        ) : (
          // Keyed by id so switching to a different instructor resets in-progress edits (rename draft, add-block form) via remount rather than an effect.
          <InstructorViewContent key={viewInstructor!.id} instructor={viewInstructor!} events={events} onClose={onClose} onEdit={onEdit} />
        )}
      </div>
    </div>
  );
}

/** One Scheduling-Preferences-style row: a label, its current value (or an inline edit control in place of it), and a pencil/save/cancel affordance — shared by all four preference fields to avoid repeating the same edit-toggle markup four times over. */
function PrefRow({
  label,
  value,
  editing,
  input,
  onStartEdit,
  onSave,
  onCancel,
}: {
  label: string;
  value: ReactNode;
  editing: boolean;
  input: ReactNode;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.boxRow}>
      <span className={styles.prefLabel}>{label}</span>
      {editing ? (
        <>
          {input}
          <button type="button" className={styles.inlineSaveButton} onClick={onSave} aria-label={`Save ${label}`} title="Save changes">
            <Check size={18} />
          </button>
          <button
            type="button"
            className={styles.inlineCancelButton}
            onClick={onCancel}
            aria-label={`Cancel editing ${label}`}
            title="Cancel editing"
          >
            <X size={18} />
          </button>
        </>
      ) : (
        <>
          <span className={styles.prefValue}>{value}</span>
          <button type="button" className={styles.moreButton} onClick={onStartEdit} aria-label={`Edit ${label}`} title={`Edit ${label}`}>
            <Pencil size={16} />
          </button>
        </>
      )}
    </div>
  );
}

type EditableFieldKey = 'maxWeek' | 'maxDay' | 'consecutive' | 'gap' | 'anythingElse';

function InstructorViewContent({
  instructor,
  events,
  onClose,
  onEdit,
}: {
  instructor: InstructorOption;
  events: SchedulerEvent[];
  onClose: () => void;
  onEdit: (updates: Partial<Omit<InstructorOption, 'id'>>) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(instructor.name);
  const [newDay, setNewDay] = useState<SchedulerDayOfWeek>('Monday');
  const [newStartMinutes, setNewStartMinutes] = useState(9 * 60);
  const [newEndMinutes, setNewEndMinutes] = useState(17 * 60);
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
  const [editDraftStartMinutes, setEditDraftStartMinutes] = useState(9 * 60);
  const [editDraftEndMinutes, setEditDraftEndMinutes] = useState(17 * 60);

  // Scheduling Preferences — one shared "which field, if any" tracker (only
  // one of these four can be mid-edit at a time) plus a draft per field,
  // mirroring editingName/nameDraft above but generalized to four fields
  // instead of duplicating that pattern four times over.
  const [editingField, setEditingField] = useState<EditableFieldKey | null>(null);
  const [maxWeekDraft, setMaxWeekDraft] = useState('');
  const [maxDayDraft, setMaxDayDraft] = useState('');
  const [consecutiveDraft, setConsecutiveDraft] = useState('');
  const [gapDraft, setGapDraft] = useState('');
  const [anythingElseDraft, setAnythingElseDraft] = useState('');

  // Blocked-Out Dates — its own add/edit/delete list, separate from
  // availability's (different shape: plain strings, not day+hour blocks).
  const [editingDateIndex, setEditingDateIndex] = useState<number | null>(null);
  const [dateDraft, setDateDraft] = useState('');
  const [newBlockedDate, setNewBlockedDate] = useState('');

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
    if (newEndMinutes <= newStartMinutes) return;
    const block: InstructorAvailabilityBlock = { day: newDay, startMinutes: newStartMinutes, endMinutes: newEndMinutes };
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
    // Exact minutes, not rounded to the hour — rounding here used to
    // silently overwrite e.g. a form's 9:40 with 9:00 on any Save.
    setEditDraftStartMinutes(block.startMinutes);
    setEditDraftEndMinutes(block.endMinutes);
    setEditingBlockIndex(index);
    setOpenMenuIndex(null);
  }

  function handleSaveEditBlock(index: number) {
    if (editDraftEndMinutes <= editDraftStartMinutes) return;
    const updated: InstructorAvailabilityBlock = {
      day: editDraftDay,
      startMinutes: editDraftStartMinutes,
      endMinutes: editDraftEndMinutes,
    };
    onEdit({ availability: instructor.availability.map((b, i) => (i === index ? updated : b)) });
    setEditingBlockIndex(null);
  }

  function startEditField(field: EditableFieldKey) {
    if (field === 'maxWeek') setMaxWeekDraft(instructor.maxSessionsPerWeek != null ? String(instructor.maxSessionsPerWeek) : '');
    if (field === 'maxDay') setMaxDayDraft(instructor.maxSessionsPerDay != null ? String(instructor.maxSessionsPerDay) : '');
    if (field === 'consecutive') setConsecutiveDraft(instructor.consecutiveComfort ?? '');
    if (field === 'gap') setGapDraft(instructor.preferredGapMinutes != null ? String(instructor.preferredGapMinutes) : '');
    if (field === 'anythingElse') setAnythingElseDraft(instructor.anythingElse ?? '');
    setEditingField(field);
  }

  function saveEditField(field: EditableFieldKey) {
    if (field === 'maxWeek') onEdit({ maxSessionsPerWeek: maxWeekDraft.trim() ? Number(maxWeekDraft) : null });
    if (field === 'maxDay') onEdit({ maxSessionsPerDay: maxDayDraft.trim() ? Number(maxDayDraft) : null });
    if (field === 'consecutive') onEdit({ consecutiveComfort: consecutiveDraft.trim() });
    if (field === 'gap') onEdit({ preferredGapMinutes: gapDraft.trim() ? Number(gapDraft) : null });
    if (field === 'anythingElse') onEdit({ anythingElse: anythingElseDraft.trim() });
    setEditingField(null);
  }

  function handleAddBlockedDate() {
    const trimmed = newBlockedDate.trim();
    if (!trimmed) return;
    onEdit({ blockedOutDates: [...(instructor.blockedOutDates ?? []), trimmed] });
    setNewBlockedDate('');
  }

  function handleStartEditBlockedDate(index: number) {
    setDateDraft(instructor.blockedOutDates?.[index] ?? '');
    setEditingDateIndex(index);
  }

  function handleSaveBlockedDate(index: number) {
    const trimmed = dateDraft.trim();
    if (!trimmed) return;
    onEdit({ blockedOutDates: (instructor.blockedOutDates ?? []).map((d, i) => (i === index ? trimmed : d)) });
    setEditingDateIndex(null);
  }

  function handleRemoveBlockedDate(index: number) {
    onEdit({ blockedOutDates: (instructor.blockedOutDates ?? []).filter((_, i) => i !== index) });
    if (editingDateIndex === index) setEditingDateIndex(null);
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
                    <SearchableSelect
                      value={editDraftDay}
                      options={DAYS_OF_WEEK.map((day) => ({ value: day, label: day }))}
                      onChange={setEditDraftDay}
                      ariaLabel="Day"
                      variant="plain"
                      searchThreshold={DAYS_OF_WEEK.length}
                    />
                    <TimeRangePicker
                      startMinutes={editDraftStartMinutes}
                      endMinutes={editDraftEndMinutes}
                      onStartChange={setEditDraftStartMinutes}
                      onEndChange={setEditDraftEndMinutes}
                    />
                    <button
                      type="button"
                      className={styles.inlineSaveButton}
                      onClick={() => handleSaveEditBlock(i)}
                      disabled={editDraftEndMinutes <= editDraftStartMinutes}
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
                      {formatMinutesOfDay(block.startMinutes)} – {formatMinutesOfDay(block.endMinutes)}
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
            <SearchableSelect
              value={newDay}
              options={DAYS_OF_WEEK.map((day) => ({ value: day, label: day }))}
              onChange={setNewDay}
              ariaLabel="Day"
              variant="plain"
              searchThreshold={DAYS_OF_WEEK.length}
            />
            <TimeRangePicker
              startMinutes={newStartMinutes}
              endMinutes={newEndMinutes}
              onStartChange={setNewStartMinutes}
              onEndChange={setNewEndMinutes}
            />
            <button
              type="button"
              className={styles.addButtonGhost}
              onClick={handleAddBlock}
              disabled={newEndMinutes <= newStartMinutes}
              aria-label="Add availability block"
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Scheduling Preferences</h3>
          <div className={styles.boxList}>
            <PrefRow
              label="Max classes / week"
              value={instructor.maxSessionsPerWeek ?? 'No stated cap'}
              editing={editingField === 'maxWeek'}
              onStartEdit={() => startEditField('maxWeek')}
              onSave={() => saveEditField('maxWeek')}
              onCancel={() => setEditingField(null)}
              input={
                <input
                  className={styles.inlineNumberInput}
                  type="number"
                  min={0}
                  autoFocus
                  value={maxWeekDraft}
                  onChange={(e) => setMaxWeekDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEditField('maxWeek');
                    if (e.key === 'Escape') setEditingField(null);
                  }}
                />
              }
            />
            <PrefRow
              label="Max classes / day"
              value={instructor.maxSessionsPerDay ?? 'No stated cap'}
              editing={editingField === 'maxDay'}
              onStartEdit={() => startEditField('maxDay')}
              onSave={() => saveEditField('maxDay')}
              onCancel={() => setEditingField(null)}
              input={
                <input
                  className={styles.inlineNumberInput}
                  type="number"
                  min={0}
                  autoFocus
                  value={maxDayDraft}
                  onChange={(e) => setMaxDayDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEditField('maxDay');
                    if (e.key === 'Escape') setEditingField(null);
                  }}
                />
              }
            />
            <PrefRow
              label="Consecutive classes"
              value={instructor.consecutiveComfort || 'Not specified'}
              editing={editingField === 'consecutive'}
              onStartEdit={() => startEditField('consecutive')}
              onSave={() => saveEditField('consecutive')}
              onCancel={() => setEditingField(null)}
              input={
                <input
                  className={styles.inlineTextInput}
                  type="text"
                  autoFocus
                  value={consecutiveDraft}
                  placeholder="e.g. Comfortable with back-to-back"
                  onChange={(e) => setConsecutiveDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEditField('consecutive');
                    if (e.key === 'Escape') setEditingField(null);
                  }}
                />
              }
            />
            <PrefRow
              label="Time between classes"
              value={instructor.preferredGapMinutes != null ? `${instructor.preferredGapMinutes} min` : 'Not specified'}
              editing={editingField === 'gap'}
              onStartEdit={() => startEditField('gap')}
              onSave={() => saveEditField('gap')}
              onCancel={() => setEditingField(null)}
              input={
                <input
                  className={styles.inlineNumberInput}
                  type="number"
                  min={0}
                  autoFocus
                  value={gapDraft}
                  onChange={(e) => setGapDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEditField('gap');
                    if (e.key === 'Escape') setEditingField(null);
                  }}
                />
              }
            />
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Blocked-Out Dates</h3>
          {!instructor.blockedOutDates || instructor.blockedOutDates.length === 0 ? (
            <p className={styles.emptyState}>None stated</p>
          ) : (
            <div className={styles.boxList}>
              {instructor.blockedOutDates.map((date, i) =>
                editingDateIndex === i ? (
                  <div key={i} className={styles.boxRow}>
                    <input
                      className={styles.inlineTextInput}
                      type="text"
                      autoFocus
                      value={dateDraft}
                      onChange={(e) => setDateDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveBlockedDate(i);
                        if (e.key === 'Escape') setEditingDateIndex(null);
                      }}
                    />
                    <button
                      type="button"
                      className={styles.inlineSaveButton}
                      onClick={() => handleSaveBlockedDate(i)}
                      aria-label="Save changes"
                      title="Save changes"
                    >
                      <Check size={18} />
                    </button>
                    <button
                      type="button"
                      className={styles.inlineCancelButton}
                      onClick={() => setEditingDateIndex(null)}
                      aria-label="Cancel editing"
                      title="Cancel editing"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ) : (
                  <div key={i} className={styles.boxRow}>
                    <span className={styles.prefValue} style={{ flex: 1, textAlign: 'left' }}>{date}</span>
                    <button
                      type="button"
                      className={styles.moreButton}
                      onClick={() => handleStartEditBlockedDate(i)}
                      aria-label="Edit blocked-out date"
                      title="Edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className={styles.moreButton}
                      onClick={() => handleRemoveBlockedDate(i)}
                      aria-label="Remove blocked-out date"
                      title="Remove"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ),
              )}
            </div>
          )}

          <div className={styles.addRowBox}>
            <Calendar size={16} className={styles.calendarIcon} aria-hidden="true" />
            <input
              className={styles.inlineTextInput}
              type="text"
              value={newBlockedDate}
              placeholder="e.g. Dec 22 – Jan 2"
              onChange={(e) => setNewBlockedDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddBlockedDate();
              }}
            />
            <button type="button" className={styles.addButtonGhost} onClick={handleAddBlockedDate} aria-label="Add blocked-out date">
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Anything Else</h3>
          {editingField === 'anythingElse' ? (
            <>
              <textarea
                className={styles.textareaInput}
                autoFocus
                value={anythingElseDraft}
                onChange={(e) => setAnythingElseDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingField(null);
                }}
              />
              <div className={styles.addRowBox} style={{ justifyContent: 'flex-end', border: 'none', padding: 0 }}>
                <button
                  type="button"
                  className={styles.inlineSaveButton}
                  onClick={() => saveEditField('anythingElse')}
                  aria-label="Save changes"
                  title="Save changes"
                >
                  <Check size={20} />
                </button>
                <button
                  type="button"
                  className={styles.inlineCancelButton}
                  onClick={() => setEditingField(null)}
                  aria-label="Cancel editing"
                  title="Cancel editing"
                >
                  <X size={20} />
                </button>
              </div>
            </>
          ) : (
            <div className={styles.boxRow} style={{ alignItems: 'flex-start' }}>
              {instructor.anythingElse ? (
                <p className={styles.freeTextNote} style={{ flex: 1 }}>{instructor.anythingElse}</p>
              ) : (
                <p className={styles.emptyState} style={{ flex: 1 }}>Nothing noted</p>
              )}
              <button
                type="button"
                className={styles.moreButton}
                onClick={() => startEditField('anythingElse')}
                aria-label="Edit anything else"
                title="Edit"
              >
                <Pencil size={16} />
              </button>
            </div>
          )}
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
 * "Add instructor" — same visual sections/CSS as InstructorViewContent, but
 * every field is a plain, always-visible input from the start (no
 * pencil-toggle dance, since there's nothing to "view" yet) with local draft
 * state for everything, submitted once via the footer's "Create instructor"
 * button rather than per-field like the view/edit dialog does.
 */
function AddInstructorForm({
  instructors,
  onClose,
  onAdd,
}: {
  instructors: InstructorOption[];
  onClose: () => void;
  onAdd: (instructor: InstructorOption) => void;
}) {
  const [name, setName] = useState('');
  const [availability, setAvailability] = useState<InstructorAvailabilityBlock[]>([]);
  const [newDay, setNewDay] = useState<SchedulerDayOfWeek>('Monday');
  const [newStartMinutes, setNewStartMinutes] = useState(9 * 60);
  const [newEndMinutes, setNewEndMinutes] = useState(17 * 60);
  const [maxSessionsPerWeek, setMaxSessionsPerWeek] = useState('');
  const [maxSessionsPerDay, setMaxSessionsPerDay] = useState('');
  const [consecutiveComfort, setConsecutiveComfort] = useState('');
  const [preferredGapMinutes, setPreferredGapMinutes] = useState('');
  const [blockedOutDates, setBlockedOutDates] = useState<string[]>([]);
  const [newBlockedDate, setNewBlockedDate] = useState('');
  const [anythingElse, setAnythingElse] = useState('');

  function handleAddBlock() {
    if (newEndMinutes <= newStartMinutes) return;
    setAvailability((current) => [...current, { day: newDay, startMinutes: newStartMinutes, endMinutes: newEndMinutes }]);
  }

  function handleRemoveBlock(index: number) {
    setAvailability((current) => current.filter((_, i) => i !== index));
  }

  function handleAddBlockedDate() {
    const trimmed = newBlockedDate.trim();
    if (!trimmed) return;
    setBlockedOutDates((current) => [...current, trimmed]);
    setNewBlockedDate('');
  }

  function handleRemoveBlockedDate(index: number) {
    setBlockedOutDates((current) => current.filter((_, i) => i !== index));
  }

  function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const nextId = instructors.length > 0 ? Math.max(...instructors.map((i) => i.id)) + 1 : 1;
    onAdd({
      id: nextId,
      name: trimmedName,
      availability,
      maxSessionsPerWeek: maxSessionsPerWeek.trim() ? Number(maxSessionsPerWeek) : null,
      maxSessionsPerDay: maxSessionsPerDay.trim() ? Number(maxSessionsPerDay) : null,
      consecutiveComfort: consecutiveComfort.trim() || undefined,
      preferredGapMinutes: preferredGapMinutes.trim() ? Number(preferredGapMinutes) : null,
      blockedOutDates,
      anythingElse: anythingElse.trim() || undefined,
    });
    onClose();
  }

  return (
    <>
      <div className={styles.header}>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
      </div>

      <div className={styles.identity}>
        <div className={styles.avatar}>{name.trim() ? initialsFor(name) : '?'}</div>
        <div className={styles.identityText}>
          <div className={styles.nameEditRow}>
            <input
              className={styles.nameInput}
              value={name}
              autoFocus
              placeholder="Instructor name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <span className={styles.roleLabel}>New Instructor</span>
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Weekly Availability</h3>
          {availability.length === 0 ? (
            <p className={styles.emptyState}>No availability set</p>
          ) : (
            <div className={styles.boxList}>
              {availability.map((block, i) => (
                <div key={i} className={styles.boxRow}>
                  <span className={styles.statusDot} />
                  <span className={styles.dayName}>{block.day}</span>
                  <span className={styles.timeRange}>
                    {formatMinutesOfDay(block.startMinutes)} – {formatMinutesOfDay(block.endMinutes)}
                  </span>
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() => handleRemoveBlock(i)}
                    aria-label="Remove availability block"
                    title="Remove"
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.addRowBox}>
            <Calendar size={16} className={styles.calendarIcon} aria-hidden="true" />
            <SearchableSelect
              value={newDay}
              options={DAYS_OF_WEEK.map((day) => ({ value: day, label: day }))}
              onChange={setNewDay}
              ariaLabel="Day"
              variant="plain"
              searchThreshold={DAYS_OF_WEEK.length}
            />
            <TimeRangePicker
              startMinutes={newStartMinutes}
              endMinutes={newEndMinutes}
              onStartChange={setNewStartMinutes}
              onEndChange={setNewEndMinutes}
            />
            <button
              type="button"
              className={styles.addButtonGhost}
              onClick={handleAddBlock}
              disabled={newEndMinutes <= newStartMinutes}
              aria-label="Add availability block"
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Scheduling Preferences</h3>
          <div className={styles.boxList}>
            <div className={styles.boxRow}>
              <span className={styles.prefLabel}>Max classes / week</span>
              <input
                className={styles.inlineNumberInput}
                type="number"
                min={0}
                value={maxSessionsPerWeek}
                placeholder="No cap"
                onChange={(e) => setMaxSessionsPerWeek(e.target.value)}
              />
            </div>
            <div className={styles.boxRow}>
              <span className={styles.prefLabel}>Max classes / day</span>
              <input
                className={styles.inlineNumberInput}
                type="number"
                min={0}
                value={maxSessionsPerDay}
                placeholder="No cap"
                onChange={(e) => setMaxSessionsPerDay(e.target.value)}
              />
            </div>
            <div className={styles.boxRow}>
              <span className={styles.prefLabel}>Consecutive classes</span>
              <input
                className={styles.inlineTextInput}
                type="text"
                value={consecutiveComfort}
                placeholder="e.g. Comfortable with back-to-back"
                onChange={(e) => setConsecutiveComfort(e.target.value)}
              />
            </div>
            <div className={styles.boxRow}>
              <span className={styles.prefLabel}>Time between classes</span>
              <input
                className={styles.inlineNumberInput}
                type="number"
                min={0}
                value={preferredGapMinutes}
                placeholder="Minutes"
                onChange={(e) => setPreferredGapMinutes(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Blocked-Out Dates</h3>
          {blockedOutDates.length === 0 ? (
            <p className={styles.emptyState}>None stated</p>
          ) : (
            <div className={styles.boxList}>
              {blockedOutDates.map((date, i) => (
                <div key={i} className={styles.boxRow}>
                  <span className={styles.prefValue} style={{ flex: 1, textAlign: 'left' }}>{date}</span>
                  <button
                    type="button"
                    className={styles.moreButton}
                    onClick={() => handleRemoveBlockedDate(i)}
                    aria-label="Remove blocked-out date"
                    title="Remove"
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.addRowBox}>
            <Calendar size={16} className={styles.calendarIcon} aria-hidden="true" />
            <input
              className={styles.inlineTextInput}
              type="text"
              value={newBlockedDate}
              placeholder="e.g. Dec 22 – Jan 2"
              onChange={(e) => setNewBlockedDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddBlockedDate();
              }}
            />
            <button type="button" className={styles.addButtonGhost} onClick={handleAddBlockedDate} aria-label="Add blocked-out date">
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Anything Else</h3>
          <textarea
            className={styles.textareaInput}
            value={anythingElse}
            placeholder="Anything else you'd like to share…"
            onChange={(e) => setAnythingElse(e.target.value)}
          />
        </section>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.footerCreateButton} disabled={!name.trim()} onClick={handleSubmit}>
          Create instructor
        </button>
        <button type="button" className={styles.footerCloseButton} onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}

/**
 * Shared start–end time range control for both an availability row's inline
 * edit form and the "add new" row below it — a single pill (filled
 * background, no border) with a plain-text "to" in the middle instead of a
 * dash, matching SchedulerDrawer's business hours control. Native time
 * inputs (minute precision), not hour dropdowns: form answers can land on
 * any minute (real exports include e.g. 9:43), and an hour-only control
 * both misdisplayed those and rounded them away on Save.
 */
function TimeRangePicker({
  startMinutes,
  endMinutes,
  onStartChange,
  onEndChange,
}: {
  startMinutes: number;
  endMinutes: number;
  onStartChange: (minutes: number) => void;
  onEndChange: (minutes: number) => void;
}) {
  const invalid = endMinutes <= startMinutes;
  return (
    <div className={styles.hourRangeBox}>
      <input
        type="time"
        className={styles.timeInput}
        value={minutesToTimeValue(startMinutes)}
        onChange={(e) => {
          const minutes = timeValueToMinutes(e.target.value);
          if (minutes != null) onStartChange(minutes);
        }}
        aria-label="Availability start"
      />
      <span className={styles.hourRangeTo}>to</span>
      <input
        type="time"
        className={styles.timeInput}
        value={minutesToTimeValue(endMinutes)}
        onChange={(e) => {
          const minutes = timeValueToMinutes(e.target.value);
          if (minutes != null) onEndChange(minutes);
        }}
        aria-label="Availability end"
        aria-invalid={invalid}
        title={invalid ? 'End time must be after the start time' : undefined}
      />
    </div>
  );
}

/** Minutes since midnight -> an <input type="time"> value ("09:40"). */
function minutesToTimeValue(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

/** An <input type="time"> value ("09:40") -> minutes since midnight, or null while the field is cleared/incomplete. */
function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
