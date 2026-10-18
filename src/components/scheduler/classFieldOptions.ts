import type { Resource } from './Scheduler.types';

// Shared option vocabulary + mutation rules for the Delivery/Room needs/
// Intensity fields — used by BOTH EventPopover.tsx's own edit modal (for a
// placed SchedulerEvent) and UnplacedClassPopover.tsx's own edit modal (for
// a not-yet-placed UnplacedClass), so the two popovers' "same" fields
// actually run the same code rather than two independently-typed-out copies
// that could quietly drift apart (the original problem this file fixes —
// see UnplacedClassPopover.tsx's own doc comment). Deliberately a plain .ts
// module, not exported from EventPopover.tsx itself: react-refresh's own
// only-export-components rule only tolerates a component file also
// exporting scalar (string/number) constants, not arrays/objects/functions
// like the ones below.

export const DELIVERY_FORMAT_OPTIONS = ['In-Person', 'Virtual', 'Hybrid'];
// Hybrid's own pill shows this shortened label — its full meaning goes in
// the pill's title tooltip instead (see NeedsPillGrid's own optionTitles).
export const DELIVERY_FORMAT_TITLES = { Hybrid: 'Hybrid (In-Person + Virtual simultaneously)' };

// The one room need that means "there are no specific requirements" rather
// than a real requirement to match a room against (see allocate.ts's own
// NEEDS_ALWAYS_SATISFIED) — mutually exclusive with every other room need
// (see toggleRoomNeedValue) and rendered as its own standalone pill, outside
// the "Room needs" field's scrollable list of actual specific needs.
export const NO_ROOM_FEATURES = 'No specific room features required';

// How many room needs the read-only row shows before collapsing the rest
// behind a "+N more" toggle — a class with many needs joined into one long
// comma-separated line wrapped across 3+ lines and read as noisy/overwhelming
// next to every other field's own single short line.
export const ROOM_NEEDS_COLLAPSED_COUNT = 2;

export const INTENSITY_OPTIONS = ['Low-Moderate', 'Moderate-High', 'Not Applicable'];

/** NO_ROOM_FEATURES and every other room need are mutually exclusive — a class either has specific room requirements or explicitly has none; "none" plus one specific need at the same time isn't a meaningful combination (allocate.ts's own NEEDS_ALWAYS_SATISFIED already treats NO_ROOM_FEATURES as a special always-met sentinel, not a real requirement to match against). Picking NO_ROOM_FEATURES clears every other selected need; picking any other need drops NO_ROOM_FEATURES. Returns undefined (not []) for "nothing selected", matching SchedulerEvent/UnplacedClass's own optional roomNeeds field. */
export function toggleRoomNeedValue(current: string[] | undefined, need: string): string[] | undefined {
  const cur = current ?? [];
  if (need === NO_ROOM_FEATURES) {
    const next = cur.includes(need) ? [] : [NO_ROOM_FEATURES];
    return next.length > 0 ? next : undefined;
  }
  const withoutNoFeatures = cur.filter((n) => n !== NO_ROOM_FEATURES);
  const next = withoutNoFeatures.includes(need) ? withoutNoFeatures.filter((n) => n !== need) : [...withoutNoFeatures, need];
  return next.length > 0 ? next : undefined;
}

/** Appends a brand new (never-before-seen) room need via NeedsPillGrid's own "+ Add new" affordance — dropping NO_ROOM_FEATURES first (same mutual-exclusivity rule as toggleRoomNeedValue), and no-op if it's already present. */
export function addRoomNeedValue(current: string[] | undefined, name: string): string[] | undefined {
  const cur = (current ?? []).filter((n) => n !== NO_ROOM_FEATURES);
  if (cur.includes(name)) return cur.length > 0 ? cur : undefined;
  return [...cur, name];
}

/** Same plain toggle as toggleRoomNeedValue, but over DELIVERY_FORMAT_OPTIONS's closed set — no mutual-exclusivity rule (a class can be both In-Person and Virtual). */
export function toggleDeliveryFormatValue(current: string[] | undefined, format: string): string[] | undefined {
  const cur = current ?? [];
  const next = cur.includes(format) ? cur.filter((f) => f !== format) : [...cur, format];
  return next.length > 0 ? next : undefined;
}

/** "What's available" for the Room needs field, derived from the real room inventory — the union of every room's own roomNeeds, deduplicated, plus whatever `currentRoomNeeds` already include (so an existing, less-common need still renders as its own selected pill even if no current room happens to offer it), excluding NO_ROOM_FEATURES (that one renders as its own standalone pill, not part of this scrollable list). Same reasoning/pattern as NewEventDrawer.tsx's own "Class needs" field. */
export function getRoomNeedPills(resources: Resource[], currentRoomNeeds: string[] | undefined): string[] {
  const availableRoomNeeds = Array.from(new Set(resources.flatMap((resource) => resource.roomNeeds ?? [])));
  return Array.from(new Set([...availableRoomNeeds, ...(currentRoomNeeds ?? [])])).filter((need) => need !== NO_ROOM_FEATURES);
}
