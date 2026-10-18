import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { formatTimeOfDay, monthLabel, weekdayLabel } from './utils/dateMath';
import { SearchableSelect } from './SearchableSelect';
import { NeedsPillGrid } from './NeedsPillGrid';
import needsPillGridStyles from './NeedsPillGrid.module.css';
import type { ClassTypeOption, InstructorOption, NewEventDraft, PendingSelection, Resource } from './Scheduler.types';
import styles from './EventDetailsDrawer.module.css';

export interface NewEventDrawerProps {
  selection: PendingSelection | null;
  resources: Resource[];
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  /** Lets the "Domain" field create a brand new one inline, instead of only picking from the existing list — same callback/shape SchedulerDrawer's own "Domains" section already uses (see its own onAddClassType), so a domain created here shows up there too. */
  onAddClassType?: (classType: ClassTypeOption) => void;
  onClose: () => void;
  onCreate: (draft: NewEventDraft) => void;
}

function formatRange(start: Date, end: Date): string {
  const date = `${weekdayLabel(start)}, ${monthLabel(start)} ${start.getDate()}, ${start.getFullYear()}`;
  return `${date} · ${formatTimeOfDay(start)} – ${formatTimeOfDay(end)}`;
}

// Sentinel <option> value for "type a brand new domain instead of picking an
// existing one" — never a real domain name (classTypes.some(...) is checked
// before ever treating a typed name as real, so a domain that somehow WAS
// named exactly this couldn't collide with it either).
const NEW_DOMAIN_OPTION_VALUE = '__new_domain__';
// Matches SchedulerDrawer.tsx's own DEFAULT_NEW_CLASS_TYPE_COLOR exactly —
// same "new domain, no color chosen yet" default in both places a domain
// can be created from.
const DEFAULT_NEW_DOMAIN_COLOR = '#4f6df5';

// The one class need that means "there are no specific requirements" rather
// than a real requirement to match a room against (see allocate.ts's own
// NEEDS_ALWAYS_SATISFIED) — same constant/reasoning as EventPopover.tsx's own
// NO_ROOM_FEATURES for its "Room needs" field, mutually exclusive with every
// other need and rendered as its own standalone pill outside the scrollable
// list of actual specific needs.
const NO_ROOM_FEATURES = 'No specific room features required';

/**
 * Right-side sidebar for turning a timeline drag-select (see ResourceRow's
 * onSelection) into a real event — room and time come from the selection,
 * everything else is filled in here. Reuses EventDetailsDrawer.module.css
 * (the old details drawer's stylesheet, kept around for this) so the two
 * feel like one system rather than two different UIs.
 */
