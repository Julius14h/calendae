import { utils, write } from 'xlsx'
import type { Resource, SchedulerEvent } from '../../components/scheduler'
import { saveFile } from './downloadFile'
import { exportFilename } from './exportFilename'

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Flattens the current schedule into a row-per-event worksheet, ready for Excel or Google Sheets (which opens .xlsx natively). */
export function scheduleToRows(events: SchedulerEvent[], resources: Resource[]) {
  const roomTitle = (id: string) => resources.find((room) => room.id === id)?.title ?? id

  return [...events]
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((event) => ({
      'Class Name': event.title,
      'Class Type': event.type ?? '',
      Instructor: event.instructorName,
      Room: roomTitle(event.resourceId),
      Date: event.start.toLocaleDateString(),
      Start: formatTime(event.start),
      End: formatTime(event.end),
    }))
}

/** Downloads the current schedule as an .xlsx file — runs entirely client-side, no backend involved. */
export async function exportScheduleToXlsx(events: SchedulerEvent[], resources: Resource[], filename = exportFilename('xlsx')): Promise<void> {
  const worksheet = utils.json_to_sheet(scheduleToRows(events, resources))
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, worksheet, 'Schedule')
  const bytes = write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  await saveFile(blob, filename, 'Schedule spreadsheet')
}
