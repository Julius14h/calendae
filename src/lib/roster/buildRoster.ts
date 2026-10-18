import { parseDedupedClassProfileRows } from './parseClassProfileCsv'
import { parseDedupedInstructorRows } from './parseInstructorSurveyCsv'
import type { Class, DedupedClassProfileRow, DedupedInstructorRow, Instructor, UnprofiledClass } from './types'

/** Placeholder duration for a claimed class with no usable Class Profile (see Instructor.unprofiledClasses) — never auto-booked, only ever used for the Classes Bin entry a person places by hand. */
export const UNPROFILED_CLASS_DURATION_MINUTES = 60

/** The Classes Bin note (and review-list detail) for an unprofiled class — see Instructor.unprofiledClasses. */
export function unprofiledClassNote(reason: UnprofiledClass['reason']): string {
  return reason === 'no-profile'
    ? `No Class Profile found. Class duration was set to the default ${UNPROFILED_CLASS_DURATION_MINUTES} mins.`
    : `Class Profile has no duration. Class duration was set to the default ${UNPROFILED_CLASS_DURATION_MINUTES} mins.`
}

// Same join key shape both parsers already use internally for their own
// dedup — reused here just to combine the two datasets, not to dedup again.
function classProfileKey(email: string, className: string): string {
  return `${email} ${className}`
}

export type RosterWarning =
  | {
      /** Claimed on the Availability Form, but no Class Profile submission exists for it yet (or one exists but hasn't got a duration) — never auto-booked, since there's no real duration to book, but carried as an Instructor.unprofiledClasses placeholder so it lands in the Classes Bin instead of being lost. */
      type: 'unmatched-availability-class'
      instructorName: string
      className: string
      reason: 'no-profile' | 'no-duration'
    }
  | {
      /** A Class Profile submission whose email doesn't match ANY Availability Form submission at all — genuinely no known instructor to attach it to (no name we can confirm, no availability data to schedule against). If the email DOES match a real Availability Form submission, this class is auto-assigned to that instructor instead (see 'auto-matched-by-email' below) and never reaches this warning at all. `instructorName` is just whoever SUBMITTED the profile. */
      type: 'unclaimed-class-profile'
      instructorName: string
      className: string
      classDomain: string
      /** Falls back to 60 when the profile itself never got a duration — `Class.classDurationMinutes` isn't optional, but this warning (unlike unmatched-availability-class) doesn't skip incomplete profiles just for missing this one field. */
      classDurationMinutes: number
      roomNeeds: string[]
      deliveryFormats: string[]
      intensity?: string
      /** Real Availability Form submissions whose NAME matches this submission's (case/whitespace-insensitive), even though the EMAIL didn't — likely the same person using a different email address across the two separate REDCap surveys. Carries each match's own `id` (the same 1-based id `buildRoster` assigns that instructor, since `instructorRows` and the returned `instructors[]` share index order, so a UI can assign by it directly instead of re-matching by name) and `classes` — the class names THIS candidate already claimed on their own Availability Form. Deliberately not email: `Instructor`, the final model, never carries it (see roster/types.ts's own doc), so nothing downstream of buildRoster should either — `classes` is the non-PII stand-in a person can actually use to tell two same-named instructors apart (recognizing which one teaches what), same as they'd do with any coworker. Both arrays are empty when there's genuinely nothing to go on beyond the bare name match. */
      possibleInstructors: { id: number; name: string; classes: string[] }[]
    }
  | {
      /** A Class Profile submission that was never explicitly checked as a claimed class on the Availability Form, but got auto-assigned to that instructor anyway because the email matched a real submission (see buildRoster's own doc comment). Not something that blocks anything — the class is already real and bookable — just a low-priority "worth a quick glance" note, since matching by email alone is an inference, not an explicit confirmation from the instructor themselves. */
      type: 'auto-matched-by-email'
      instructorName: string
      className: string
    }
  | {
      /** This instructor has stated blockout dates — free text, never parsed (see Instructor.blockedOutDates's own doc), surfaced verbatim for manual cross-checking. */
      type: 'blocked-out-dates'
      instructorName: string
      blockedOutDates: string[]
    }