export function NewEventDrawer({ selection, resources, instructors, classTypes, onAddClassType, onClose, onCreate }: NewEventDrawerProps) {
  const open = selection !== null;
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (rootRef.current?.contains(target)) return;
      // The "View instructor" modal and the Month-view move-conflict modal
      // both render as siblings, not descendants, of this drawer — see
      // EventPopover.tsx's matching guard.
      if (target.closest('[data-instructor-dialog]')) return;
      if (target.closest('[data-month-move-dialog]')) return;
      // A mousedown starting a drag-select on the calendar itself (see
      // WeekViewVertical/ResourceRow's own onSelection, enabled for exactly
      // as long as this drawer stays open) is resolving THIS flow, not
      // clicking away from it — without this exemption, that mousedown
      // closed the drawer (setting pendingSelection to null) a moment
      // before the drag's own onSelection call replaced it with the new
      // range, which unmounted and remounted this form in between and
      // silently wiped out anything already typed into it.
      if (target.closest('[data-scheduler-selectable-bg]')) return;
      onClose();
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, onClose]);

  return (
    <div ref={rootRef} className={[styles.drawer, open ? styles.drawerOpen : ''].join(' ').trim()} aria-hidden={!open}>
      <div className={styles.content}>
        {selection && (
          // Deliberately NOT keyed by the selection's own identity — a
          // re-drag on the calendar while this is already open (see
          // Scheduler.tsx's own pendingSelection/onSelection, enabled for
          // exactly as long as this drawer stays open) reports a NEW
          // selection to redraw the room/time, and should update the
          // displayed "Time/date"/"Room" fields below live without
          // resetting whatever's already been typed into className/
          // classType/instructor — remounting on every such reposition (the
          // old behavior here) would wipe that progress out. This still
          // starts fresh every time, just via the ordinary "unmounts when
          // `selection` goes back to null, mounts fresh next time it
          // doesn't" lifecycle from the `{selection && ...}` check above,
          // not an explicit key.
          <NewEventForm
            selection={selection}
            resources={resources}
            instructors={instructors}
            classTypes={classTypes}
            onAddClassType={onAddClassType}
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
  onAddClassType,
  onClose,
  onCreate,
}: {
  selection: PendingSelection;
  resources: Resource[];
  instructors: InstructorOption[];
  classTypes: ClassTypeOption[];
  onAddClassType?: (classType: ClassTypeOption) => void;
  onClose: () => void;
  onCreate: (draft: NewEventDraft) => void;
}) {
  const [className, setClassName] = useState('');
  const [classType, setClassType] = useState(classTypes[0]?.name ?? '');
  const [instructorId, setInstructorId] = useState<number | ''>(instructors[0]?.id ?? '');
  // Non-null while the "+ Add new domain…" option is picked — swaps the
  // select below for a plain text input until confirmed (Enter/✓) or
  // cancelled (Escape/✕), rather than ever writing the sentinel value
  // itself into `classType`.
  const [newDomainDraft, setNewDomainDraft] = useState<string | null>(null);

  // "What's available" for Class needs is derived straight from the real
  // room inventory already passed in here — the union of every resource's
  // own `roomNeeds`, deduplicated — not a separately maintained list, so it
  // can never drift out of sync with what rooms actually offer.
  const availableNeeds = useMemo(
    () => Array.from(new Set(resources.flatMap((resource) => resource.roomNeeds ?? []))),
    [resources],
  );
  const [classNeeds, setClassNeeds] = useState<string[]>([]);
  // Needs added via "+ Add new" this session that aren't already part of
  // `availableNeeds` — kept separately so they still show up as their own
  // pill even though no real room happens to carry that tag (yet).
  const [customNeeds, setCustomNeeds] = useState<string[]>([]);
  // Excludes NO_ROOM_FEATURES — that one renders as its own standalone pill
  // (see the "Class needs" field below), not part of the scrollable list of
  // actual, specific needs.
  const allNeedPills = [...availableNeeds, ...customNeeds.filter((need) => !availableNeeds.includes(need))].filter(
    (need) => need !== NO_ROOM_FEATURES,
  );

  const roomTitle = resources.find((r) => r.id === selection.resourceId)?.title ?? selection.resourceId;

  function handleConfirmNewDomain() {
    const name = (newDomainDraft ?? '').trim();
    if (!name) {
      setNewDomainDraft(null);
      return;
    }
    if (!classTypes.some((ct) => ct.name === name)) {
      onAddClassType?.({ name, color: DEFAULT_NEW_DOMAIN_COLOR });
    }
    setClassType(name);
    setNewDomainDraft(null);
  }

  // NO_ROOM_FEATURES and every other class need are mutually exclusive —
  // same reasoning as EventPopover.tsx's own toggleRoomNeed.
  function toggleClassNeed(need: string) {
    if (need === NO_ROOM_FEATURES) {
      setClassNeeds((current) => (current.includes(need) ? [] : [NO_ROOM_FEATURES]));
      return;
    }
    setClassNeeds((current) => {
      const withoutNoFeatures = current.filter((n) => n !== NO_ROOM_FEATURES);
      return withoutNoFeatures.includes(need) ? withoutNoFeatures.filter((n) => n !== need) : [...withoutNoFeatures, need];
    });
  }

  function handleAddNewNeed(name: string) {
    if (!allNeedPills.includes(name)) setCustomNeeds((current) => [...current, name]);
    setClassNeeds((current) => {
      const withoutNoFeatures = current.filter((n) => n !== NO_ROOM_FEATURES);
      return withoutNoFeatures.includes(name) ? withoutNoFeatures : [...withoutNoFeatures, name];
    });
  }

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
      roomNeeds: classNeeds.length > 0 ? classNeeds : undefined,
    });
  }

  return (
    <>
      <div className={styles.header}>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <h3 className={styles.title}>New Class</h3>
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
            <dt className={styles.fieldLabel}>Domain</dt>
            <dd className={styles.fieldValue}>
              {newDomainDraft !== null ? (
                <div className={styles.newDomainRow}>
                  <input
                    className={styles.select}
                    type="text"
                    autoFocus
                    value={newDomainDraft}
                    onChange={(e) => setNewDomainDraft(e.target.value)}
                    placeholder="New domain name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmNewDomain();
                      if (e.key === 'Escape') setNewDomainDraft(null);
                    }}
                  />
                  <button
                    type="button"
                    className={styles.newDomainIconButton}
                    onClick={handleConfirmNewDomain}
                    aria-label="Confirm new domain"
                    title="Confirm new domain"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    type="button"
                    className={styles.newDomainIconButton}
                    onClick={() => setNewDomainDraft(null)}
                    aria-label="Cancel new domain"
                    title="Cancel"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <SearchableSelect
                  value={classType}
                  options={[
                    ...classTypes.map((ct) => ({ value: ct.name, label: ct.name })),
                    { value: NEW_DOMAIN_OPTION_VALUE, label: '+ Add new domain…' },
                  ]}
                  onChange={(next) => {
                    if (next === NEW_DOMAIN_OPTION_VALUE) setNewDomainDraft('');
                    else setClassType(next);
                  }}
                  ariaLabel="Domain"
                  searchPlaceholder="Search domains…"
                  variant="plain"
                />
              )}
            </dd>
          </div>

          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Class needs</dt>
            <dd className={styles.fieldValue}>
              <button
                type="button"
                className={[
                  needsPillGridStyles.needListItem,
                  classNeeds.includes(NO_ROOM_FEATURES) ? needsPillGridStyles.needListItemSelected : '',
                ]
                  .join(' ')
                  .trim()}
                aria-pressed={classNeeds.includes(NO_ROOM_FEATURES)}
                onClick={() => toggleClassNeed(NO_ROOM_FEATURES)}
              >
                {NO_ROOM_FEATURES}
              </button>
              <NeedsPillGrid
                options={allNeedPills}
                selected={classNeeds}
                onToggle={toggleClassNeed}
                onAddNew={handleAddNewNeed}
                newPlaceholder="New class need"
                variant="list"
              />
            </dd>
          </div>

          <div className={styles.field}>
            <dt className={styles.fieldLabel}>Instructor</dt>
            <dd className={styles.fieldValue}>
              <SearchableSelect
                value={instructorId}
                options={instructors.map((instructor) => ({ value: instructor.id, label: instructor.name }))}
                onChange={(next) => setInstructorId(next)}
                ariaLabel="Instructor"
                searchPlaceholder="Search instructors…"
                variant="plain"
              />
            </dd>
          </div>
        </dl>

        <div className={styles.footerButtonRow}>
          <button type="button" className={styles.createButton} disabled={!className.trim() || instructorId === ''} onClick={handleCreate}>
            Create class
          </button>
          <button type="button" className={styles.footerCancelButton} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
