import { useState } from 'react';
import { PinOff, X } from 'lucide-react';
import { addDays, fromDateInputValue, toDateInputValue } from './utils/dateMath';
import type { ManualEventPolicy, OverflowPolicy, RegenerateWeekOptions } from './Scheduler.types';
import styles from './GenerateModal.module.css';

export interface GenerateModalProps {
  open: boolean;
  /** 'fresh' (triggered by "Generate Roster") replaces the whole schedule from the imported CSVs and only asks for a date range; 'regenerate' (triggered by "Regenerate") also offers the pin/bin/manual-event options, since it's rebuilding on top of an already-loaded, possibly hand-edited schedule. */
  mode: 'fresh' | 'regenerate';
  /** Start of the initial date range shown — whatever week is currently in view (see Scheduler.tsx); the end defaults to 6 days later (one week), both freely editable. */
  defaultStart: Date;
  onClose: () => void;
  /** Fired in 'fresh' mode's own Generate click. */
  onGenerateFresh: (range: { start: Date; end: Date }) => void;
  /** Fired in 'regenerate' mode's own Generate click. */
  onRegenerate: (options: RegenerateWeekOptions) => void;
  /** Only rendered/relevant in 'regenerate' mode. */
  onClearAllPins: () => void;
}


/**
 * Shared by "Generate Roster" (mode 'fresh') and "Regenerate" (mode
 * 'regenerate') — both let the user specify a date range before building,
 * rather than assuming a fixed window. Copies RoomModal's own
 * backdrop+card+header+body+footer shell. The two mutually-exclusive
 * choices (regenerate mode only) reuse SchedulerDrawer.tsx's own
 * `.segmented` underline-tab pattern (this codebase has no native radio
 * input anywhere); the Classes-Bin toggle reuses its own `.dot`/
 * `.dotToggleButton` square-toggle pattern (no native checkbox either) —
 * see GenerateModal.module.css's own doc comments on both.
 *
 * "Clear all pins" is deliberately its own immediate button, not a third
 * option folded into the main submit: it's a prep step ("force a full
 * reshuffle before choosing options"), not part of what Generate itself
 * decides.
 */