/**
 * Turns the two parsers' outputs into the real `Instructor[]` the rest of
 * the app (and allocate()) consumes — the step neither parser can do on its
 * own, since each only sees its own survey.
 *
 * For each instructor, every class they said they teach (from the
 * Availability Form) is looked up by (email, className) against the Class
 * Profile submissions. A class only becomes a real, bookable `Class` if a
 * matching Class Profile submission exists AND has a resolved duration
 * (class_duration is the one truly required field over there) — duration
 * isn't optional on `Class`, so there's no reasonable default to invent for
 * a class nobody has profiled yet. Foundational Courses classes are NOT
 * filtered out here (see allocate.ts's NON_AUTO_SCHEDULED_DOMAINS) — only
 * the auto-allocator skips them; they're still real, bookable classes.
 *
 * A Class Profile submission that was never explicitly checked as a
 * claimed class ALSO gets attached to that same instructor, as long as its
 * email matches a real Availability Form submission — matching by email is
 * treated as sufficient confirmation on its own (that person's real name
 * and availability are right there), so this isn't something a person
 * needs to manually resolve. Only a Class Profile whose email matches NO
 * Availability Form submission at all — genuinely no known instructor,
 * nothing to auto-assign to — becomes an 'unclaimed-class-profile' warning.
 * That warning also carries any Availability Form submissions whose NAME
 * (not email) matches, in case the same person just used a different email
 * address on the two forms — a UI can offer those as quick picks instead of
 * making someone hunt through the full instructor list, or conclude this is
 * a genuinely new instructor who needs to be added from scratch.
 *
 * Alongside the roster, this returns a list of `warnings` for a human to
 * review — unmatched classes (claimed-but-unprofiled, or profiled-but-
 * genuinely-orphaned) and any stated blockout dates. None of these block
 * anything; they're just visibility into gaps a person needs to resolve,
 * not something the algorithm can decide on its own (this is the same
 * "review list" the plan is to surface via the frontend's FAB → "Classes
 * to Review" modal — see allocate.ts's own warnings for the
 * scheduling-side equivalent).
 *
 * `Instructor.id`/`Class.id` are assigned here as simple 1-based positions
 * — there's no stable per-person/per-class id anywhere upstream yet (a
 * REDCap Record ID is only a per-submission counter), so this is only
 * stable within one run of buildRoster, not across separate re-imports.
 */
export function buildRoster(
  instructorRows: DedupedInstructorRow[],
  classProfileRows: DedupedClassProfileRow[],
): { instructors: Instructor[]; warnings: RosterWarning[] } {
  const profileByKey = new Map<string, DedupedClassProfileRow>()
  const profilesByEmail = new Map<string, DedupedClassProfileRow[]>()
  for (const profile of classProfileRows) {
    profileByKey.set(classProfileKey(profile.email, profile.className), profile)
    const list = profilesByEmail.get(profile.email)
    if (list) list.push(profile)
    else profilesByEmail.set(profile.email, [profile])
  }

  const warnings: RosterWarning[] = []
  let nextClassId = 1
  // Separate id space for unprofiled placeholders, so adding them never
  // shifts a real class's own id (those end up persisted as
  // classDefinitions/classRequestId). Negative, so the two can never collide.
  let nextUnprofiledClassId = -1
  // Every (email, className) key already accounted for by the main claimed-
  // checkbox loop below — the auto-assign-by-email pass afterward skips
  // these, so a class already claimed (and matched, or already warned about)
  // never gets added or warned about a second time.
  const consumedKeys = new Set<string>()

  function buildClassFromProfile(profile: DedupedClassProfileRow, instructorId: number): Class {
    return {
      id: nextClassId++,
      classDomain: profile.domain,
      instructorId,
      className: profile.className,
      // Non-null asserted: every call site below already checked
      // durationMinutes != null first (see the two "no-duration" warning
      // branches) — Class.classDurationMinutes isn't optional.
      classDurationMinutes: profile.durationMinutes as number,
      roomNeeds: profile.roomNeeds,
      maxParticipation: profile.maxParticipation,
      deliveryFormats: profile.deliveryFormats,
      intensity: profile.intensity,
    }
  }

  /** `profile` is the duration-less Class Profile when there is one (its room needs/capacity/etc. are still real), or undefined when none was submitted at all. */
  function buildUnprofiledClass(
    instructorId: number,
    className: string,
    classDomain: string,
    profile: DedupedClassProfileRow | undefined,
  ): UnprofiledClass {
    return {
      id: nextUnprofiledClassId--,
      classDomain: profile?.domain ?? classDomain,
      instructorId,
      className,
      classDurationMinutes: UNPROFILED_CLASS_DURATION_MINUTES,
      roomNeeds: profile?.roomNeeds ?? [],
      maxParticipation: profile?.maxParticipation ?? null,
      deliveryFormats: profile?.deliveryFormats,
      intensity: profile?.intensity,
      reason: profile ? 'no-duration' : 'no-profile',
    }
  }

  const instructors = instructorRows.map((row, index) => {
    const instructorId = index + 1
    const classes: Class[] = []
    const unprofiledClasses: UnprofiledClass[] = []

    for (const { domain, className } of row.classes) {
      const key = classProfileKey(row.email, className)
      consumedKeys.add(key)
      const profile = profileByKey.get(key)
      if (!profile) {
        warnings.push({ type: 'unmatched-availability-class', instructorName: row.name, className, reason: 'no-profile' })
        unprofiledClasses.push(buildUnprofiledClass(instructorId, className, domain, undefined))
        continue
      }
      if (profile.durationMinutes == null) {
        warnings.push({ type: 'unmatched-availability-class', instructorName: row.name, className, reason: 'no-duration' })
        unprofiledClasses.push(buildUnprofiledClass(instructorId, className, domain, profile))
        continue
      }

      classes.push(buildClassFromProfile(profile, instructorId))
    }

    // Any OTHER Class Profile submitted under this same email that wasn't
    // explicitly claimed via checkbox — auto-assigned anyway (see this
    // function's own doc comment for why matching by email is enough).
    for (const profile of profilesByEmail.get(row.email) ?? []) {
      if (!profile.className) continue // an incomplete submission, not a real orphan
      const key = classProfileKey(profile.email, profile.className)
      if (consumedKeys.has(key)) continue
      consumedKeys.add(key)
      if (profile.durationMinutes == null) {
        warnings.push({ type: 'unmatched-availability-class', instructorName: row.name, className: profile.className, reason: 'no-duration' })
        unprofiledClasses.push(buildUnprofiledClass(instructorId, profile.className, profile.domain, profile))
        continue
      }
      classes.push(buildClassFromProfile(profile, instructorId))
      warnings.push({ type: 'auto-matched-by-email', instructorName: row.name, className: profile.className })
    }

    if (row.blockedOutDates.length > 0) {
      warnings.push({ type: 'blocked-out-dates', instructorName: row.name, blockedOutDates: row.blockedOutDates })
    }

    return {
      id: instructorId,
      name: row.name,
      classes,
      status: row.status,
      maxSessionsPerWeek: row.maxSessionsPerWeek,
      maxSessionsPerDay: row.maxSessionsPerDay,
      consecutiveComfort: row.consecutiveComfort,
      preferredGapMinutes: row.preferredGapMinutes,
      blockedOutDates: row.blockedOutDates,
      availability: row.availability,
      anythingElse: row.anythingElse,
      unprofiledClasses,
    }
  })

  warnings.push(...findOrphanedClassProfiles(classProfileRows, instructorRows))

  return { instructors, warnings }
}

