import type { SchedulerEvent, UnplacedClass } from '../../components/scheduler'
import { NON_AUTO_SCHEDULED_DOMAINS } from '../allocator/allocate'
import { unprofiledClassNote } from './buildRoster'
import type { Class, Instructor, UnprofiledClass } from './types'

/** A roster class as a Classes Bin entry — shared by Generate (binClassesForGeneratedSchedule) and Add New (mergeRoster.ts). */
export function unplacedClassFrom(klass: Class, instructorId: number, instructorName: string, id: string = crypto.randomUUID()): UnplacedClass {
  return {
    id,
    title: klass.className,
    type: klass.classDomain,
    durationMinutes: klass.classDurationMinutes,
    instructorId,
    instructorName,
    roomNeeds: klass.roomNeeds.length > 0 ? klass.roomNeeds : undefined,
    deliveryFormats: klass.deliveryFormats,
    maxParticipation: klass.maxParticipation ?? undefined,
    intensity: klass.intensity,
  }
}

/** Same as unplacedClassFrom, plus the placeholder-duration note (see Instructor.unprofiledClasses). */
export function unplacedClassFromUnprofiled(klass: UnprofiledClass, instructorId: number, instructorName: string): UnplacedClass {
  return { ...unplacedClassFrom(klass, instructorId, instructorName), note: unprofiledClassNote(klass.reason) }
}

/**
 * Everything a fresh Generate couldn't put on the calendar, as Classes Bin
 * entries — so nothing from the import silently disappears:
 *  - roster classes allocate() never booked in ANY week (weekly cap reached
 *    before their turn, or no room/slot/availability), and
 *  - claimed classes with no usable Class Profile (placeholder duration).
 * Foundational Courses are excluded — never auto-scheduled by design (see
 * NON_AUTO_SCHEDULED_DOMAINS), not a failure.
 */
export function binClassesForGeneratedSchedule(instructors: Instructor[], events: SchedulerEvent[]): UnplacedClass[] {
  const bookedClassIds = new Set(events.map((event) => event.classRequestId))
  return instructors.flatMap((instructor) => [
    ...instructor.classes
      .filter((klass) => !NON_AUTO_SCHEDULED_DOMAINS.has(klass.classDomain) && !bookedClassIds.has(klass.id))
      .map((klass) => unplacedClassFrom(klass, instructor.id, instructor.name)),
    ...(instructor.unprofiledClasses ?? []).map((klass) => unplacedClassFromUnprofiled(klass, instructor.id, instructor.name)),
  ])
}
