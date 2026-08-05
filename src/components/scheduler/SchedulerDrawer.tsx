import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal, Plus } from 'lucide-react';
import { formatBusinessHourLabel } from './utils/dateMath';
import type { ClassTypeOption, EventColorMode, InstructorOption, Resource } from './Scheduler.types';
import styles from './SchedulerDrawer.module.css';

export interface SchedulerDrawerProps {
  open: boolean;

  colorMode: EventColorMode;
  onColorModeChange: (mode: EventColorMode) => void;

  snapMinutes: number;
  onSnapMinutesChange: (minutes: number) => void;
  slotMinutes: number;
  onSlotMinutesChange: (minutes: number) => void;
  dayStartHour: number;
  onDayStartHourChange: (hour: number) => void;
  dayEndHour: number;
  onDayEndHourChange: (hour: number) => void;
  weekStartsOn: 0 | 1;
  onWeekStartsOnChange: (day: 0 | 1) => void;
  weekOrientation: 'horizontal' | 'vertical';
  onWeekOrientationChange: (orientation: 'horizontal' | 'vertical') => void;

  resources: Resource[];
  onAddResource?: (resource: Resource) => void;
  instructors: InstructorOption[];
  onViewInstructor?: (instructorId: number) => void;
  /** Ids unchecked here are hidden from the calendar grid (display only — see Scheduler.tsx). */
  hiddenInstructorIds: Set<number>;
  onToggleInstructorVisibility: (id: number) => void;
  onToggleAllInstructorsVisible: () => void;
  classTypes: ClassTypeOption[];
  onAddClassType?: (classType: ClassTypeOption) => void;
  onClassTypeColorChange?: (name: string, color: string) => void;
  hiddenClassTypes: Set<string>;
  onToggleClassTypeVisibility: (name: string) => void;
  onToggleAllClassTypesVisible: () => void;

  onImport?: () => void;
  onLoad?: () => void;
  onSave?: () => void;
  onExport?: () => void;
}

const SNAP_OPTIONS = [5, 10, 15, 20, 30, 60];
const SLOT_OPTIONS = [15, 30, 60];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DEFAULT_NEW_CLASS_TYPE_COLOR = '#4f6df5';
// Distinguishes "the new-class-type row's popover is open" from "an existing
// class type's popover is open" in the shared openColorMenuFor state below —
// a Symbol rather than a reserved string so it can never collide with a
// user-entered class type name.
const NEW_CLASS_TYPE_COLOR_MENU = Symbol('new-class-type-color-menu');
const CLASS_TYPE_COLOR_PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#64748b', '#78716c', '#3f3f46',
];

/**
 * Collapsible control panel: schedule actions (import/load/save/export),
 * event-coloring filter (by room vs. by type), and adjustable display
 * settings. Rendered by `Scheduler` as a width-animated sibling of the main
 * column, so it pushes content rather than overlaying it — see
 * `.drawer`/`.drawerOpen` in the CSS module for the actual transition.
 */
