/** "Program Scheduler Export - 2026-07-26 01-16.json" — a sortable date, then time (to avoid collisions between two saves made the same day). */
export function exportFilename(extension: string): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`
  return `Program Scheduler Export - ${date} ${time}.${extension}`
}
