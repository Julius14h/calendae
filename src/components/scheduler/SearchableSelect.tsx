import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import styles from './SearchableSelect.module.css';

export interface SearchableSelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Optional group heading — options sharing one cluster together, in first-seen group order (e.g. PendingBookingActions' own "Possible match" ahead of "All instructors"). Ungrouped options (no `group` at all) render with no heading. */
  group?: string;
}

export interface SearchableSelectProps<T extends string | number> {
  value: T | '';
  options: SearchableSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Shown in the trigger while nothing's selected yet. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** No search box at all at or below this many options — not worth it for a handful of items (e.g. 2 domains, 9 rooms). Default 8. */
  searchThreshold?: number;
  /** 'plain' drops the trigger's own border/background, reading as inline text with a chevron rather than a boxed control — for a host that already implies "this is editable" some other way (e.g. EventPopover's instructor/domain rows, which sit directly under a row of icon buttons that already signal the card is an editor). Default 'default' (the normal bordered box) everywhere else. */
  variant?: 'default' | 'plain';
  /** Drops the trailing chevron entirely, for a host whose surrounding rows are already plain icon+text with no chrome of their own (EventPopover's redesigned field rows) — hover/open state still reads via the trigger's own accent-color transition. Default false (chevron shown). */
  hideChevron?: boolean;
  /** Set on the trigger button so a preceding `<label htmlFor>` focuses it — same association a native `<select>` gets from its own `id`. Omit when there's no visible label to pair with. */
  id?: string;
}

// Matches .panelClosing's own animation-duration below.
const EXIT_MS = 140;
// Clamping margin from the viewport's own edges — matches EventPopover.tsx's
// own POPOVER_MARGIN_PX.
const PANEL_MARGIN_PX = 8;
// Matches .panel's own CSS min-width (see its doc comment) — needed here too
// so the clamping math below reasons about the panel's actual rendered
// width, not just the (possibly much narrower) trigger's own width.
const PANEL_MIN_WIDTH_PX = 180;
// A trigger spanning a genuinely wide host (e.g. ClassEditModal's own
// full-width Instructor field) would otherwise make the panel match that
// full width too, landing its own scrollbar right beside the host's own
// scrollable-body scrollbar (reproduced live as "two scrollbars" sitting
// side by side) — capping it keeps the panel comfortably inset instead.
const PANEL_MAX_WIDTH_PX = 320;
// A generous estimate of the panel's own max height (its search row, when
// shown, plus .optionsList's own 220px max-height plus padding) — a panel
// with fewer options than this just ends up with harmless empty margin
// below it; this only matters for keeping the panel from starting so low
// that a tall one would run off the bottom of the viewport.
const PANEL_MAX_HEIGHT_ESTIMATE_PX = 270;

/**
 * Shared "pick one from a list, with search once the list is long enough"
 * control — every native `<select>`/custom dropdown across this app that
 * picks an instructor, room, or class domain from a real list (as opposed
 * to a fixed handful of settings) should use this instead of rolling its
 * own, so search behaves identically everywhere it appears. Originated as
 * EventPopover.tsx's own private `RowSelect` (a native `<select>`'s
 * lingering focus-outline and stuck-look-selected-after-picking problems
 * were the original reason for a custom dropdown at all) — extracted here,
 * generalized with the search box and optional grouping, once other
 * pickers needed the exact same treatment.
 */