export function SchedulerDrawer({
  open,
  colorMode,
  onColorModeChange,
  snapMinutes,
  onSnapMinutesChange,
  slotMinutes,
  onSlotMinutesChange,
  dayStartHour,
  onDayStartHourChange,
  dayEndHour,
  onDayEndHourChange,
  weekStartsOn,
  onWeekStartsOnChange,
  weekOrientation,
  onWeekOrientationChange,
  resources,
  onAddResource,
  instructors,
  onViewInstructor,
  hiddenInstructorIds,
  onToggleInstructorVisibility,
  onToggleAllInstructorsVisible,
  classTypes,
  onAddClassType,
  onClassTypeColorChange,
  hiddenClassTypes,
  onToggleClassTypeVisibility,
  onToggleAllClassTypesVisible,
  onImport,
  onLoad,
  onSave,
  onExport,
}: SchedulerDrawerProps) {
  const [newRoomName, setNewRoomName] = useState('');
  const [newClassTypeName, setNewClassTypeName] = useState('');
  const [newClassTypeColor, setNewClassTypeColor] = useState(DEFAULT_NEW_CLASS_TYPE_COLOR);
  const [instructorSearch, setInstructorSearch] = useState('');
  // Each class type's real <input type="color"> lives hidden in its row —
  // the popover's "Custom color" option forwards a click to this native
  // picker; the new-class-type row has its own single hidden input below.
  const classTypeColorInputs = useRef(new Map<string, HTMLInputElement>());
  const newClassTypeColorInput = useRef<HTMLInputElement>(null);
  // Which row's color popover is open, if any (an existing class type's
  // name, or NEW_CLASS_TYPE_COLOR_MENU for the add row), and where to render
  // it — measured from the trigger's own coordinates (not CSS-relative to
  // the row) so it isn't clipped by, or added to the scrollable height of,
  // the list's own overflow, the same reasoning as InstructorViewDialog's
  // availability row menu.
  const [openColorMenuFor, setOpenColorMenuFor] = useState<string | typeof NEW_CLASS_TYPE_COLOR_MENU | null>(null);
  const [colorMenuPosition, setColorMenuPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!openColorMenuFor) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('[data-color-menu]')) return;
      setOpenColorMenuFor(null);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openColorMenuFor]);

  const filteredInstructors = instructors.filter((instructor) =>
    instructor.name.toLowerCase().includes(instructorSearch.trim().toLowerCase()),
  );

  function handlePickClassTypeColor(name: string, color: string) {
    onClassTypeColorChange?.(name, color);
    setOpenColorMenuFor(null);
  }

  function handleOpenColorWheel(name: string) {
    setOpenColorMenuFor(null);
    classTypeColorInputs.current.get(name)?.click();
  }

  function handlePickNewClassTypeColor(color: string) {
    setNewClassTypeColor(color);
    setOpenColorMenuFor(null);
  }

  function handleOpenNewClassTypeColorWheel() {
    setOpenColorMenuFor(null);
    newClassTypeColorInput.current?.click();
  }

  function handleAddRoom() {
    const title = newRoomName.trim();
    if (!title) return;
    const id = `room-${resources.length + 1}-${title.toLowerCase().replace(/\s+/g, '-')}`;
    onAddResource?.({ id, title });
    setNewRoomName('');
  }

  function handleAddClassType() {
    const name = newClassTypeName.trim();
    if (!name || classTypes.some((classType) => classType.name === name)) return;
    onAddClassType?.({ name, color: newClassTypeColor });
    setNewClassTypeName('');
    setNewClassTypeColor(DEFAULT_NEW_CLASS_TYPE_COLOR);
  }

  return (
    <div className={[styles.drawer, open ? styles.drawerOpen : ''].join(' ').trim()} aria-hidden={!open}>
      <div className={styles.content}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Schedule</h3>
          <div className={styles.actionGrid}>
            <button type="button" className={styles.actionButton} onClick={onImport} title="Import events from a file">
              Import
            </button>
            <button type="button" className={styles.actionButton} onClick={onLoad} title="Load a saved schedule">
              Load
            </button>
            <button
              type="button"
              className={[styles.actionButton, styles.actionButtonPrimary].join(' ')}
              onClick={onSave}
              title="Save the current schedule"
            >
              Save
            </button>
            <button
              type="button"
              className={[styles.actionButton, styles.actionButtonPrimary].join(' ')}
              onClick={onExport}
              title="Export events to a file"
            >
              Export
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Filters</h3>
          <label className={styles.fieldLabel}>Color events by</label>
          <div className={styles.segmented}>
            <button
              type="button"
              className={[styles.segmentButton, colorMode === 'resource' ? styles.segmentButtonActive : ''].join(' ').trim()}
              onClick={() => onColorModeChange('resource')}
            >
              Room
            </button>
            <button
              type="button"
              className={[styles.segmentButton, colorMode === 'type' ? styles.segmentButtonActive : ''].join(' ').trim()}
              onClick={() => onColorModeChange('type')}
            >
              Type
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Rooms</h3>
          <ul className={[styles.itemList, styles.scrollableList].join(' ')}>
            {resources.map((room) => (
              <li key={room.id} className={styles.itemRow}>
                <span className={styles.itemLabel}>{room.title}</span>
              </li>
            ))}
          </ul>
          <div className={styles.addRow}>
            <input
              type="text"
              className={styles.textInput}
              placeholder="New room name"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddRoom();
              }}
            />
            <button type="button" className={styles.addButtonGhost} onClick={handleAddRoom} aria-label="Add room">
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h3 className={styles.sectionTitle}>Instructors</h3>
            <button
              type="button"
              className={styles.selectAllButton}
              onClick={onToggleAllInstructorsVisible}
              disabled={instructors.length === 0}
            >
              {hiddenInstructorIds.size === 0 ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <input
            type="text"
            className={styles.textInput}
            placeholder="Search instructors"
            value={instructorSearch}
            onChange={(e) => setInstructorSearch(e.target.value)}
            aria-label="Search instructors"
          />
          <ul className={[styles.itemList, styles.scrollableList].join(' ')}>
            {filteredInstructors.length === 0 && (
              <li className={[styles.itemRow, styles.emptyState].join(' ')}>No matching instructors</li>
            )}
            {filteredInstructors.map((instructor) => {
              const visible = !hiddenInstructorIds.has(instructor.id);
              return (
                <li
                  key={instructor.id}
                  className={[styles.itemRow, styles.instructorItemRow].join(' ')}
                  onClick={() => onToggleInstructorVisibility(instructor.id)}
                >
                  <span className={styles.dot} data-active={visible}>
                    <button
                      type="button"
                      className={styles.dotToggleButton}
                      aria-pressed={visible}
                      aria-label={`${visible ? 'Hide' : 'Show'} ${instructor.name} on the calendar`}
                    />
                  </span>
                  <button
                    type="button"
                    className={styles.instructorRowButton}
                    onClick={(e) => {
                      // Opening the instructor view is a separate action from
                      // toggling visibility — don't let it also bubble up to
                      // the row's own click handler.
                      e.stopPropagation();
                      onViewInstructor?.(instructor.id);
                    }}
                  >
                    {instructor.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h3 className={styles.sectionTitle}>Class Types</h3>
            <button
              type="button"
              className={styles.selectAllButton}
              onClick={onToggleAllClassTypesVisible}
              disabled={classTypes.length === 0}
            >
              {hiddenClassTypes.size === 0 ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <ul className={styles.itemList}>
            {classTypes.map((classType) => {
              const visible = !hiddenClassTypes.has(classType.name);
              return (
                <li
                  key={classType.name}
                  className={[styles.itemRow, styles.classTypeRow].join(' ')}
                  onClick={() => onToggleClassTypeVisibility(classType.name)}
                >
                  <span className={styles.dot} style={{ '--row-color': classType.color } as React.CSSProperties} data-active={visible}>
                    <button
                      type="button"
                      className={styles.dotToggleButton}
                      aria-pressed={visible}
                      aria-label={`${visible ? 'Hide' : 'Show'} ${classType.name} on the calendar`}
                    />
                  </span>
                  <span className={styles.itemLabel}>{classType.name}</span>
                  {/* Clicks anywhere in here shouldn't also toggle visibility on the
                      row underneath — the "..." trigger and its popover open the
                      color picker, an unrelated action. */}
                  <div className={styles.colorMenuWrapper} data-color-menu onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.classTypeMoreButton}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setColorMenuPosition({ top: rect.bottom + 6, left: rect.left });
                        setOpenColorMenuFor((current) => (current === classType.name ? null : classType.name));
                      }}
                      aria-label={`Change ${classType.name} color`}
                      aria-haspopup="menu"
                      aria-expanded={openColorMenuFor === classType.name}
                      title="Change color"
                    >
                      <MoreHorizontal size={22} />
                    </button>
                    {openColorMenuFor === classType.name && colorMenuPosition && (
                      <ColorPresetMenu
                        position={colorMenuPosition}
                        selectedColor={classType.color}
                        onPick={(color) => handlePickClassTypeColor(classType.name, color)}
                        onOpenWheel={() => handleOpenColorWheel(classType.name)}
                      />
                    )}
                  </div>
                  <input
                    type="color"
                    ref={(el) => {
                      if (el) classTypeColorInputs.current.set(classType.name, el);
                      else classTypeColorInputs.current.delete(classType.name);
                    }}
                    className={styles.hiddenColorInput}
                    value={classType.color}
                    onChange={(e) => onClassTypeColorChange?.(classType.name, e.target.value)}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </li>
              );
            })}
          </ul>
          <div className={styles.addRow}>
            <div className={styles.inlineColorMenuWrapper} data-color-menu>
              <span
                className={[styles.dot, styles.newClassTypeDot].join(' ')}
                style={{ '--row-color': newClassTypeColor } as React.CSSProperties}
                data-active="true"
              >
                <button
                  type="button"
                  className={styles.dotToggleButton}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setColorMenuPosition({ top: rect.bottom + 6, left: rect.left });
                    setOpenColorMenuFor((current) => (current === NEW_CLASS_TYPE_COLOR_MENU ? null : NEW_CLASS_TYPE_COLOR_MENU));
                  }}
                  aria-label="Choose new class type color"
                  aria-haspopup="menu"
                  aria-expanded={openColorMenuFor === NEW_CLASS_TYPE_COLOR_MENU}
                />
              </span>
              {openColorMenuFor === NEW_CLASS_TYPE_COLOR_MENU && colorMenuPosition && (
                <ColorPresetMenu
                  position={colorMenuPosition}
                  selectedColor={newClassTypeColor}
                  onPick={handlePickNewClassTypeColor}
                  onOpenWheel={handleOpenNewClassTypeColorWheel}
                />
              )}
              <input
                type="color"
                ref={newClassTypeColorInput}
                className={styles.hiddenColorInput}
                value={newClassTypeColor}
                onChange={(e) => setNewClassTypeColor(e.target.value)}
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
            <input
              type="text"
              className={styles.textInput}
              placeholder="New class type"
              value={newClassTypeName}
              onChange={(e) => setNewClassTypeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddClassType();
              }}
            />
            <button type="button" className={styles.addButtonGhost} onClick={handleAddClassType} aria-label="Add class type">
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Settings</h3>

          <label className={styles.fieldLabel} htmlFor="sched-week-starts-on">Week starts on</label>
          <div className={styles.segmented}>
            <button
              type="button"
              className={[styles.segmentButton, weekStartsOn === 1 ? styles.segmentButtonActive : ''].join(' ').trim()}
              onClick={() => onWeekStartsOnChange(1)}
            >
              Monday
            </button>
            <button
              type="button"
              className={[styles.segmentButton, weekStartsOn === 0 ? styles.segmentButtonActive : ''].join(' ').trim()}
              onClick={() => onWeekStartsOnChange(0)}
            >
              Sunday
            </button>
          </div>

          <label className={styles.fieldLabel} htmlFor="sched-week-orientation">Week layout</label>
          <div className={styles.segmented}>
            <button
              type="button"
              className={[styles.segmentButton, weekOrientation === 'horizontal' ? styles.segmentButtonActive : ''].join(' ').trim()}
              onClick={() => onWeekOrientationChange('horizontal')}
            >
              Horizontal
            </button>
            <button
              type="button"
              className={[styles.segmentButton, weekOrientation === 'vertical' ? styles.segmentButtonActive : ''].join(' ').trim()}
              onClick={() => onWeekOrientationChange('vertical')}
            >
              Vertical
            </button>
          </div>

          <label className={styles.fieldLabel} htmlFor="sched-day-start">Business hours</label>
          <div className={styles.hourRangeBox}>
            <span className={styles.hourRangeSelectWrapper}>
              <select
                id="sched-day-start"
                className={styles.hourRangeSelect}
                value={dayStartHour}
                onChange={(e) => onDayStartHourChange(Number(e.target.value))}
              >
                {HOURS.filter((h) => h < dayEndHour).map((h) => (
                  <option key={h} value={h}>{formatBusinessHourLabel(h)}</option>
                ))}
              </select>
              <ChevronDown className={styles.hourRangeChevron} size={14} />
            </span>
            <span className={styles.hourRangeTo}>to</span>
            <span className={styles.hourRangeSelectWrapper}>
              <select
                className={styles.hourRangeSelect}
                value={dayEndHour}
                onChange={(e) => onDayEndHourChange(Number(e.target.value))}
                aria-label="Business hours end"
              >
                {HOURS.filter((h) => h > dayStartHour).map((h) => (
                  <option key={h} value={h}>{formatBusinessHourLabel(h)}</option>
                ))}
              </select>
              <ChevronDown className={styles.hourRangeChevron} size={14} />
            </span>
          </div>

          <label className={styles.fieldLabel} htmlFor="sched-slot-minutes">Column width</label>
          <select
            id="sched-slot-minutes"
            className={styles.select}
            value={slotMinutes}
            onChange={(e) => onSlotMinutesChange(Number(e.target.value))}
          >
            {SLOT_OPTIONS.map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>

          <label className={styles.fieldLabel} htmlFor="sched-snap-minutes">Snap interval</label>
          <select
            id="sched-snap-minutes"
            className={styles.select}
            value={snapMinutes}
            onChange={(e) => onSnapMinutesChange(Number(e.target.value))}
          >
            {SNAP_OPTIONS.map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
        </section>
      </div>
    </div>
  );
}

/**
 * Shared popover body for both an existing class type's "..." button and the
 * "New class type" row's swatch — a grid of presets plus a "Custom color"
 * fallback that opens the caller's own native `<input type="color">`.
 * Position is always `fixed`, measured by the caller from its trigger's own
 * `getBoundingClientRect()` (see the two call sites above), so it isn't
 * clipped by, or added to the scrollable height of, an ancestor's overflow.
 */
function ColorPresetMenu({
  position,
  selectedColor,
  onPick,
  onOpenWheel,
}: {
  position: { top: number; left: number };
  selectedColor: string;
  onPick: (color: string) => void;
  onOpenWheel: () => void;
}) {
  return (
    <div className={styles.colorMenu} role="menu" style={{ position: 'fixed', top: position.top, left: position.left }}>
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
            aria-label={`Set color ${color}`}
          />
        ))}
      </div>
      <button type="button" role="menuitem" className={styles.colorWheelButton} onClick={onOpenWheel}>
        <Plus size={16} strokeWidth={2.5} />
        <span>Custom color</span>
      </button>
    </div>
  );
}
