import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { isSameDay, weekdayLabel } from './utils/dateMath';
import styles from './DayJumpBar.module.css';

/**
 * Week view's "jump to a day" strip — shown at the bottom center of the
 * screen while a class is being dragged (an event block via EventBlock's
 * moveDrag, or a Classes Bin chip via UnplacedClassesDrawer), so a class on
 * Saturday can reach Sunday without a long auto-scroll the whole way
 * across. Hovering a day (still holding the class) smoothly scrolls the
 * calendar to it; moving back up into the grid drops the class there as
 * usual. Releasing over the strip itself cancels the drag — it's a
 * navigation aid, not a drop target (see DayJumpContext's isOverBar).
 */
export interface DayJumpBarProps {
  days: Date[];
  /** Root to search for the week view's own scroll container and day headers (marked data-day-jump-scroller / data-day-jump-date — see TimelineView/TimeHeader/WeekViewVertical). */
  rootRef: React.RefObject<HTMLElement | null>;
}

export interface DayJumpBarHandle {
  getRect: () => DOMRect | null;
  /**
   * Hover by pointer position. A Classes Bin chip drag uses pointer capture
   * (see usePendingChipDrag), so the strip's own pointerenter never fires
   * during one — the drag reports its coordinates here instead.
   */
  hoverAt: (clientX: number, clientY: number) => void;
}

/** Scrolls the week grid so `day`'s column starts right after the sticky left column (rooms or hours). */
function scrollToDay(root: HTMLElement | null, day: Date) {
  const scroller = root?.querySelector<HTMLElement>('[data-day-jump-scroller]');
  const header = scroller?.querySelector<HTMLElement>(`[data-day-jump-date="${day.getTime()}"]`);
  if (!scroller || !header) return;
  const stickyWidth = scroller.querySelector<HTMLElement>('[data-day-jump-sticky-left]')?.getBoundingClientRect().width ?? 0;
  const left = scroller.scrollLeft + header.getBoundingClientRect().left - scroller.getBoundingClientRect().left - stickyWidth;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  scroller.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' });
}

export const DayJumpBar = forwardRef<DayJumpBarHandle, DayJumpBarProps>(function DayJumpBar({ days, rootRef }, ref) {
  const barRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoveredIndexRef = useRef<number | null>(null);

  // Scrolls only when the hovered day actually changes, not on every move
  // within the same day.
  function hover(index: number | null) {
    if (index === hoveredIndexRef.current) return;
    hoveredIndexRef.current = index;
    setHoveredIndex(index);
    if (index !== null) scrollToDay(rootRef.current, days[index]);
  }

  useImperativeHandle(ref, () => ({
    getRect: () => barRef.current?.getBoundingClientRect() ?? null,
    hoverAt: (clientX, clientY) => {
      const index = dayRefs.current.findIndex((el) => {
        const r = el?.getBoundingClientRect();
        return !!r && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
      });
      hover(index === -1 ? null : index);
    },
  }));

  const today = new Date();
  return (
    <div ref={barRef} className={styles.bar} role="toolbar" aria-label="Jump to day while dragging">
      {days.map((day, i) => (
        <div
          key={day.getTime()}
          ref={(el) => {
            dayRefs.current[i] = el;
          }}
          className={[styles.day, isSameDay(day, today) ? styles.today : '', hoveredIndex === i ? styles.dayActive : ''].join(' ').trim()}
          // Event-block drags use window-level listeners (no pointer
          // capture), so plain enter/leave events work for those.
          onPointerEnter={() => hover(i)}
          onPointerLeave={() => hover(null)}
        >
          <span className={styles.weekday}>{weekdayLabel(day)}</span>
          <span className={styles.date}>{day.getDate()}</span>
        </div>
      ))}
    </div>
  );
});
