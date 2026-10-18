import { read, utils } from 'xlsx'

// Shared low-level helpers for reading REDCap "Data Labels" CSV exports —
// used by both parseInstructorSurveyCsv.ts and parseClassProfileCsv.ts,
// since both forms are exported the same way and hit the same gotchas.

export function readCsvRows(csvText: string): { header: string[]; rows: string[][] } {
  // Remove BOM if present (some CSV exports include it, which can break parsing)
  const cleanedText = csvText.replace(/^\uFEFF/, '')
  // read csv into a workbook. raw: true stops SheetJS from being "smart"
  // about cell types — without it, a cell like "08:00" gets silently
  // converted into an Excel-style time serial number (a fraction of a day,
  // e.g. 0.333... for 8am) instead of staying the literal string every
  // downstream parser here expects.
  const workbook = read(cleanedText, { type: 'string', raw: true })
  // get the first sheet and convert it to JSON
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  // convert the sheet to a 2D array of strings
  const jsonData = utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }) // defval ensures empty cells are represented as empty strings
  // return the header and rows
  return {
    header: jsonData[0] as string[],
    rows: jsonData.slice(1).map((row) => row as string[]),
  }
}

// Every scalar field lives at a fixed, one-off column — a plain indexOf is
// enough (no need to collect multiple matches like a checkbox field does).
export function findColumnIndex(header: string[], label: string): number {
  const index = header.indexOf(label)
  if (index === -1) throw new Error(`Expected a column labeled "${label}"`)
  return index
}

// Same idea as findColumnIndex, but returns -1 instead of throwing when the
// column is missing — for a field added to the form after some real CSV
// exports already existed elsewhere (e.g. class_intensity), so re-importing
// an older export still works instead of failing the whole parse over one
// field that simply reads as blank/unknown on that older data.
export function findColumnIndexOptional(header: string[], label: string): number {
  return header.indexOf(label)
}

// Same idea as findColumnIndex, but matches a (short, stable) PREFIX of the
// label instead of the whole thing — for long question texts that have
// changed wording deep in the sentence before (see parseInstructorSurveyCsv.ts's
// own history), matching just the first clause is less likely to break on
// the next minor rewording.
export function findColumnIndexByPrefix(header: string[], prefix: string): number {
  const index = header.findIndex((cell) => cell.startsWith(prefix))
  if (index === -1) throw new Error(`Expected a column starting with "${prefix}"`)
  return index
}

// example: "...Select the class(es) you will be teaching from the list:...(choice=Aerobic Conditioning)"
// -> "Aerobic Conditioning"
export function extractChoiceLabel(headerCell: string): string | null {
  // .+ is greedy, so it matches up through the LAST "(choice=...)" — needed
  // because some choice labels have their own parentheses, e.g. "Balls and
  // Bands (VIRTUAL)" or "Virtual (e.g. Zoom)". A non-greedy match would stop
  // at the first ")" and truncate those.
  const match = headerCell.match(/\(choice=(.+)\)$/)
  return match ? match[1] : null
}

// Extracts the leading number from a fixed-choice dropdown answer like
// "10+", "5+", or "45 minutes" — or null when the answer has no number at
// all ("Unsure/ Flexible", "Depends on the classes", or left blank). null
// must NOT be treated as 0 — it means "unspecified", not "none".
export function parseLeadingNumber(text: string): number | null {
  const match = text.match(/(\d+)/)
  return match ? Number(match[1]) : null
}

// For a dropdown whose preset choices parse the normal way but whose
// "Other" choice has a real follow-up integer field instead of no
// elaboration at all — e.g. preferredGapMinutes/class_time_inbetween,
// class_duration/class_duration_other. "Other" reads the follow-up column
// rather than falling back to null.
export function parseNumberWithOtherFallback(dropdownValue: string, otherValue: string): number | null {
  if (dropdownValue === 'Other') return parseLeadingNumber(otherValue)
  return parseLeadingNumber(dropdownValue)
}

/** REDCap's own built-in survey status enum — see either parser's docs for what each value actually means (in particular, "Unverified" is NOT a rejected/invalid response). */
export type SurveyCompletionStatus = 'Incomplete' | 'Unverified' | 'Complete'

/**
 * Groups rows by `keyFn` and keeps only the most-recently-submitted row per
 * group: "Incomplete" rows (started but never actually submitted) are
 * excluded whenever a real submitted row exists for the same key, and among
 * the rest, the most recent `surveyTimestamp` wins outright — regardless of
 * verification status (confirmed with Samiat: this applies to real
 * production duplicate submissions, not just test data).
 */
export function pickMostRecentPerKey<T extends { completionStatus: SurveyCompletionStatus; surveyTimestamp: string }>(
  rows: T[],
  keyFn: (row: T) => string,
): T[] {
  const grouped: Record<string, T[]> = {}
  for (const row of rows) {
    const key = keyFn(row)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(row)
  }

  const winners: T[] = []
  for (const key in grouped) {
    const group = grouped[key]
    const submitted = group.filter((row) => row.completionStatus !== 'Incomplete')
    // Only fall back to an Incomplete row if that's genuinely all there is
    // — an abandoned draft is still better than nothing.
    const candidates = submitted.length > 0 ? submitted : group
    // Survey Timestamp's "YYYY-MM-DD HH:MM:SS" shape sorts correctly as a
    // plain string, no date parsing needed.
    candidates.sort((a, b) => b.surveyTimestamp.localeCompare(a.surveyTimestamp))
    winners.push(candidates[0])
  }
  return winners
}