export function SearchableSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '',
  searchPlaceholder = 'Search…',
  searchThreshold = 8,
  variant = 'default',
  hideChevron = false,
  id,
}: SearchableSelectProps<T>) {
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  // The panel renders `position: fixed`, measured from the trigger's own
  // getBoundingClientRect() — same reasoning as ColorPresetMenu.tsx's own
  // doc comment: a plain `position: absolute; top: 100%` panel is normal
  // in-flow-ish content as far as an ancestor's own `overflow: auto` is
  // concerned, so a panel tall enough to overflow a scrollable host (e.g.
  // ClassEditModal's own scrollable body) grew that ancestor's scrollable
  // height too — a second, outer scrollbar appearing right alongside the
  // panel's own .optionsList scrollbar, and a host with `overflow: hidden`
  // (ClassEditModal's own .card, for its rounded corners) would have
  // clipped the panel outright instead. Fixed positioning escapes both.
  const [panelPosition, setPanelPosition] = useState<{
    left: number;
    width: number;
    direction: 'down' | 'up';
    top?: number;
    bottom?: number;
  } | null>(null);

  // The trigger's own "open" look (merged border, flipped chevron) stays
  // through the closing animation too — snapping it back the instant a
  // close starts would visually disconnect the trigger from a panel that's
  // still there, mid-fade, right below it.
  const visuallyOpen = phase !== 'closed';
  const showSearch = options.length > searchThreshold;

  useLayoutEffect(() => {
    if (phase === 'closed') return;
    function recomputePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // The panel can never render narrower than PANEL_MIN_WIDTH_PX (its own
      // CSS min-width) regardless of the trigger's own width, so clamping
      // math has to reason about that effective width, not rect.width alone
      // — a host-hugging trigger (e.g. SchedulerDrawer's own hourRangeBox
      // pill) is often much narrower than that.
      const width = Math.min(Math.max(rect.width, PANEL_MIN_WIDTH_PX), PANEL_MAX_WIDTH_PX);
      let left = rect.left;
      if (left + width > window.innerWidth - PANEL_MARGIN_PX) {
        left = window.innerWidth - PANEL_MARGIN_PX - width;
      }
      left = Math.max(PANEL_MARGIN_PX, left);
      // Flips to open upward — anchored to the trigger's own top edge, same
      // as it's anchored to the trigger's bottom edge when opening downward
      // — rather than merely clamping `top` to a smaller value, which kept
      // the panel on-screen but visually detached it from its own trigger
      // (reproduced live as "it just randomly appears above"). Only flips
      // when there's actually more room above than below — a trigger near
      // the very top of the viewport still opens downward even if that
      // doesn't fully fit, same as a native <select> would.
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const opensUpward = spaceBelow < PANEL_MAX_HEIGHT_ESTIMATE_PX && spaceAbove > spaceBelow;
      if (opensUpward) {
        setPanelPosition({ left, width, direction: 'up', bottom: window.innerHeight - rect.top });
      } else {
        setPanelPosition({ left, width, direction: 'down', top: rect.bottom });
      }
    }
    recomputePosition();
    // A scroll anywhere (the modal's own scrollable body, a page behind it,
    // etc.) or a window resize both move the trigger without this component
    // hearing about it any other way — recompute so the panel keeps
    // tracking it instead of visually detaching. Capturing phase (true)
    // catches scroll on any ancestor scroll container, not just window.
    window.addEventListener('resize', recomputePosition);
    window.addEventListener('scroll', recomputePosition, true);
    return () => {
      window.removeEventListener('resize', recomputePosition);
      window.removeEventListener('scroll', recomputePosition, true);
    };
  }, [phase]);

  function close() {
    setPhase((current) => (current === 'open' ? 'closing' : current));
  }

  useEffect(() => {
    if (phase !== 'closing') return;
    const timer = setTimeout(() => setPhase('closed'), EXIT_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'open') return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      close();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [phase]);

  // Focuses the search box the instant the panel opens, so typing filters
  // immediately without an extra click into it. `query` itself is reset at
  // the point the panel actually opens (the trigger's own onClick below),
  // not here — setting state synchronously inside an effect body just to
  // run once on a phase change is the exact "cascading render" pattern
  // React's own effect rules warn against; a plain event handler doesn't
  // have that problem.
  useEffect(() => {
    if (phase !== 'open') return;
    searchInputRef.current?.focus();
  }, [phase]);

  function choose(next: T) {
    onChange(next);
    close();
    // Native focus lingering on the trigger after a click is exactly the
    // "still looks highlighted" bug this replaces the native <select> to
    // fix — don't let it happen here either.
    triggerRef.current?.blur();
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [options, query]);

  // Groups, in first-seen order — an ungrouped option (no `group`) still
  // gets its own "group" here (key ''), it just renders with no heading.
  const groupOrder = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const option of filtered) {
      const key = option.group ?? '';
      if (!seen.has(key)) {
        seen.add(key);
        order.push(key);
      }
    }
    return order;
  }, [filtered]);

  return (
    <div ref={rootRef} className={styles.select}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={[styles.trigger, variant === 'plain' ? styles.triggerPlain : ''].join(' ').trim()}
        data-open={visuallyOpen}
        data-panel-direction={panelPosition?.direction}
        onClick={() => {
          // Not a functional setPhase updater reading `current` — this
          // plain click handler already closes over the latest rendered
          // `phase` directly, and calling setQuery from inside a setPhase
          // updater would just be the same "side effect inside an updater"
          // hazard fixed elsewhere in this app (see WeekViewVertical.tsx's
          // own comment on it), just without the cross-component part.
          if (phase === 'closed') {
            setQuery('');
            setPhase('open');
          } else {
            setPhase('closing');
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={visuallyOpen}
        aria-label={ariaLabel}
      >
        <span className={styles.value}>{selected?.label ?? placeholder}</span>
        {!hideChevron && <ChevronDown size={16} className={styles.chevron} />}
      </button>
      {phase !== 'closed' && (
        <div
          className={[
            styles.panel,
            panelPosition?.direction === 'up' ? styles.panelUp : styles.panelDown,
            phase === 'closing' ? styles.panelClosing : '',
          ]
            .join(' ')
            .trim()}
          style={
            panelPosition
              ? { top: panelPosition.top, bottom: panelPosition.bottom, left: panelPosition.left, width: panelPosition.width }
              : undefined
          }
        >
          {showSearch && (
            <div className={styles.searchRow}>
              <Search size={14} className={styles.searchIcon} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                className={styles.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered.length > 0) choose(filtered[0].value);
                }}
              />
            </div>
          )}
          <ul className={styles.optionsList} role="listbox" aria-label={ariaLabel}>
            {filtered.length === 0 && (
              <li className={styles.emptyState} role="presentation">
                No matches
              </li>
            )}
            {groupOrder.map((groupKey) => (
              <li key={groupKey || '__ungrouped__'} role="presentation">
                {groupKey && <div className={styles.groupLabel}>{groupKey}</div>}
                {/* Purely structural (grouping only) — NOT .optionsList again:
                    that class carries its own max-height/overflow-y for the
                    scrollable panel as a whole, and reusing it here nested
                    two independently-scrollable elements inside each other
                    (the common ungrouped case still wraps its one implicit
                    group in this same inner <ul>), rendering two scrollbars
                    stacked on top of each other for what's visually one
                    list. See .optionsGroup's own doc comment. */}
                <ul className={styles.optionsGroup} role="presentation">
                  {filtered
                    .filter((option) => (option.group ?? '') === groupKey)
                    .map((option) => (
                      <li key={option.value} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={option.value === value}
                          className={styles.option}
                          onClick={() => choose(option.value)}
                        >
                          {option.label}
                        </button>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
