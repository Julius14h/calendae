import type { SchedulerEvent  } from "../../components/scheduler"

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'

export interface AvailabilityBlock {
  day: DayOfWeek
  /** Minutes since midnight, e.g. 9:15am -> 555. */
  startMinutes: number
  endMinutes: number
}

export interface ClassRequest {
  classType: string
  id: number
  durationMinutes: number
  preferredRooms: string[]
  className: string
  instructorId: number
  events: SchedulerEvent[]
  /** How many times *per week* this class should be booked — not a raw total over the whole scheduling range. allocate() repeats it week over week until the range ends. */
  count: number
}

export interface Instructor {
  id: number
  name: string
  preferredRooms: string[]
  classRequests: ClassRequest[]
  availability: AvailabilityBlock[]
}

export interface Roster {
  instructors: Instructor[]
}

/**
 * What a raw Cognito Forms export actually contains — a "count of this class
 * type per week" request, not yet the full `ClassRequest` the allocator needs
 * (which also carries duration, a specific class name, and its own
 * instructor/events linkage). Turning one of these into a real
 * `ClassRequest` is a separate step this module doesn't perform.
 */
export interface ParsedClassRequest {
  classType: string
  count: number
}

/** What `parseRosterWorkbook` produces — `id` is the raw Cognito entry id (a string), not yet the numeric `Instructor.id` the rest of the app uses. */
export interface ParsedInstructor {
  id: string
  name: string
  preferredRooms: string[]
  classRequests: ParsedClassRequest[]
  availability: AvailabilityBlock[]
}