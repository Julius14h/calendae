export interface ClassInfo {
  id: string
  name: string
  durationMinutes: number
  type?: string
}

export interface Instructor {
  id: number
  name: string
  availability: []
}
