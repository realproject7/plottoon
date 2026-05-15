// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { checkExportCapabilities } from '../exportChecks'

describe('checkExportCapabilities', () => {
  it('returns a result with all expected fields', () => {
    const result = checkExportCapabilities()
    expect(result).toHaveProperty('webp')
    expect(result).toHaveProperty('jpeg')
    expect(result).toHaveProperty('fontRender')
    expect(result).toHaveProperty('fontSample')
    expect(typeof result.webp).toBe('boolean')
    expect(typeof result.jpeg).toBe('boolean')
    expect(typeof result.fontRender).toBe('boolean')
    expect(result.fontSample).toBe('PlotToon')
  })

  it('reports jpeg support status', () => {
    const result = checkExportCapabilities()
    expect(typeof result.jpeg).toBe('boolean')
  })

  it('reports webp support status', () => {
    const result = checkExportCapabilities()
    expect(typeof result.webp).toBe('boolean')
  })

  it('reports font rendering status', () => {
    const result = checkExportCapabilities()
    expect(typeof result.fontRender).toBe('boolean')
  })

  it('uses PlotToon as the font sample text', () => {
    const result = checkExportCapabilities()
    expect(result.fontSample).toBe('PlotToon')
  })
})
