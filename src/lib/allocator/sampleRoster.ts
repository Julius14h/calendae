
import type { Resource } from '../../components/scheduler'
import type { AvailabilityBlock, ClassRequest, Instructor } from '../roster/types'
import type { ClassInfo } from './types'

// A larger, generated-but-deterministic fixture — 80 instructors, 100 class
// requests, 6 rooms — for exercising allocate() at a scale closer to a real
// roster than the small hand-written fixtures in allocate.test.ts. Everything
// here is computed from small pools below rather than hand-typed, so the
// counts stay easy to change (bump the Array.from lengths). Name/shift/class
// pools are cycled with modulo + an offset, not sized to match the instructor
// count exactly — so bumping the counts further never runs out of bounds.

export const sampleRooms: Resource[] = Array.from({ length: 6 }, (_, i) => {
  const letter = String.fromCharCode(65 + i) // A..F
  return { id: `room${letter}`, title: `Room ${letter}` }
})

const FIRST_NAMES = [
  'Jane', 'John', 'Ana', 'Marcus', 'Priya', 'Diego', 'Emily', 'Hassan', 'Grace', 'Noah',
  'Sofia', 'Liam', 'Mei', 'Carlos', 'Fatima', 'Ethan', 'Olivia', 'Kwame', 'Isabella', 'Ravi',
]
const LAST_NAMES = [
  'Doe', 'Smith', 'Lee', 'Johnson', 'Patel', 'Alvarez', 'Chen', 'Ali', 'Kim', 'Brown',
  'Garcia', 'Nguyen', 'Wong', 'Rossi', 'Khan', 'Davis', 'Martin', 'Mensah', 'Rodriguez', 'Sharma',
]

// Four recurring weekly-availability shapes, cycled across the instructors so
// there's a realistic mix of full-timers, part-timers, and one-day-a-week
// instructors — enough variety to create real room/time contention.
const SHIFT_TEMPLATES: AvailabilityBlock[][] = [
  [
    { day: 'Monday', startMinutes: 8 * 60, endMinutes: 12 * 60 },
    { day: 'Wednesday', startMinutes: 8 * 60, endMinutes: 12 * 60 },
    { day: 'Friday', startMinutes: 8 * 60, endMinutes: 12 * 60 },
  ],
  [
    { day: 'Tuesday', startMinutes: 12 * 60, endMinutes: 17 * 60 },
    { day: 'Thursday', startMinutes: 12 * 60, endMinutes: 17 * 60 },
  ],
  [
    { day: 'Monday', startMinutes: 8 * 60, endMinutes: 17 * 60 },
    { day: 'Tuesday', startMinutes: 8 * 60, endMinutes: 17 * 60 },
    { day: 'Wednesday', startMinutes: 8 * 60, endMinutes: 17 * 60 },
    { day: 'Thursday', startMinutes: 8 * 60, endMinutes: 17 * 60 },
    { day: 'Friday', startMinutes: 8 * 60, endMinutes: 17 * 60 },
  ],
  [{ day: 'Friday', startMinutes: 8 * 60, endMinutes: 21 * 60 }],
]

export const sampleInstructors: Instructor[] = Array.from({ length: 80 }, (_, i) => {
  const id = i + 1
  return {
    id,
    // Offsetting the last-name index keeps combinations from repeating in
    // lockstep once `i` wraps past either pool's length (20 each).
    name: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(i + 7) % LAST_NAMES.length]}`,
    preferredRooms: [sampleRooms[i % sampleRooms.length].id],
    classRequests: [],
    availability: SHIFT_TEMPLATES[i % SHIFT_TEMPLATES.length],
  }
})

// (classType, className, duration) triples, cycled to build 100 requests —
// varied enough that classes don't all need the same room or length.
const CLASS_TEMPLATES: { type: string; name: string; duration: number }[] = [
  { type: 'Aquatics', name: 'Swimming', duration: 60 },
  { type: 'Fitness', name: 'Bootcamp', duration: 45 },
  { type: 'Fitness', name: 'Yoga', duration: 60 },
  { type: 'Therapy', name: 'Massage', duration: 60 },
  { type: 'Therapy', name: 'Physio', duration: 45 },
  { type: 'Dance', name: 'Ballet', duration: 60 },
  { type: 'Dance', name: 'Hip-Hop', duration: 45 },
  { type: 'Strength', name: 'Weight Training', duration: 60 },
  { type: 'Cardio', name: 'Spin', duration: 45 },
  { type: 'Mindfulness', name: 'Pilates', duration: 50 },
]

export const sampleClasses: ClassInfo[] = CLASS_TEMPLATES.map((template, i) => ({
  id: `c${i + 1}`,
  name: template.name,
  durationMinutes: template.duration,
  type: template.type,
}))

export const sampleClassRequests: ClassRequest[] = Array.from({ length: 100 }, (_, i) => {
  const instructorId = (i % sampleInstructors.length) + 1
  const template = CLASS_TEMPLATES[i % CLASS_TEMPLATES.length]
  const cycle = Math.floor(i / CLASS_TEMPLATES.length) + 1

  // Every 5th request: only one room will do. Every 5th (offset): any room is
  // fine (empty preferredRooms). The rest: a handful of acceptable rooms,
  // ranked — this mix is what exercises room contention and the
  // most-constrained-first ordering in allocate().
  const constraintPattern = i % 5
  let preferredRooms: string[]
  if (constraintPattern === 0) {
    preferredRooms = [sampleRooms[i % sampleRooms.length].id]
  } else if (constraintPattern === 1) {
    preferredRooms = []
  } else {
    preferredRooms = [
      sampleRooms[i % sampleRooms.length].id,
      sampleRooms[(i + 2) % sampleRooms.length].id,
      sampleRooms[(i + 4) % sampleRooms.length].id,
    ]
  }

  return {
    id: i + 1,
    instructorId,
    classType: template.type,
    className: `${template.name} ${cycle}`,
    durationMinutes: template.duration,
    preferredRooms,
    events: [],
    // Most classes meet once a week; every 7th meets twice — a small mix so
    // the per-week cap in allocate() gets exercised at both counts.
    count: i % 7 === 0 ? 2 : 1,
  }
})
