import { formatToolbarTitle } from './utils/dateMath';
import { MenuIcon } from './Icons';
import type { SchedulerView } from './Scheduler.types';
import styles from './Toolbar.module.css';

export interface ToolbarProps {
  view: SchedulerView;
  anchorDate: Date;
  weekStartsOn: 0 | 1;
  drawerOpen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: SchedulerView) => void;
  onToggleDrawer: () => void;
}

const VIEWS: SchedulerView[] = ['day', 'week', 'month'];

export function Toolbar({
  view,
  anchorDate,
  weekStartsOn,
  drawerOpen,
  onPrev,
  onNext,
  onToday,
  onViewChange,
  onToggleDrawer,
}: ToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.navGroup}>
        <button
          type="button"
          className={[styles.iconButton, drawerOpen ? styles.iconButtonActive : ''].join(' ').trim()}
          onClick={onToggleDrawer}
          aria-pressed={drawerOpen}
          aria-label={drawerOpen ? 'Close control panel' : 'Open control panel'}
          title={drawerOpen ? 'Close control panel' : 'Open control panel'}
        >
          <MenuIcon />
        </button>
        <button type="button" className={styles.todayButton} onClick={onToday}>
          Today
        </button>
        <button type="button" className={styles.iconButton} onClick={onPrev} aria-label="Previous">
          ‹
        </button>
        <button type="button" className={styles.iconButton} onClick={onNext} aria-label="Next">
          ›
        </button>
        <h2 className={styles.title}>{formatToolbarTitle(view, anchorDate, weekStartsOn)}</h2>
      </div>

      <div className={styles.viewGroup}>
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className={[styles.viewButton, v === view ? styles.viewButtonActive : ''].join(' ').trim()}
            onClick={() => onViewChange(v)}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
