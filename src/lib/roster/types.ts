import type { SurveyCompletionStatus } from './csvUtils'

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'

export interface AvailabilityBlock {
  day: DayOfWeek
  /** Minutes since midnight, e.g. 9:15am -> 555. */
  startMinutes: number
  endMinutes: number
}


/**
 * The fixed choice set for "When teaching multiple classes in the same day,
 * what is your preference for scheduling them?" (copied verbatim from the
 * REDCap data dictionary as of the 2026-09-04 export) — or '' if the
 * instructor left this optional question blank. REDCap only shows the
 * follow-up gap-time question (preferredGapMinutes) for the first three of
 * these — "only one class per day" and "not applicable/not sure" never even
 * ask about a gap, since there's no second same-day class to buffer against.
 */
export type ConsecutiveComfort =
  | 'I prefer classes to be scheduled consecutively (back-to-back)'
  | 'I am comfortable teaching consecutive classes, but have no preference'
  | 'I prefer to have some time between classes'
  | 'I prefer to teach only one class per day'
  | 'Not applicable/ Not sure'
  | ''

export interface Instructor {
  id: number
  name: string
  classes: Class[]
  status: string
  /** From a fixed dropdown: 1-9, "10+", or "Unsure/ Flexible". Parsed to the leading number ("10+" -> 10), or null for "Unsure/ Flexible" or a blank (optional) answer. */
  maxSessionsPerWeek: number | null
  /** From a fixed dropdown: 1-4, "5+", "Depends on the classes", or "Unsure/ Flexible". Parsed to the leading number ("5+" -> 5), or null for the other two or a blank answer. */
  maxSessionsPerDay: number | null
  consecutiveComfort: ConsecutiveComfort
  /** From a fixed dropdown: "15/30/45/60 minutes" or "Other" — "Other" has its own real follow-up integer field (class_time_inbetween), not free text, so it resolves to a real number too. Only null for a genuinely blank (optional) answer — null does NOT mean "no gap needed". */
  preferredGapMinutes: number | null
  blockedOutDates: string[]
  availability: AvailabilityBlock[]
  /** Free text from "Anything else you would like to share about your availability or scheduling preferences? (Optional)" — verbatim, never parsed/interpreted, same reasoning as blockedOutDates. Optional purely so existing hand-written Instructor fixtures across the test suite don't all need updating for a field that's display-only so far. */
  anythingElse?: string
}

export interface Roster {
  instructors: Instructor[]
}


/**
 * One row of the raw REDCap CSV export, parsed but not yet deduplicated —
 * `email` lives here because the dedup step (multiple submissions per
 * person are possible) needs it to group rows together; it's dropped once
 * that step picks a winner (see `ParsedSurveyInstructor`). `id` is the raw
 * Record ID column — a per-submission counter, not a stable per-person id,
 * so it's not yet the numeric `Instructor.id` the rest of the app uses.
 * `classes` is just what was checked/typed in the survey (domain + name) —
 * not yet a real `Class` (no id, instructor link, or duration; those are
 * assigned later, once an instructor has a numeric id and duration is
 * resolved from wherever that ends up coming from).
 */
export interface ParsedInstructorRow {
  id: string
  name: string
  email: string
  status: string
  maxSessionsPerWeek: number | null
  maxSessionsPerDay: number | null
  consecutiveComfort: ConsecutiveComfort
  preferredGapMinutes: number | null
  classes: { domain: string; className: string }[]
  blockedOutDates: string[]
  availability: AvailabilityBlock[]
  /** From "Anything else you would like to share about your availability or scheduling preferences? (Optional)" — verbatim, never parsed/interpreted. */
  anythingElse: string
  /**
   * From the (now singular — see parseInstructorSurveyCsv.ts's history)
   * "Complete?" column. This is REDCap's own built-in survey status, not
   * something Samiat sets by hand: "Incomplete" means the respondent
   * started but never submitted; "Unverified" is the normal status for a
   * submitted survey response (nobody at Baycrest has manually reviewed it
   * in REDCap); "Complete" means staff marked it reviewed. Confirmed with
   * Samiat that the most recent *submitted* (Unverified or Complete) row
   * should win dedup regardless of this status — see
   * csvUtils.ts's pickMostRecentPerKey.
   */
  completionStatus: SurveyCompletionStatus
  /** Raw "Survey Timestamp" value (e.g. "2026-08-14 10:32:52") — only needed to pick a winner among a person's multiple submissions during dedup; not otherwise meaningful, so it doesn't survive into `ParsedSurveyInstructor`. */
  surveyTimestamp: string
}

