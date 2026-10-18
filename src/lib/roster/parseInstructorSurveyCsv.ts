import { extractChoiceLabel, findColumnIndex, parseLeadingNumber, parseNumberWithOtherFallback, pickMostRecentPerKey, readCsvRows } from './csvUtils'
import type { AvailabilityBlock, ConsecutiveComfort, DedupedInstructorRow, ParsedInstructorRow, ParsedSurveyInstructor } from './types'


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// availability functions
function getTimeBlocksIndices(header: string[]): { day: string; startIndex: number; endIndex: number }[] {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Sunday']
  const timeBlocksIndices: { day: string; startIndex: number; endIndex: number }[] = []
  for (const day of days) {
    header.forEach((cell, i) => {
      if (cell === `${day} Start Time`) {
        // endIndex is derived as startIndex + 1
        timeBlocksIndices.push({ day, startIndex: i, endIndex: i + 1 })
      }
    })
  }
  return timeBlocksIndices
}

// Parses a time string in the format "hh:mm" to minutes since midnight.
function parseTimeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

function getAvailabilityBlocks(row: string[], timeBlocksIndices: { day: string; startIndex: number; endIndex: number }[]): AvailabilityBlock[] {
  const availabilityBlocks: AvailabilityBlock[] = []
  for (const { day, startIndex, endIndex } of timeBlocksIndices) {
    const startTimeStr = row[startIndex]
    const endTimeStr = row[endIndex]
    if (startTimeStr && endTimeStr) {
      const startMinutes = parseTimeToMinutes(startTimeStr)
      const endMinutes = parseTimeToMinutes(endTimeStr)
      availabilityBlocks.push({ day: day as AvailabilityBlock['day'], startMinutes, endMinutes })
    }
  }
  return mergeOverlappingBlocks(availabilityBlocks)
}

function mergeOverlappingBlocks(blocks: AvailabilityBlock[]): AvailabilityBlock[] {
  
  const mergedBlocks: AvailabilityBlock[] = []

  // Sort blocks by day and start time
  const sortedBlocks = [...blocks].sort((a, b) => {
    if (a.day !== b.day) {
      return a.day.localeCompare(b.day)
    }
    return a.startMinutes - b.startMinutes
  })

  for (const block of sortedBlocks) {
    const lastBlock = mergedBlocks[mergedBlocks.length - 1]
    if (lastBlock && lastBlock.day === block.day && lastBlock.endMinutes >= block.startMinutes) {
      // Merge overlapping blocks
      lastBlock.endMinutes = Math.max(lastBlock.endMinutes, block.endMinutes)
    } else {
      mergedBlocks.push({ ...block })
    }
  }

  return mergedBlocks
}

//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// classes functions

const DOMAIN_PREFIXES = [
  { domain: 'Fitness & Aquatics', prefix: 'If Fitness & Aquatics' },
  { domain: 'Mind, Body, & Soul Wellness', prefix: 'If Mind, Body, & Soul Wellness' },
  { domain: 'Foundational Courses', prefix: 'If Foundational Course' }, 
  // note: singular "Course" in this question text, unlike the domain checkbox's own 
  // "(choice=Foundational Courses)" — the value you *store* should still be the plural, 
  // this prefix is just for matching
]


// Returns which domain a class-choice column belongs to, based on the
// distinct prefix each domain's own question starts with. Null if this
// header isn't a class-choice column for any domain at all.
function matchDomain(headerCell: string): string | null {
  const match = DOMAIN_PREFIXES.find(({ prefix }) => headerCell.startsWith(prefix))
  return match ? match.domain : null
}

// The exact, identical text all three domains' "Other" free-text columns
// share — since it carries no domain info of its own, whichever domain's
// choice-columns most recently appeared (see getClassColumnIndices below)
// is the one it belongs to.
const OTHER_TEXT_COLUMN_LABEL = "If you selected Other, please list the name(s) of class(es) you will be offering:"

