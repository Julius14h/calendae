// Deterministic per-instructor color, independent of any event's own
// category color — the point is that the SAME instructor always gets the
// SAME color everywhere, so a repeated color across different rooms/class
// types on the same day visually flags a double-booking. Hues are stepped by
// the golden angle (~137.508°) rather than evenly divided by instructor
// count: it keeps consecutive ids from landing on near-identical hues even
// as the roster grows, without needing to know the roster size up front.
const GOLDEN_ANGLE = 137.508;

export function colorForInstructor(instructorId: number): string {
  const hue = (instructorId * GOLDEN_ANGLE) % 360;
  return `hsl(${hue}, 65%, 42%)`;
}
