import { describe, expect, it } from 'vitest'
import { sourceCount } from './schemas'

describe('official integer source counts', () => {
  it.each(['0', '00001', '9007199254740991'])('accepts exact safe integer %s', (value) => {
    expect(sourceCount.parse(value)).toBe(Number(value))
  })
  it.each(['-1', '1.5', '1e3', 'NaN', '', '9007199254740992'])('rejects malformed or unsafe %s', (value) => {
    expect(sourceCount.safeParse(value).success).toBe(false)
  })
})