// Trimmed + case-insensitive so "Jane Doe", " jane doe ", and "JANE DOE" are
// all treated as the same person — real form submissions won't always match
// byte-for-byte even when it's genuinely the same name. Exported so
// mergeRoster.ts can apply the exact same normalization when matching a
// freshly-parsed name (or class name) against the currently loaded schedule.
export function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

/** Every Class Profile submission whose email matches no Availability Form submission at all — genuinely orphaned, nothing to auto-assign it to (see buildRoster's own doc comment). Blank class names (an incomplete submission that never got that far) are skipped — not a real orphan, just unfinished data. */
function findOrphanedClassProfiles(classProfileRows: DedupedClassProfileRow[], instructorRows: DedupedInstructorRow[]): RosterWarning[] {
  const emailsWithInstructorRow = new Set(instructorRows.map((row) => row.email))

  // Every real instructor (id/name/classes — id matches `buildRoster`'s own
  // instructors[] 1-based assignment, since both come from the same
  // instructorRows in the same order), grouped by normalized name — lets an
  // orphaned profile suggest "this might be the same person under a
  // different email" even though the join key (email, className) never
  // matched. Two DIFFERENT real instructors who happen to share a name both
  // get listed (never deduped by name alone) — `classes` (not email —
  // Instructor's final model never carries that, see this warning's own doc
  // comment) is what actually distinguishes them for a person picking one.
  const instructorsByNormalizedName = new Map<string, { id: number; name: string; classes: string[] }[]>()
  instructorRows.forEach((row, index) => {
    const key = normalizeName(row.name)
    const entry = { id: index + 1, name: row.name, classes: row.classes.map((c) => c.className) }
    const matches = instructorsByNormalizedName.get(key)
    if (matches) matches.push(entry)
    else instructorsByNormalizedName.set(key, [entry])
  })

  return classProfileRows
    .filter((profile) => profile.className && !emailsWithInstructorRow.has(profile.email))
    .map((profile) => ({
      type: 'unclaimed-class-profile' as const,
      instructorName: profile.name,
      className: profile.className,
      classDomain: profile.domain,
      classDurationMinutes: profile.durationMinutes ?? 60,
      roomNeeds: profile.roomNeeds,
      deliveryFormats: profile.deliveryFormats,
      intensity: profile.intensity,
      possibleInstructors: instructorsByNormalizedName.get(normalizeName(profile.name)) ?? [],
    }))
}

/** Convenience wrapper: both raw CSV exports in, straight to the built roster + warnings out. */
export function buildRosterFromCsv(instructorCsvText: string, classProfileCsvText: string): { instructors: Instructor[]; warnings: RosterWarning[] } {
  return buildRoster(parseDedupedInstructorRows(instructorCsvText), parseDedupedClassProfileRows(classProfileCsvText))
}
