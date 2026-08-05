import { read, utils } from 'xlsx'
import type { AvailabilityBlock, DayOfWeek, ParsedClassRequest, ParsedInstructor } from './types'

/**
 * Cognito Forms names the main tab after the form itself, and derives the
 * join-key column from that same name (`<FormName>_Id`). Rename this if you
 * rename the form. The two repeating sections became their own tabs
 * ("AvailabilityBlock", "AvailabilityBlock2" — Cognito auto-names untitled
 * repeating sections sequentially; rename them in the form builder for
 * clearer tab names if you want).
 */
const MAIN_SHEET_NAME = 'WeeklyInstructorAvailability'
const AVAILABILITY_SHEET_NAME = 'AvailabilityBlock'
const CLASS_REQUEST_SHEET_NAME = 'AvailabilityBlock2'
const JOIN_KEY = `${MAIN_SHEET_NAME}_Id`

const MAIN_COLUMNS = {
  firstName: 'FullName_First',
  lastName: 'FullName_Last',
  preferredRooms: 'RoomsAvailable',
  status: 'Entry_Status',
} as const

const AVAILABILITY_COLUMNS = {
  days: 'DayOfWeek',
  start: 'StartTime',
  end: 'EndTime',
} as const

const CLASS_REQUEST_COLUMNS = {
  classType: 'Choice',
  count: 'Number',
} as const

type SheetRow = Record<string, unknown>

/** Cognito exports time-only fields as a full ISO instant anchored to the submission date — only the UTC hour/minute carry the entered time. */
function parseTimeToMinutes(value: unknown): number {
  if (!(value instanceof Date)) {
    throw new Error(`Expected a Date for a time cell, got: ${String(value)}`)
  }
  return value.getUTCHours() * 60 + value.getUTCMinutes()
}

function parseCommaList(value: unknown): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  return raw.split(',').map((item) => item.trim()).filter(Boolean)
}

function groupByJoinKey<T extends SheetRow>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const key = String(row[JOIN_KEY] ?? '')
    const existing = grouped.get(key)
    if (existing) existing.push(row)
    else grouped.set(key, [row])
  }
  return grouped
}

export function parseRosterWorkbook(buffer: ArrayBuffer): ParsedInstructor[] {
  const workbook = read(buffer, { type: 'array', cellDates: true })

  const mainSheet = workbook.Sheets[MAIN_SHEET_NAME]
  const availabilitySheet = workbook.Sheets[AVAILABILITY_SHEET_NAME]
  const classRequestSheet = workbook.Sheets[CLASS_REQUEST_SHEET_NAME]
  if (!mainSheet || !availabilitySheet || !classRequestSheet) {
    throw new Error(
      `Expected sheets "${MAIN_SHEET_NAME}", "${AVAILABILITY_SHEET_NAME}", "${CLASS_REQUEST_SHEET_NAME}", found: ${workbook.SheetNames.join(', ')}`,
    )
  }

  const mainRows = utils.sheet_to_json<SheetRow>(mainSheet)
  const availabilityRows = utils.sheet_to_json<SheetRow>(availabilitySheet)
  const classRequestRows = utils.sheet_to_json<SheetRow>(classRequestSheet)

  const availabilityByEntry = groupByJoinKey(availabilityRows)
  const classRequestsByEntry = groupByJoinKey(classRequestRows)

  return mainRows
    .filter((row) => row[MAIN_COLUMNS.status] === 'Submitted')
    .map((row) => {
      const entryId = String(row[JOIN_KEY] ?? '')

      const availability: AvailabilityBlock[] = (availabilityByEntry.get(entryId) ?? []).flatMap((block) => {
        const startMinutes = parseTimeToMinutes(block[AVAILABILITY_COLUMNS.start])
        const endMinutes = parseTimeToMinutes(block[AVAILABILITY_COLUMNS.end])
        const days = parseCommaList(block[AVAILABILITY_COLUMNS.days]) as DayOfWeek[]
        return days.map((day) => ({ day, startMinutes, endMinutes }))
      })

      const classRequests: ParsedClassRequest[] = (classRequestsByEntry.get(entryId) ?? []).map((request) => ({
        classType: String(request[CLASS_REQUEST_COLUMNS.classType] ?? ''),
        count: Number(request[CLASS_REQUEST_COLUMNS.count] ?? 0),
      }))

      return {
        id: entryId,
        name: `${String(row[MAIN_COLUMNS.firstName] ?? '')} ${String(row[MAIN_COLUMNS.lastName] ?? '')}`.trim(),
        preferredRooms: parseCommaList(row[MAIN_COLUMNS.preferredRooms]),
        classRequests,
        availability,
      }
    })
}
