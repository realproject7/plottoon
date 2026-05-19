import { describe, it, expect } from 'vitest'
import { validateMeta } from '../services/projectMeta'
import { validateCutsFile } from '../services/cutsSchema'
import fixture from './fixtures/paper-chair-pilot.json'

describe('Paper Chair pilot fixture', () => {
  it('project meta passes validation', () => {
    const meta = validateMeta(fixture.project, '<fixture>')
    expect(meta.name).toBe('Paper Chair')
    expect(meta.version).toBe(1)
  })

  it('cuts file passes validation with 5 planned cuts', () => {
    const cutsFile = validateCutsFile(fixture.plots['seoul-in-all-this-noise'], '<fixture>')
    expect(cutsFile.plotTitle).toBe('Seoul, in All This Noise')
    expect(cutsFile.cuts).toHaveLength(5)
    expect(cutsFile.cuts.every((c) => c.status === 'planned')).toBe(true)
  })

  it('cut ids are unique and ordered', () => {
    const cuts = fixture.plots['seoul-in-all-this-noise'].cuts
    const ids = cuts.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (let i = 0; i < cuts.length; i++) {
      expect(cuts[i].order).toBe(i)
    }
  })

  it('contains no private content markers', () => {
    const raw = JSON.stringify(fixture)
    expect(raw).not.toMatch(/0x[0-9a-fA-F]{40}/)
    expect(raw).not.toMatch(/private[_-]?key/i)
    expect(raw).not.toMatch(/api[_-]?key/i)
    expect(raw).not.toMatch(/passphrase/i)
    expect(raw).not.toMatch(/mnemonic/i)
  })

  it('fixture is unpublished', () => {
    const ps = fixture.plots['seoul-in-all-this-noise'].publishState
    expect(ps.published).toBe(false)
    expect(ps.exportedAt).toBeNull()
    expect(ps.format).toBeNull()
  })
})
