import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { parseRosterWorkbook } from './parseRoster'

function loadFixture(): ArrayBuffer {
  const buffer = readFileSync(new URL('./__fixtures__/WeeklyInstructorAvailability.xlsx', import.meta.url))
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

describe('parseRosterWorkbook', () => {
  it('parses the sample Cognito Forms export', () => {
    const instructors = parseRosterWorkbook(loadFixture())

    expect(instructors).toHaveLength(1)
    const [instructor] = instructors

    expect(instructor.name).toBe('JULIUS HENRIQUES')
    expect(instructor.preferredRooms).toEqual(['Room A', 'Room B', 'Room C', 'Room E'])
    expect(instructor.classRequests).toEqual([{ classType: 'Aquatics', count: 3 }])

    expect(instructor.availability).toHaveLength(4)
    expect(instructor.availability.map((block) => block.day)).toEqual(['Monday', 'Wednesday', 'Thursday', 'Sunday'])
    for (const block of instructor.availability) {
      expect(block.startMinutes).toBe(14 * 60 + 30)
      expect(block.endMinutes).toBe(17 * 60 + 45)
    }
  })
})
