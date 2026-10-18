import type { ClassTypeOption, EventColorMode, Resource, SchedulerEvent } from '../Scheduler.types';

const UNTYPED_LABEL = 'Unspecified';

// Desaturated ~15-20% from the original candy-bright set (kept as a comment
// for reference: #22c55e, #f59e0b, #ec4899, #06b6d4, #8b5cf6, #ef4444,
// #14b8a6, #eab308, #6366f1) — a full-saturation rainbow across 10 categories
// competed with the events themselves for attention. The first entry (blue)
// stays at full strength on purpose: it doubles as the app's own accent
// color, so it's the one deliberately brighter note in the set.
const PALETTE = [
  '#4f6df5', '#4f9d6c', '#c98a4b', '#c76f94', '#4a9aa8',
  '#8778c9', '#c26b6b', '#3f9d90', '#c2a23f', '#7b7ed6',
];

/**
 * Resolves each event's display color for the given mode:
 * - 'resource': one color per resource, assigned in the order resources were
 *   given (so it's stable and collision-free as long as resources.length <=
 *   the palette size).
 * - 'type': one color per distinct `event.type`, assigned by sorting the
 *   type strings alphabetically — stable regardless of event order, only
 *   shifting when a genuinely new type value shows up.
 * Falls back to the event's own explicit `color`, then the palette's first
 * entry, if the dimension being colored by doesn't resolve to anything.
 *
 * 'type' mode prefers each class type's user-picked color (`classTypes`, set
 * in the drawer's "Class Types" section) — any type not registered there yet
 * still gets an auto-assigned palette color so nothing renders uncolored.
 */
export function computeEventColors(
  events: SchedulerEvent[],
  resources: Resource[],
  mode: EventColorMode,
  classTypes: ClassTypeOption[] = [],
): Map<string, string> {
  const colorById = new Map<string, string>();

  if (mode === 'resource') {
    const resourceColor = new Map<string, string>();
    resources.forEach((resource, i) => resourceColor.set(resource.id, PALETTE[i % PALETTE.length]));
    for (const event of events) {
      colorById.set(event.id, resourceColor.get(event.resourceId) ?? event.color ?? PALETTE[0]);
    }
    return colorById;
  }

  const typeColor = new Map<string, string>();
  classTypes.forEach((classType) => typeColor.set(classType.name, classType.color));

  const unregisteredTypes = Array.from(new Set(events.map((e) => e.type ?? UNTYPED_LABEL)))
    .filter((type) => !typeColor.has(type))
    .sort();
  unregisteredTypes.forEach((type, i) => typeColor.set(type, PALETTE[i % PALETTE.length]));

  for (const event of events) {
    colorById.set(event.id, typeColor.get(event.type ?? UNTYPED_LABEL) ?? event.color ?? PALETTE[0]);
  }
  return colorById;
}
