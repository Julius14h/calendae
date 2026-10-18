import { Plus } from 'lucide-react';
import styles from './SchedulerDrawer.module.css';

const CLASS_TYPE_COLOR_PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#64748b', '#78716c', '#3f3f46',
];

/**
 * Shared popover body for SchedulerDrawer.tsx's Class Types list (an
 * existing class type's "..." button and the "New class type" row's
 * swatch) and EventPopover.tsx's own class-type color swatch — a grid of
 * presets plus a "Custom color" fallback that opens the caller's own native
 * `<input type="color">`. Position is always `fixed`, measured by the
 * caller from its trigger's own `getBoundingClientRect()`, so it isn't
 * clipped by, or added to the scrollable height of, an ancestor's overflow.
 * Its own file (not living inside SchedulerDrawer.tsx, its original home)
 * so both consumers can import it without one depending on the other.
 */
export function ColorPresetMenu({
  position,
  selectedColor,
  onPick,
  onOpenWheel,
  onMouseEnter,
  onMouseLeave,
}: {
  position: { top: number; left: number };
  selectedColor: string;
  onPick: (color: string) => void;
  onOpenWheel: () => void;
  /** Only used by EventPopover.tsx's hover-triggered version, to keep the menu open while the pointer moves from its trigger swatch into the menu itself. SchedulerDrawer's own click-triggered popovers omit these. */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  return (
    <div
      className={styles.colorMenu}
      role="menu"
      style={{ position: 'fixed', top: position.top, left: position.left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.colorSwatchGrid}>
        {CLASS_TYPE_COLOR_PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            role="menuitem"
            className={styles.colorSwatch}
            data-selected={selectedColor.toLowerCase() === color}
            style={{ '--swatch-color': color } as React.CSSProperties}
            onClick={() => onPick(color)}
            aria-label={`Set colour ${color}`}
          />
        ))}
      </div>
      <button type="button" role="menuitem" className={styles.colorWheelButton} onClick={onOpenWheel}>
        <Plus size={16} strokeWidth={2.5} />
        <span>Custom colour</span>
      </button>
    </div>
  );
}
