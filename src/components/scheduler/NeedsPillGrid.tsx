import { useState } from 'react';
import { Check, X } from 'lucide-react';
import styles from './NeedsPillGrid.module.css';

export interface NeedsPillGridProps {
  /** Every option to show as a pill, already deduplicated — typically the union of every room's own `roomNeeds` (see callers for exactly how each computes it), plus whatever's been added ad hoc this session. */
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  /** Omit entirely for a closed, fixed vocabulary (e.g. delivery format's own "In-Person"/"Virtual"/"Hybrid" choices, which aren't something a user should be able to invent) — hides the trailing "+ Add new" pill/row rather than rendering one with nowhere to send its result. */
  onAddNew?: (name: string) => void;
  /** Label for the trailing "add a new one" pill, e.g. "+ Add new domain…". Default "+ Add new". */
  addLabel?: string;
  newPlaceholder?: string;
  /** Full text for an option whose own label is a shortened stand-in (e.g. Delivery's "Hybrid" pill, whose real meaning — "Hybrid (In-Person + Virtual simultaneously)" — doesn't fit as a pill label) — shown as that pill's native `title` tooltip. Keyed by the same string passed in `options`/`selected`; an option with no entry just gets no tooltip. */
  optionTitles?: Record<string, string>;
  /**
   * 'grid' (default): the original wrapping grid of rounded pill buttons —
   * used by RoomModal.tsx's own "Features/needs" field and NewEventDrawer.tsx's
   * own "Class needs" field, both rendered into a roomy full-page/drawer
   * layout where a grid of pills has plenty of room to breathe. 'list': no
   * pill border/background at all — plain text stacked one per line in a
   * scrollable column, selected marked by text color alone — for
   * ClassEditModal.tsx's own "Room needs" field, both because a long,
   * growable list of pills wrapping into a wide grid could push the whole
   * modal's height out much further than its other fields, and because a
   * pill's own border/fill read as heavier than that field warranted.
   */
  variant?: 'grid' | 'list';
  /** How a selected pill reads in the 'grid' variant — 'filled' (default): solid accent background, white text, matching a real multi-value field like RoomModal's own Features/needs. 'outline': just an accent border, text stays var(--sched-text) — for a field like Delivery whose 3 options are closer to a single-choice toggle than an open multi-select, where a solid block of color (or accent-colored text) for the one active choice read as heavier than the field warranted. No effect on the 'list' variant, which marks its own selected state by text color regardless. */
  selectedStyle?: 'filled' | 'outline';
}

/**
 * Shared "click all the ones you want, or type a brand new one" multi-select
 * — used by NewEventDrawer.tsx's own "Class needs" field, RoomModal.tsx's
 * own "Features/needs" field, and EventPopover.tsx's own "Room needs" field
 * (in its 'list' variant). All three are really the same underlying
 * vocabulary (a room's own features are exactly what a class's own needs get
 * matched against — see rooms.ts's getEligibleRooms), so one shared
 * component keeps them from drifting apart behaviorally as any of them gets
 * touched later, even though 'list' looks quite different from 'grid'.
 */
export function NeedsPillGrid({
  options,
  selected,
  onToggle,
  onAddNew,
  addLabel = '+ Add new',
  newPlaceholder = 'New value',
  optionTitles,
  variant = 'grid',
  selectedStyle = 'filled',
}: NeedsPillGridProps) {
  // Non-null while composing a new one — swaps the trailing "+ Add new"
  // pill for a plain text input until confirmed (Enter/✓) or cancelled
  // (Escape/✕).
  const [newDraft, setNewDraft] = useState<string | null>(null);

  function handleConfirmNew() {
    const name = (newDraft ?? '').trim();
    if (!name) {
      setNewDraft(null);
      return;
    }
    onAddNew?.(name);
    setNewDraft(null);
  }

  if (variant === 'list') {
    return (
      <div>
        <div className={styles.needsList}>
          {options.map((option) => {
            const isSelected = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                title={optionTitles?.[option]}
                className={[styles.needListItem, isSelected ? styles.needListItemSelected : ''].join(' ').trim()}
                aria-pressed={isSelected}
                onClick={() => onToggle(option)}
              >
                {option}
              </button>
            );
          })}
          {onAddNew && newDraft === null && (
            <button type="button" className={styles.needListItem} onClick={() => setNewDraft('')}>
              {addLabel}
            </button>
          )}
        </div>
        {onAddNew && newDraft !== null && (
          <div className={styles.newRow}>
            <input
              className={styles.newInput}
              type="text"
              autoFocus
              value={newDraft}
              onChange={(e) => setNewDraft(e.target.value)}
              placeholder={newPlaceholder}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmNew();
                if (e.key === 'Escape') setNewDraft(null);
              }}
            />
            <button type="button" className={styles.iconButton} onClick={handleConfirmNew} aria-label="Confirm" title="Confirm">
              <Check size={16} />
            </button>
            <button type="button" className={styles.iconButton} onClick={() => setNewDraft(null)} aria-label="Cancel" title="Cancel">
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.needsGrid}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            title={optionTitles?.[option]}
            className={[
              styles.needPill,
              selected.includes(option) ? (selectedStyle === 'outline' ? styles.needPillSelectedOutline : styles.needPillSelected) : '',
            ]
              .join(' ')
              .trim()}
            aria-pressed={selected.includes(option)}
            onClick={() => onToggle(option)}
          >
            {option}
          </button>
        ))}
        {onAddNew && newDraft === null && (
          <button type="button" className={[styles.needPill, styles.addNeedPill].join(' ')} onClick={() => setNewDraft('')}>
            {addLabel}
          </button>
        )}
      </div>
      {onAddNew && newDraft !== null && (
        <div className={styles.newRow}>
          <input
            className={styles.newInput}
            type="text"
            autoFocus
            value={newDraft}
            onChange={(e) => setNewDraft(e.target.value)}
            placeholder={newPlaceholder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmNew();
              if (e.key === 'Escape') setNewDraft(null);
            }}
          />
          <button type="button" className={styles.iconButton} onClick={handleConfirmNew} aria-label="Confirm" title="Confirm">
            <Check size={16} />
          </button>
          <button type="button" className={styles.iconButton} onClick={() => setNewDraft(null)} aria-label="Cancel" title="Cancel">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