type ClassColumnIndex =
  | { index: number; kind: 'choice'; domain: string; className: string }
  | { index: number; kind: 'other'; domain: string }

// Walks the header in order, tracking which domain's block of "(choice=X)"
// columns we're currently inside — that's what lets each domain's own
// "Other" column (identical text across all three) get attributed correctly.
function getClassColumnIndices(header: string[]): ClassColumnIndex[] {
  const classColumnIndices: ClassColumnIndex[] = []
  let currentDomain: string | null = null

  header.forEach((cell, index) => {
    const domain = matchDomain(cell)
    if (domain) {
      currentDomain = domain
      const className = extractChoiceLabel(cell)
      if (className) {
        classColumnIndices.push({ index, kind: 'choice', domain, className })
      }
      return
    }

    if (cell === OTHER_TEXT_COLUMN_LABEL && currentDomain) {
      classColumnIndices.push({ index, kind: 'other', domain: currentDomain })
    }
  })

  return classColumnIndices
}

// One row's actual class selections — every "Checked" choice column, plus
// every semicolon-separated entry typed into an "Other" free-text column.
function getClassSelections(row: string[], classColumnIndices: ClassColumnIndex[]): { domain: string; className: string }[] {
  const selections: { domain: string; className: string }[] = []

  for (const column of classColumnIndices) {
    if (column.kind === 'choice') {
      // "Other" is itself one of the checkbox options (the last one, right
      // before the free-text field) — its job is unlocking that field, not
      // naming a real class. Its actual content is handled below, via the
      // 'other' column's own free text, so checking this box alone
      // shouldn't add a bogus class literally named "Other".
      if (row[column.index] === 'Checked' && column.className !== 'Other') {
        selections.push({ domain: column.domain, className: column.className })
      }
      continue
    }

    // 'other' column — free text, possibly several classes separated by ";"
    // (inferred from the one sample row that actually has data in it —
    // worth confirming with the form creator if this shows up wrong later).
    const otherText = row[column.index]
    if (!otherText) continue
    for (const className of otherText.split(';').map((s) => s.trim()).filter(Boolean)) {
      selections.push({ domain: column.domain, className })
    }
  }

  return selections
}


//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Instructor functions

// The column indices for every scalar field, computed once from the header
// (mirrors getTimeBlocksIndices/getClassColumnIndices — find columns once,
// reuse the indices for every row). Label strings must match the CSV header
// EXACTLY (including punctuation) — REDCap question wording has changed
// before (e.g. "...you can teach in a typical week?" became "...you can
// teach at Kimel in a typical week?"), so re-verify against a fresh export
// whenever this starts throwing "Expected a column labeled" errors.
function getInstructorColumnIndices(header: string[]) {
  return {
    id: findColumnIndex(header, 'Record ID'),
    name: findColumnIndex(header, 'First and Last Name'),
    email: findColumnIndex(header, 'Email address'),
    status: findColumnIndex(header, 'What is your current status as an instructor at the Kimel Family Centre?'),
    maxSessionsPerWeek: findColumnIndex(header, 'What is the maximum total number of class sessions you can teach at Kimel in a typical week?'),
    maxSessionsPerDay: findColumnIndex(header, 'What is the maximum number of Kimel class sessions you can teach in one day?'),
    consecutiveComfort: findColumnIndex(header, 'When teaching multiple classes in the same day, what is your preference for scheduling them?'),
    preferredGapMinutes: findColumnIndex(header, 'If you can teach more than one class session a day, how much time would you prefer between classes?'),
    // Only shown/filled when preferredGapMinutes's dropdown answer is "Other".
    preferredGapOtherMinutes: findColumnIndex(header, 'Please write how much time you prefer between classes in minutes'),
    blockedOutDates: findColumnIndex(header, 'Please provide the dates/date ranges for when you will be unavailable during the semester (Jan 5 - April 23) (Time-off/Blockout dates).'),
    anythingElse: findColumnIndex(header, 'Anything else you would like to share about your availability or schedulling preferences? (Optional)'),
    // Only the first "Complete?" column — historically there were 3
    // duplicates (two unrelated forms in the same REDCap project), now
    // reduced to just this one, but indexOf-first-match is safe either way.
    completionStatus: findColumnIndex(header, 'Complete?'),
    // Only needed to break ties during dedup (see dedupeInstructorRows).
    surveyTimestamp: findColumnIndex(header, 'Survey Timestamp'),
  }
}