export function GenerateModal({ open, mode, defaultStart, onClose, onGenerateFresh, onRegenerate, onClearAllPins }: GenerateModalProps) {
  const [startDate, setStartDate] = useState(() => toDateInputValue(defaultStart));
  const [endDate, setEndDate] = useState(() => toDateInputValue(addDays(defaultStart, 6)));
  const [overflowPolicy, setOverflowPolicy] = useState<OverflowPolicy>('archive-to-bin');
  const [manualEventPolicy, setManualEventPolicy] = useState<ManualEventPolicy>('preserve');
  const [includeBinItems, setIncludeBinItems] = useState(false);

  // Resets the date fields to a fresh default every time the modal opens —
  // adjusting state during render (see EventPopover.tsx's matching
  // `prevEvent` idiom) rather than an effect, so a stale range from a
  // previous open doesn't linger.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open && !prevOpen) {
    const freshStart = toDateInputValue(defaultStart);
    const freshEnd = toDateInputValue(addDays(defaultStart, 6));
    if (startDate !== freshStart) setStartDate(freshStart);
    if (endDate !== freshEnd) setEndDate(freshEnd);
  }
  if (open !== prevOpen) setPrevOpen(open);

  if (!open) return null;

  const rangeStart = fromDateInputValue(startDate);
  // The picker's own "End date" is the last day INCLUDED — the underlying
  // range is exclusive, so this adds one day to get that boundary.
  const rangeEnd = addDays(fromDateInputValue(endDate), 1);
  const rangeValid = rangeEnd > rangeStart;

  function handleGenerate() {
    if (!rangeValid) return;
    if (mode === 'fresh') {
      onGenerateFresh({ start: rangeStart, end: rangeEnd });
    } else {
      onRegenerate({ rangeStart, rangeEnd, overflowPolicy, manualEventPolicy, includeBinItems });
    }
    onClose();
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'fresh' ? 'Generate schedule' : 'Regenerate schedule'}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{mode === 'fresh' ? 'Generate Schedule' : 'Regenerate Schedule'}</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <X size={22} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Dates to generate</span>
            <div className={styles.dateRangeRow}>
              <input
                type="date"
                className={styles.dateInput}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Start date"
              />
              <span className={styles.dateRangeDash}>–</span>
              <input
                type="date"
                className={styles.dateInput}
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="End date"
              />
            </div>
            {!rangeValid && <p className={styles.fieldHint}>End date must be on or after the start date.</p>}
          </div>

          {mode === 'fresh' && (
            <p className={styles.fieldHint}>Generating will replace your current schedule — this can&apos;t be undone.</p>
          )}

          {mode === 'regenerate' && (
            <>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>If a class can&apos;t be placed</span>
                <div className={styles.segmented} role="radiogroup" aria-label="If a class can't be placed">
                  <button
                    type="button"
                    className={[styles.segmentButton, overflowPolicy === 'archive-to-bin' ? styles.segmentButtonActive : ''].join(' ').trim()}
                    aria-pressed={overflowPolicy === 'archive-to-bin'}
                    onClick={() => setOverflowPolicy('archive-to-bin')}
                  >
                    Archive to bin
                  </button>
                  <button
                    type="button"
                    className={[styles.segmentButton, overflowPolicy === 'force-place' ? styles.segmentButtonActive : ''].join(' ').trim()}
                    aria-pressed={overflowPolicy === 'force-place'}
                    onClick={() => setOverflowPolicy('force-place')}
                  >
                    Place anyway
                  </button>
                </div>
                <p className={styles.fieldHint}>
                  {overflowPolicy === 'archive-to-bin'
                    ? 'Sends it to the Classes Bin for you to place by hand later.'
                    : 'Books it somewhere anyway, as a last resort — flagged so you can see and move it.'}
                </p>
              </div>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>Manually-created events</span>
                <div className={styles.segmented} role="radiogroup" aria-label="Manually-created events">
                  <button
                    type="button"
                    className={[styles.segmentButton, manualEventPolicy === 'preserve' ? styles.segmentButtonActive : ''].join(' ').trim()}
                    aria-pressed={manualEventPolicy === 'preserve'}
                    onClick={() => setManualEventPolicy('preserve')}
                  >
                    Preserve
                  </button>
                  <button
                    type="button"
                    className={[styles.segmentButton, manualEventPolicy === 'reposition' ? styles.segmentButtonActive : ''].join(' ').trim()}
                    aria-pressed={manualEventPolicy === 'reposition'}
                    onClick={() => setManualEventPolicy('reposition')}
                  >
                    Reposition
                  </button>
                  <button
                    type="button"
                    className={[styles.segmentButton, manualEventPolicy === 'delete' ? styles.segmentButtonActive : ''].join(' ').trim()}
                    aria-pressed={manualEventPolicy === 'delete'}
                    onClick={() => setManualEventPolicy('delete')}
                  >
                    Delete
                  </button>
                </div>
                <p className={styles.fieldHint}>
                  {manualEventPolicy === 'preserve'
                    ? 'Events with no roster class behind them stay exactly where they are.'
                    : manualEventPolicy === 'reposition'
                      ? "They're treated like anything else — let this run find them a fresh spot."
                      : "They're removed entirely."}
                </p>
              </div>

              <div className={styles.field}>
                <button
                  type="button"
                  className={styles.toggleRow}
                  aria-pressed={includeBinItems}
                  onClick={() => setIncludeBinItems((current) => !current)}
                >
                  <span className={styles.toggleDot} data-active={includeBinItems} aria-hidden="true" />
                  <span className={styles.toggleLabel}>Also try placing classes from the Classes Bin</span>
                </button>
              </div>

              <div className={styles.clearPinsRow}>
                <div className={styles.clearPinsText}>
                  <span className={styles.clearPinsTitle}>Clear all pins</span>
                  <span className={styles.clearPinsHint}>Forces a full reshuffle before you generate.</span>
                </div>
                <button type="button" className={styles.clearPinsButton} onClick={onClearAllPins}>
                  <PinOff size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                  Clear
                </button>
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.generateButton} onClick={handleGenerate} disabled={!rangeValid}>
            {mode === 'fresh' ? 'Generate' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
}
