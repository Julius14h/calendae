import { extractChoiceLabel, findColumnIndex, findColumnIndexByPrefix, findColumnIndexOptional, parseLeadingNumber, parseNumberWithOtherFallback, pickMostRecentPerKey, readCsvRows } from './csvUtils'
import type { DedupedClassProfileRow, ParsedClassProfile, ParsedClassProfileRow } from './types'

// Short, stable prefixes for the two long dropdown questions — matching
// just the first clause is less likely to break if the wording changes
// deeper in the sentence (as already happened once to the Availability
// Form's questions — see parseInstructorSurveyCsv.ts's history).
const FITNESS_CLASS_DROPDOWN_PREFIX = 'If Fitness & Aquatics, please select the class'
const MBS_CLASS_DROPDOWN_PREFIX = 'If Mind, Body, & Soul Wellness, please select the class'

// Literal value REDCap exports for this survey's "Other" class-selection
// choice — distinct from the Availability Form's plain "Other" (this form's
// choice list itself is worded "Other/ New Class").
const OTHER_CLASS_VALUE = 'Other/ New Class'

const ROOM_NEEDS_PREFIX =
  'Which room or space features are essential for this class to operate safely and as intended? Only select the features that are required.'

const DELIVERY_FORMATS_PREFIX =
  'Which delivery format(s) could you teach this class in for this term? Select all that apply.'

function getClassProfileColumnIndices(header: string[]) {
  // Each domain's own "If you selected Other, please list the name(s) of
  // class(es) you will be offering:" column has the EXACT SAME label text
  // for both domains (can't disambiguate by searching for it directly), but
  // it's always the column immediately after that domain's own class
  // dropdown — a fixed, deterministic offset, not something that needs
  // header-order tracking to resolve.
  const fitnessClassDropdown = findColumnIndexByPrefix(header, FITNESS_CLASS_DROPDOWN_PREFIX)
  const mbsClassDropdown = findColumnIndexByPrefix(header, MBS_CLASS_DROPDOWN_PREFIX)

  return {
    id: findColumnIndex(header, 'Record ID'),
    name: findColumnIndex(header, 'First and last name'),
    email: findColumnIndex(header, 'Email address'),
    domain: findColumnIndex(header, 'Which domain does this class fall under?'),
    fitnessClassDropdown,
    fitnessClassOther: fitnessClassDropdown + 1,
    mbsClassDropdown,
    mbsClassOther: mbsClassDropdown + 1,
    duration: findColumnIndex(header, 'What is the duration of the class?'),
    durationOther: findColumnIndex(header, 'Please write the duration of the class in minutes'),
    maxParticipation: findColumnIndex(header, 'What is the maximum number of participants?'),
    // Optional lookup: this question (class_intensity) was added to the form
    // after some real exports already existed — see findColumnIndexOptional's
    // own doc comment.
    intensity: findColumnIndexOptional(header, 'What is the intended intensity for this class?'),
    completionStatus: findColumnIndex(header, 'Complete?'),
    surveyTimestamp: findColumnIndex(header, 'Survey Timestamp'),
  }
}

type ClassProfileColumnIndices = ReturnType<typeof getClassProfileColumnIndices>

// Only one of fitnessClassDropdown/mbsClassDropdown will actually have a
// value in any given row (the other domain's question isn't shown to that
// respondent at all) — whichever is non-empty is this class's real domain.
// Selecting the dropdown's own "Other/ New Class" choice means the actual
// name lives in the adjacent free-text column instead.
function getClassName(row: string[], c: ClassProfileColumnIndices): string {
  const fitnessValue = row[c.fitnessClassDropdown]
  if (fitnessValue) {
    return fitnessValue === OTHER_CLASS_VALUE ? row[c.fitnessClassOther] : fitnessValue
  }
  const mbsValue = row[c.mbsClassDropdown]
  if (mbsValue) {
    return mbsValue === OTHER_CLASS_VALUE ? row[c.mbsClassOther] : mbsValue
  }
  return ''
}

interface RoomNeedsColumnIndex {
  index: number
  label: string
}

// Finds every "(choice=X)" column under the room_needs question specifically
// — there are three other questions in this form sharing the exact same
// generic "If Other, please describe" follow-up label (why_max_num,
// class_equipment, class_position_formats), but none of those are needed
// here, so this only needs to locate room_needs's own block, not
// disambiguate all four.
function getRoomNeedsColumnIndices(header: string[]): RoomNeedsColumnIndex[] {
  const indices: RoomNeedsColumnIndex[] = []
  header.forEach((cell, index) => {
    if (!cell.startsWith(ROOM_NEEDS_PREFIX)) return
    const label = extractChoiceLabel(cell)
    if (label) indices.push({ index, label })
  })
  return indices
}

// room_needs's own "If Other, please describe" column is always the very
// next column after its last "(choice=X)" entry (checked directly here
// rather than assumed, so this fails loudly instead of silently reading the
// wrong question's free text if REDCap ever reorders these fields).
function getRoomNeedsOtherIndex(header: string[], roomNeedsColumnIndices: RoomNeedsColumnIndex[]): number {
  const lastChoiceIndex = Math.max(...roomNeedsColumnIndices.map((c) => c.index))
  const otherIndex = lastChoiceIndex + 1
  if (header[otherIndex] !== 'If Other, please describe') {
    throw new Error('Expected room_needs\'s "Other" free-text column immediately after its last choice column')
  }
  return otherIndex
}

