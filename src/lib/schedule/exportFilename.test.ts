import { describe, expect, it } from 'vitest'
import { exportFilename } from './exportFilename'

describe('exportFilename', () => {
  it('matches "Program Scheduler Export - YYYY-MM-DD HH-mm.ext"', () => {
    expect(exportFilename('json')).toMatch(/^Program Scheduler Export - \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.json$/)
  })

  it('uses whatever extension is passed in', () => {
    expect(exportFilename('xlsx')).toMatch(/\.xlsx$/)
  })
})
