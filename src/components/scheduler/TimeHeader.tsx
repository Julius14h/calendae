import { formatHourLabel, monthLabel, weekdayLabel } from './utils/dateMath';
import { hourWidthPx, hoursOfDay, type TimelineGeometry } from './utils/timeGeometry';
import styles from './TimelineView.module.css';

export interface TimeHeaderProps {
  geometry: TimelineGeometry;
  onDateClick?: (date: Date) => void;
}

/** Sticky (top) two-tier header: day labels above hour labels, for the timeline canvas. */
export function TimeHeader({ geometry, onDateClick }: TimeHeaderProps) {
  const hourWidth = hourWidthPx(geometry);
  const hours = hoursOfDay(geometry);

  return (
    <div className={styles.timeHeader} style={{ width: geometry.totalWidthPx }}>
      <div className={styles.dayRow}>
        {geometry.days.map((day) => (
          <button
            key={day.getTime()}
            type="button"
            className={styles.dayCell}
            style={{ width: geometry.dayWidthPx }}
            onClick={() => onDateClick?.(day)}
          >
            {weekdayLabel(day)}, {monthLabel(day)} {day.getDate()}
          </button>
        ))}
      </div>
      <div className={styles.hourRow}>
        {geometry.days.map((day) => (
          <div key={day.getTime()} className={styles.hourGroup} style={{ width: geometry.dayWidthPx }}>
            {hours.map((hour) => (
              <div key={hour} className={styles.hourCell} style={{ width: hourWidth }}>
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