// One row's actual required room features — every "Checked" choice, plus
// whatever free text was typed for a checked "Other" (in place of the bare
// word "Other" itself, same pattern as the Availability Form's class-Other
// handling). "No specific room features required" is a real, meaningful
// answer on its own and is kept as-is, not filtered out.
function getRoomNeeds(row: string[], roomNeedsColumnIndices: RoomNeedsColumnIndex[], otherIndex: number): string[] {
  const needs: string[] = []
  for (const { index, label } of roomNeedsColumnIndices) {
    if (row[index] !== 'Checked') continue
    if (label === 'Other') {
      const otherText = row[otherIndex]
      if (otherText) needs.push(otherText)
      continue
    }
    needs.push(label)
  }
  return needs
}

interface DeliveryFormatColumnIndex {
  index: number
  label: string
}

// Same shape of question as room_needs above (a "Select all that apply"
// checkbox group), but simpler — no "Other" choice/follow-up text field to
// handle here at all.
function getDeliveryFormatColumnIndices(header: string[]): DeliveryFormatColumnIndex[] {
  const indices: DeliveryFormatColumnIndex[] = []
  header.forEach((cell, index) => {
    if (!cell.startsWith(DELIVERY_FORMATS_PREFIX)) return
    const label = extractChoiceLabel(cell)
    if (label) indices.push({ index, label })
  })
  return indices
}

function getDeliveryFormats(row: string[], deliveryFormatColumnIndices: DeliveryFormatColumnIndex[]): string[] {
  return deliveryFormatColumnIndices.filter(({ index }) => row[index] === 'Checked').map(({ label }) => label)
}

function getClassProfileRow(
  row: string[],
  columnIndices: ClassProfileColumnIndices,
  roomNeedsColumnIndices: RoomNeedsColumnIndex[],
  roomNeedsOtherIndex: number,
  deliveryFormatColumnIndices: DeliveryFormatColumnIndex[],
): ParsedClassProfileRow {
  const c = columnIndices
  return {
    id: row[c.id],
    name: row[c.name],
    email: row[c.email],
    domain: row[c.domain],
    className: getClassName(row, c),
    durationMinutes: parseNumberWithOtherFallback(row[c.duration], row[c.durationOther]),
    maxParticipation: parseLeadingNumber(row[c.maxParticipation]),
    // c.intensity is -1 when this column doesn't exist in an older export —
    // row[-1] reads as undefined, same as a genuinely blank cell.
    intensity: row[c.intensity] || undefined,
    roomNeeds: getRoomNeeds(row, roomNeedsColumnIndices, roomNeedsOtherIndex),
    deliveryFormats: getDeliveryFormats(row, deliveryFormatColumnIndices),
    completionStatus: row[c.completionStatus] as ParsedClassProfileRow['completionStatus'],
    surveyTimestamp: row[c.surveyTimestamp],
  }
}

// Keeps only the most-recently-submitted row per (email, className) — this
// survey is one submission per CLASS, not per instructor, so the same
// person legitimately has many rows (one per class they teach); deduping
// by email alone would wrongly collapse all of someone's different classes
// down to just one. Only `surveyTimestamp` is dropped here — `email` is
// kept (see DedupedClassProfileRow's own doc for why) and stripped
// separately by parseClassProfileCsv.
function dedupeClassProfileRows(parsedRows: ParsedClassProfileRow[]): DedupedClassProfileRow[] {
  const winners = pickMostRecentPerKey(parsedRows, (row) => `${row.email} ${row.className}`)
  return winners.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { surveyTimestamp: _surveyTimestamp, ...winner } = row
    return winner
  })
}

// Ties every previous step together: read the CSV, compute every column
// lookup once from the header, parse every row, then dedupe. Exported (not
// just an internal step of parseClassProfileCsv below) because
// buildRoster.ts needs the deduped rows WITH email still attached, to join
// against Availability Form data.
export function parseDedupedClassProfileRows(csvText: string): DedupedClassProfileRow[] {
  const { header, rows } = readCsvRows(csvText)

  const columnIndices = getClassProfileColumnIndices(header)
  const roomNeedsColumnIndices = getRoomNeedsColumnIndices(header)
  const roomNeedsOtherIndex = getRoomNeedsOtherIndex(header, roomNeedsColumnIndices)
  const deliveryFormatColumnIndices = getDeliveryFormatColumnIndices(header)

  const parsedRows = rows.map((row) =>
    getClassProfileRow(row, columnIndices, roomNeedsColumnIndices, roomNeedsOtherIndex, deliveryFormatColumnIndices),
  )

  return dedupeClassProfileRows(parsedRows)
}

export function parseClassProfileCsv(csvText: string): ParsedClassProfile[] {
  return parseDedupedClassProfileRows(csvText).map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { email: _email, ...winner } = row
    return winner
  })
}
