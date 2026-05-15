import { describe, it, expect, beforeEach } from 'vitest'
import { logAction, getLog, clearLog, redactSecrets } from '../services/actionLog'

beforeEach(() => {
  clearLog()
})

describe('redactSecrets', () => {
  it('redacts api_key values', () => {
    expect(redactSecrets('api_key: sk-abc123')).toBe('[REDACTED]')
  })

  it('redacts apiKey values', () => {
    expect(redactSecrets('apiKey=mySecret123')).toBe('[REDACTED]')
  })

  it('redacts secret values', () => {
    expect(redactSecrets('secret: very-private')).toBe('[REDACTED]')
  })

  it('redacts token values', () => {
    expect(redactSecrets('token=bearer-xyz')).toBe('[REDACTED]')
  })

  it('redacts password values', () => {
    expect(redactSecrets('password: hunter2')).toBe('[REDACTED]')
  })

  it('redacts bearer tokens', () => {
    expect(redactSecrets('Bearer eyJhbGciOiJIUzI1NiJ9')).toBe('[REDACTED]')
  })

  it('redacts OpenAI-style API keys', () => {
    expect(redactSecrets('key is sk-abcdefghijklmnopqrstuvwxyz')).toBe('key is [REDACTED]')
  })

  it('redacts Slack tokens', () => {
    expect(redactSecrets('slack xoxb-123-456-abc')).toBe('slack [REDACTED]')
  })

  it('leaves safe text unchanged', () => {
    expect(redactSecrets('Created plot "my-story" in project abc')).toBe(
      'Created plot "my-story" in project abc'
    )
  })

  it('redacts multiple secrets in one string', () => {
    const input = 'api_key: abc123 and token=xyz789'
    const result = redactSecrets(input)
    expect(result).not.toContain('abc123')
    expect(result).not.toContain('xyz789')
  })
})

describe('logAction', () => {
  it('creates an entry with timestamp', () => {
    const entry = logAction('file:write', 'Wrote cuts.json', 'proj1')
    expect(entry.timestamp).toBeTruthy()
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN()
  })

  it('stores action and detail', () => {
    const entry = logAction('plot:create', 'Created plot "chapter-1"', 'proj1', 'plot1')
    expect(entry.action).toBe('plot:create')
    expect(entry.detail).toBe('Created plot "chapter-1"')
    expect(entry.projectId).toBe('proj1')
    expect(entry.plotId).toBe('plot1')
  })

  it('defaults projectId and plotId to null', () => {
    const entry = logAction('app:start', 'Application started')
    expect(entry.projectId).toBeNull()
    expect(entry.plotId).toBeNull()
  })

  it('redacts secrets in action field', () => {
    const entry = logAction('api_key: sk-abc', 'detail')
    expect(entry.action).not.toContain('sk-abc')
  })

  it('redacts secrets in detail field', () => {
    const entry = logAction('action', 'token=secret123')
    expect(entry.detail).not.toContain('secret123')
  })
})

describe('getLog', () => {
  it('returns all entries when no projectId filter', () => {
    logAction('a', 'd1', 'p1')
    logAction('b', 'd2', 'p2')
    logAction('c', 'd3')
    expect(getLog()).toHaveLength(3)
  })

  it('filters by projectId', () => {
    logAction('a', 'd1', 'p1')
    logAction('b', 'd2', 'p2')
    logAction('c', 'd3', 'p1')
    const filtered = getLog('p1')
    expect(filtered).toHaveLength(2)
    expect(filtered.every((e) => e.projectId === 'p1')).toBe(true)
  })

  it('returns empty array when no matching project', () => {
    logAction('a', 'd1', 'p1')
    expect(getLog('nonexistent')).toHaveLength(0)
  })
})

describe('clearLog', () => {
  it('removes all entries', () => {
    logAction('a', 'd1')
    logAction('b', 'd2')
    clearLog()
    expect(getLog()).toHaveLength(0)
  })
})

describe('log capacity', () => {
  it('trims entries beyond MAX_ENTRIES', () => {
    for (let i = 0; i < 510; i++) {
      logAction('action', `entry ${i}`)
    }
    expect(getLog().length).toBeLessThanOrEqual(500)
  })
})
