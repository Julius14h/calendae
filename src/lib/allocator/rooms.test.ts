import { describe, expect, it } from 'vitest'
import { getEligibleRooms, REAL_ROOMS } from './rooms'
import type { Class } from '../roster/types'

function makeClass(overrides: Partial<Class> = {}): Class {
  return {
    id: 1,
    classDomain: 'Fitness & Aquatics',
    instructorId: 1,
    className: 'Test Class',
    classDurationMinutes: 60,
    roomNeeds: [],
    maxParticipation: null,
    ...overrides,
  }
}

describe('getEligibleRooms', () => {
  it('routes a Pool class only to the Pool room', () => {
    const eligible = getEligibleRooms(makeClass({ roomNeeds: ['Pool'] }), REAL_ROOMS)
    expect(eligible.map((r) => r.id)).toEqual(['pool'])
  })

  it('routes a Gym class only to the Gym room', () => {
    const eligible = getEligibleRooms(makeClass({ roomNeeds: ['Gym/ weight-room equipment'] }), REAL_ROOMS)
    expect(eligible.map((r) => r.id)).toEqual(['gym'])
  })

  it('routes a Virtual class to all 3 Zoom rooms', () => {
    const eligible = getEligibleRooms(makeClass({ roomNeeds: ['Virtual (e.g. Zoom)'] }), REAL_ROOMS)
    expect(eligible.map((r) => r.id).sort()).toEqual(['zoom1', 'zoom2', 'zoom3'])
  })

  it('routes an Outdoor class to both Outdoor rooms', () => {
    const eligible = getEligibleRooms(makeClass({ roomNeeds: ['Outdoor space'] }), REAL_ROOMS)
    expect(eligible.map((r) => r.id).sort()).toEqual(['outdoor1', 'outdoor2'])
  })

  it('routes a Mirrors class to ARA regardless of capacity', () => {
    const eligible = getEligibleRooms(makeClass({ roomNeeds: ['Mirrors'], maxParticipation: 50 }), REAL_ROOMS)
    expect(eligible.map((r) => r.id)).toEqual(['ara'])
  })

  it('prefers ARA (smaller) for a general-purpose class under 15 participants', () => {
    const eligible = getEligibleRooms(makeClass({ roomNeeds: ['Tables/desks'], maxParticipation: 10 }), REAL_ROOMS)
    expect(eligible[0].id).toBe('ara')
    expect(eligible.map((r) => r.id).sort()).toEqual(['ara', 'cas'])
  })

  it('prefers CAS (larger) for a general-purpose class over 15 participants', () => {
    const eligible = getEligibleRooms(makeClass({ roomNeeds: ['Tables/desks'], maxParticipation: 20 }), REAL_ROOMS)
    expect(eligible[0].id).toBe('cas')
  })

  it('falls back to general-purpose rooms (including untagged ones) when a class states no needs at all', () => {
    const plainRooms = [{ id: 'roomA', title: 'Room A' }]
    const eligible = getEligibleRooms(makeClass({ roomNeeds: [] }), plainRooms)
    expect(eligible.map((r) => r.id)).toEqual(['roomA'])
  })

  it('never routes a Pool/Gym/Virtual/Outdoor-exclusive room into the general-purpose fallback', () => {
    const eligible = getEligibleRooms(makeClass({ roomNeeds: [] }), REAL_ROOMS)
    expect(eligible.map((r) => r.id).sort()).toEqual(['ara', 'cas'])
  })
})