/** What survives dedup — everything `ParsedInstructorRow` has except the two fields that only existed to support dedup itself (`email` to group a person's submissions, `surveyTimestamp` to break ties between them). Derived with `Omit` so the two can't drift out of sync. */
export type ParsedSurveyInstructor = Omit<ParsedInstructorRow, 'email' | 'surveyTimestamp'>

/** Dedup already applied, but `email` retained — the shape buildRoster.ts needs to join against Class Profile data by email; not meant for general app use (Instructor, the final model, never carries email — see ParsedSurveyInstructor). */
export type DedupedInstructorRow = Omit<ParsedInstructorRow, 'surveyTimestamp'>

export interface Class {
  id: number
  classDomain: string
  instructorId: number
  className: string
  classDurationMinutes: number
  /** From the matching Class Profile submission's `roomNeeds` — empty if the instructor hasn't submitted a Class Profile for this class yet, or genuinely checked nothing. */
  roomNeeds: string[]
  /** From the matching Class Profile submission's `maxParticipation` — null if unmatched or left blank there. */
  maxParticipation: number | null
  /** From the matching Class Profile submission's `deliveryFormats` — "In-Person"/"Virtual"/"Hybrid (In-Person + Virtual simultaneously)", any combination. Optional (unlike roomNeeds/maxParticipation) purely so existing hand-written Class fixtures across the test suite don't all need updating for a field that's display-only so far, not consumed by allocate()'s own matching logic. */
  deliveryFormats?: string[]
  /** From the matching Class Profile submission's `intensity` — e.g. "Low-Moderate"/"Moderate-High". Optional, same reasoning as deliveryFormats: display-only, not consumed by allocate()'s own matching logic. */
  intensity?: string
}

/**
 * One row of the raw "W27 Class Profile" REDCap CSV export (a SEPARATE
 * survey from the Availability Form — one submission per CLASS an
 * instructor teaches, not one per instructor), parsed but not yet
 * deduplicated. Unlike the Availability Form, the same person legitimately
 * submits MANY of these (one per class), so dedup here groups by
 * (email, className), not email alone — see parseClassProfileCsv.ts.
 */
export interface ParsedClassProfileRow {
  id: string
  name: string
  email: string
  /** "Fitness & Aquatics" or "Mind, Body, & Soul Wellness" — this survey has no Foundational Courses option (Foundational classes aren't auto-scheduled at all, see allocate.ts). */
  domain: string
  className: string
  /** From a fixed dropdown (30/45/60/75/90 minutes, or "Other" with a real follow-up integer field) via parseNumberWithOtherFallback. null only for a genuinely blank answer. */
  durationMinutes: number | null
  /** From "What is the maximum number of participants?" (integer, 1-80). null if left blank. */
  maxParticipation: number | null
  /** From "What is the intended intensity for this class?" (a fixed dropdown, e.g. "Low-Moderate"/"Moderate-High") — verbatim REDCap choice label. Undefined for a genuinely blank answer, or when parsing an older export from before this question existed (see findColumnIndexOptional). */
  intensity?: string
  /**
   * Every checked "room or space feature" this class requires, e.g. "Pool",
   * "Mirrors", "Virtual (e.g. Zoom)" — verbatim REDCap choice labels, plus
   * whatever free text was typed for a checked "Other". "No specific room
   * features required" is kept as its own literal entry (meaningful
   * signal — "any room is fine" — not filtered out the way the bare
   * "Other" checkbox itself is).
   */
  roomNeeds: string[]
  /** Every checked "delivery format" this class could run in this term, e.g. "In-Person", "Virtual", "Hybrid (In-Person + Virtual simultaneously)" — verbatim REDCap choice labels, no "Other" option on this question. */
  deliveryFormats: string[]
  completionStatus: SurveyCompletionStatus
  surveyTimestamp: string
}

/** What survives dedup — see ParsedSurveyInstructor's own doc for why `email`/`surveyTimestamp` are dropped. */
export type ParsedClassProfile = Omit<ParsedClassProfileRow, 'email' | 'surveyTimestamp'>

/** Dedup already applied, but `email` retained — see DedupedInstructorRow's own doc for why. */
export type DedupedClassProfileRow = Omit<ParsedClassProfileRow, 'surveyTimestamp'>

