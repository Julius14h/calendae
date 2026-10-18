import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { NeedsPillGrid } from './NeedsPillGrid';
import needsPillGridStyles from './NeedsPillGrid.module.css';
import type { Resource } from './Scheduler.types';
import styles from './RoomModal.module.css';

// The one room feature that means "there are no specific requirements"
// rather than a real requirement to match a room against (see allocate.ts's
// own NEEDS_ALWAYS_SATISFIED) — same constant/reasoning as EventPopover.tsx's
// own NO_ROOM_FEATURES for its "Room needs" field, mutually exclusive with
// every other feature and rendered as its own standalone pill outside the
// scrollable list of actual specific features.
const NO_ROOM_FEATURES = 'No specific room features required';

export interface RoomModalState {
  mode: 'add' | 'edit';
  /** The room being edited — undefined in 'add' mode. */
  resource?: Resource;
}

export interface RoomModalProps {
  state: RoomModalState | null;
  /** The full current room roster — used to compute "what's available" for the Features/needs pill grid (the union of every room's own roomNeeds, same vocabulary NewEventDrawer's own "Class needs" field draws from — see rooms.ts's getEligibleRooms for why these two are really the same thing). */
  resources: Resource[];
  onClose: () => void;
  onAdd: (resource: Resource) => void;
  onSave: (resourceId: string, updates: Partial<Pick<Resource, 'title' | 'roomNeeds' | 'maxCapacity'>>) => void;
}

/**
 * One shared modal for both "Add room" (CreateFab's own menu item) and
 * "Edit room" (the pencil icon shown on hovering an existing room's own
 * header/label — see WeekViewVertical.tsx/TimelineView.tsx) — same three
 * fields either way (name, features/needs, capacity), just pre-filled and
 * wired to a different callback in edit mode. Mirrors ClassesToReviewModal's
 * own centered backdrop+card shell.
 */
export function RoomModal({ state, resources, onClose, onAdd, onSave }: RoomModalProps) {
  const open = state !== null;

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!state) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === 'edit' ? 'Edit room' : 'Add room'}
      >
        {/* Keyed by which room (or 'add') this is — switching targets (e.g.
            closing then reopening for a different room) should always start
            the form fresh from that room's own current values, not whatever
            was last typed for a previous one. */}
        <RoomForm
          key={state.resource?.id ?? '__new-room__'}
          mode={state.mode}
          resource={state.resource}
          resources={resources}
          onClose={onClose}
          onAdd={onAdd}
          onSave={onSave}
        />
      </div>
    </div>
  );
}

function RoomForm({
  mode,
  resource,
  resources,
  onClose,
  onAdd,
  onSave,
}: {
  mode: 'add' | 'edit';
  resource?: Resource;
  resources: Resource[];
  onClose: () => void;
  onAdd: (resource: Resource) => void;
  onSave: (resourceId: string, updates: Partial<Pick<Resource, 'title' | 'roomNeeds' | 'maxCapacity'>>) => void;
}) {
  const [title, setTitle] = useState(resource?.title ?? '');
  const [features, setFeatures] = useState<string[]>(resource?.roomNeeds ?? []);
  // Features added via "+ Add new" this session that aren't already part of
  // `availableFeatures` — same convention as NewEventDrawer's own
  // customNeeds (see its own doc comment).
  const [customFeatures, setCustomFeatures] = useState<string[]>([]);
  const [capacity, setCapacity] = useState<string>(resource?.maxCapacity != null ? String(resource.maxCapacity) : '');

  // "What's available" is the union of every room's own roomNeeds,
  // deduplicated — identical computation to NewEventDrawer's own
  // availableNeeds, since a room's features and a class's needs are matched
  // against the exact same vocabulary (see rooms.ts's getEligibleRooms).
  const availableFeatures = useMemo(
    () => Array.from(new Set(resources.flatMap((r) => r.roomNeeds ?? []))),
    [resources],
  );
  // Excludes NO_ROOM_FEATURES — that one renders as its own standalone pill
  // (see the "Features/needs" field below), not part of the scrollable list
  // of actual, specific features.
  const allFeaturePills = Array.from(new Set([...availableFeatures, ...features, ...customFeatures])).filter(
    (feature) => feature !== NO_ROOM_FEATURES,
  );

  // NO_ROOM_FEATURES and every other feature are mutually exclusive — same
  // reasoning as EventPopover.tsx's own toggleRoomNeed.
  function toggleFeature(feature: string) {
    if (feature === NO_ROOM_FEATURES) {
      setFeatures((current) => (current.includes(feature) ? [] : [NO_ROOM_FEATURES]));
      return;
    }
    setFeatures((current) => {
      const withoutNoFeatures = current.filter((f) => f !== NO_ROOM_FEATURES);
      return withoutNoFeatures.includes(feature) ? withoutNoFeatures.filter((f) => f !== feature) : [...withoutNoFeatures, feature];
    });
  }

  function handleAddNewFeature(name: string) {
    if (!allFeaturePills.includes(name)) setCustomFeatures((current) => [...current, name]);
    setFeatures((current) => {
      const withoutNoFeatures = current.filter((f) => f !== NO_ROOM_FEATURES);
      return withoutNoFeatures.includes(name) ? withoutNoFeatures : [...withoutNoFeatures, name];
    });
  }

  function handleSubmit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const parsedCapacity = capacity.trim() ? Number(capacity) : undefined;
    const maxCapacity = parsedCapacity != null && Number.isFinite(parsedCapacity) ? parsedCapacity : undefined;
    const roomNeeds = features.length > 0 ? features : undefined;
    if (mode === 'add') {
      // Same id-generation scheme handleAddRoomFab used to build inline —
      // kept here now that this modal replaces that flow entirely.
      const id = `room-${resources.length + 1}-${trimmedTitle.toLowerCase().replace(/\s+/g, '-')}`;
      onAdd({ id, title: trimmedTitle, roomNeeds, maxCapacity });
    } else if (resource) {
      onSave(resource.id, { title: trimmedTitle, roomNeeds, maxCapacity });
    }
    onClose();
  }

  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.title}>{mode === 'edit' ? 'Edit room' : 'Add room'}</h2>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
          <X size={22} />
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="room-modal-name">
            Name
          </label>
          <input
            id="room-modal-name"
            className={styles.textInput}
            type="text"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Studio B"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Features/needs</span>
          <button
            type="button"
            className={[needsPillGridStyles.needListItem, features.includes(NO_ROOM_FEATURES) ? needsPillGridStyles.needListItemSelected : '']
              .join(' ')
              .trim()}
            aria-pressed={features.includes(NO_ROOM_FEATURES)}
            onClick={() => toggleFeature(NO_ROOM_FEATURES)}
          >
            {NO_ROOM_FEATURES}
          </button>
          <NeedsPillGrid
            options={allFeaturePills}
            selected={features}
            onToggle={toggleFeature}
            onAddNew={handleAddNewFeature}
            newPlaceholder="New feature"
            variant="list"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="room-modal-capacity">
            Capacity
          </label>
          <input
            id="room-modal-capacity"
            className={styles.textInput}
            type="number"
            min="0"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="e.g. 20"
          />
        </div>
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.saveButton} disabled={!title.trim()} onClick={handleSubmit}>
          {mode === 'edit' ? 'Save changes' : 'Add room'}
        </button>
        <button type="button" className={styles.cancelButton} onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}