type InstructorColumnIndices = ReturnType<typeof getInstructorColumnIndices>

// Assembles one full row: scalar fields + classes + availability, all
// keyed off column indices computed once outside the per-row loop.
function getInstructorRow(
  row: string[],
  instructorColumnIndices: InstructorColumnIndices,
  timeBlocksIndices: { day: string; startIndex: number; endIndex: number }[],
  classColumnIndices: ClassColumnIndex[],
): ParsedInstructorRow {
  const c = instructorColumnIndices
  return {
    id: row[c.id],
    name: row[c.name],
    email: row[c.email],
    status: row[c.status],
    maxSessionsPerWeek: parseLeadingNumber(row[c.maxSessionsPerWeek]),
    maxSessionsPerDay: parseLeadingNumber(row[c.maxSessionsPerDay]),
    consecutiveComfort: row[c.consecutiveComfort] as ConsecutiveComfort,
    preferredGapMinutes: parseNumberWithOtherFallback(row[c.preferredGapMinutes], row[c.preferredGapOtherMinutes]),
    // Split on ";" — same assumption as the "Other" class field, inferred
    // from one example, not confirmed with the form creator yet.
    blockedOutDates: row[c.blockedOutDates].split(';').map((s) => s.trim()).filter(Boolean),
    anythingElse: row[c.anythingElse],
    classes: getClassSelections(row, classColumnIndices),
    availability: getAvailabilityBlocks(row, timeBlocksIndices),
    completionStatus: row[c.completionStatus] as ParsedInstructorRow['completionStatus'],
    surveyTimestamp: row[c.surveyTimestamp],
  }
}

// Keeps only the most-recently-submitted row per email (multiple
// submissions per person are possible in real production, not just test
// data — confirmed with Samiat; see pickMostRecentPerKey's own docs for the
// exact rule). Only `surveyTimestamp` is dropped here — it only ever
// existed to make this decision. `email` is kept (see DedupedInstructorRow's
// own doc for why) and stripped separately by parseInstructorSurveyCsv.
function dedupeInstructorRows(parsedRows: ParsedInstructorRow[]): DedupedInstructorRow[] {
  const winners = pickMostRecentPerKey(parsedRows, (row) => row.email)
  return winners.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { surveyTimestamp: _surveyTimestamp, ...winner } = row
    return winner
  })
}

// Ties every previous step together: read the CSV, compute every column
// lookup once from the header, parse every row, then dedupe. Exported (not
// just an internal step of parseInstructorSurveyCsv below) because
// buildRoster.ts needs the deduped rows WITH email still attached, to join
// against Class Profile data — Instructor, the final app-facing model,
// never carries email, but this intermediate step is allowed to.
export function parseDedupedInstructorRows(csvText: string): DedupedInstructorRow[] {
  const { header, rows } = readCsvRows(csvText)

  const timeBlocksIndices = getTimeBlocksIndices(header)
  const classColumnIndices = getClassColumnIndices(header)
  const instructorColumnIndices = getInstructorColumnIndices(header)

  const parsedRows = rows.map((row) =>
    getInstructorRow(row, instructorColumnIndices, timeBlocksIndices, classColumnIndices),
  )

  return dedupeInstructorRows(parsedRows)
}

export function parseInstructorSurveyCsv(csvText: string): ParsedSurveyInstructor[] {
  return parseDedupedInstructorRows(csvText).map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { email: _email, ...winner } = row
    return winner
  })
}
