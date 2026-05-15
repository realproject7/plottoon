import { describe, it, expect } from 'vitest'
import { generateGlobalAgentsMd, generateProjectAgentsMd } from '../services/agentsTemplate'

describe('generateGlobalAgentsMd', () => {
  const content = generateGlobalAgentsMd()

  it('includes PlotToon heading', () => {
    expect(content).toContain('# PlotToon — Global Agent Instructions')
  })

  it('enforces cuts.json as canonical', () => {
    expect(content).toContain('cuts.json is canonical')
    expect(content).toContain('single source of truth')
  })

  it('enforces clean images', () => {
    expect(content).toContain('Clean images only')
    expect(content).toContain('suitable for general audiences')
  })

  it('enforces cut terminology', () => {
    expect(content).toContain('Cut terminology')
    expect(content).toContain('"cut"')
  })

  it('enforces no secret access', () => {
    expect(content).toContain('No secret access')
    expect(content).toContain('private keys')
    expect(content).toContain('wallet material')
  })

  it('mentions cut-NNN naming convention', () => {
    expect(content).toContain('cut-NNN')
  })

  it('mentions exports restriction', () => {
    expect(content).toContain('Do not modify exported files')
  })

  it('is deterministic', () => {
    expect(generateGlobalAgentsMd()).toBe(generateGlobalAgentsMd())
  })
})

describe('generateProjectAgentsMd', () => {
  const content = generateProjectAgentsMd('My Webtoon')

  it('includes project name in heading', () => {
    expect(content).toContain('# My Webtoon — Agent Instructions')
  })

  it('includes project name in file structure', () => {
    expect(content).toContain('My Webtoon/')
  })

  it('enforces cuts.json as canonical', () => {
    expect(content).toContain('cuts.json is canonical')
    expect(content).toContain('single source of truth')
  })

  it('enforces clean images', () => {
    expect(content).toContain('Clean images only')
  })

  it('enforces cut terminology', () => {
    expect(content).toContain('Cut terminology')
    expect(content).toContain('"cut"')
  })

  it('enforces no secret access', () => {
    expect(content).toContain('No secret access')
    expect(content).toContain('private keys')
    expect(content).toContain('wallet material')
  })

  it('documents file structure with cuts.json', () => {
    expect(content).toContain('cuts.json')
    expect(content).toContain('assets/')
    expect(content).toContain('exports/')
    expect(content).toContain('characters/')
    expect(content).toContain('plots/')
  })

  it('documents cut-NNN naming convention', () => {
    expect(content).toContain('cut-NNN')
  })

  it('mentions narration and continuity notes', () => {
    expect(content).toContain('narration')
    expect(content).toContain('continuityNotes')
  })

  it('restricts exports modification', () => {
    expect(content).toContain('Do not modify files in `exports/`')
  })

  it('is deterministic', () => {
    expect(generateProjectAgentsMd('Test')).toBe(generateProjectAgentsMd('Test'))
  })

  it('substitutes different project names', () => {
    const a = generateProjectAgentsMd('Alpha')
    const b = generateProjectAgentsMd('Beta')
    expect(a).toContain('# Alpha — Agent Instructions')
    expect(b).toContain('# Beta — Agent Instructions')
    expect(a).not.toContain('Beta')
    expect(b).not.toContain('Alpha')
  })
})
