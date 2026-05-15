import { describe, it, expect, beforeEach } from 'vitest'
import {
  createOverlayFromPreset,
  getPresetLabel,
  getPresetConfig,
  PRESET_NAMES,
  resetOverlayCounter
} from '../overlayPresets'

beforeEach(() => {
  resetOverlayCounter()
})

describe('PRESET_NAMES', () => {
  it('contains all five preset types', () => {
    expect(PRESET_NAMES).toEqual(['speech', 'thought', 'whisper', 'narration', 'sfx'])
  })
})

describe('getPresetLabel', () => {
  it('returns human-readable label for each preset', () => {
    expect(getPresetLabel('speech')).toBe('Speech Bubble')
    expect(getPresetLabel('thought')).toBe('Thought Bubble')
    expect(getPresetLabel('whisper')).toBe('Whisper')
    expect(getPresetLabel('narration')).toBe('Narration Box')
    expect(getPresetLabel('sfx')).toBe('SFX')
  })
})

describe('getPresetConfig', () => {
  it('returns config with correct type for text presets', () => {
    expect(getPresetConfig('speech').type).toBe('text')
    expect(getPresetConfig('thought').type).toBe('text')
    expect(getPresetConfig('whisper').type).toBe('text')
    expect(getPresetConfig('narration').type).toBe('text')
  })

  it('returns config with sfx type for SFX preset', () => {
    expect(getPresetConfig('sfx').type).toBe('sfx')
  })

  it('returns configs with positive dimensions', () => {
    for (const name of PRESET_NAMES) {
      const config = getPresetConfig(name)
      expect(config.width).toBeGreaterThan(0)
      expect(config.height).toBeGreaterThan(0)
    }
  })

  it('returns configs with style objects', () => {
    for (const name of PRESET_NAMES) {
      const config = getPresetConfig(name)
      expect(typeof config.style).toBe('object')
      expect(Object.keys(config.style).length).toBeGreaterThan(0)
    }
  })
})

describe('createOverlayFromPreset', () => {
  it('creates a speech overlay with correct schema fields', () => {
    const overlay = createOverlayFromPreset('speech', 50, 100)
    expect(overlay.id).toMatch(/^ovl-/)
    expect(overlay.type).toBe('text')
    expect(overlay.content).toBe('')
    expect(overlay.x).toBe(50)
    expect(overlay.y).toBe(100)
    expect(overlay.width).toBe(180)
    expect(overlay.height).toBe(60)
    expect(overlay.style).toBeDefined()
    expect(overlay.style!.borderRadius).toBe('16px')
  })

  it('creates a thought overlay with dotted border', () => {
    const overlay = createOverlayFromPreset('thought', 0, 0)
    expect(overlay.type).toBe('text')
    expect(overlay.style!.border).toContain('dotted')
    expect(overlay.style!.fontStyle).toBe('italic')
  })

  it('creates a whisper overlay with dashed border', () => {
    const overlay = createOverlayFromPreset('whisper', 10, 20)
    expect(overlay.type).toBe('text')
    expect(overlay.style!.border).toContain('dashed')
    expect(overlay.style!.color).toBe('#888888')
  })

  it('creates a narration overlay with box style', () => {
    const overlay = createOverlayFromPreset('narration', 0, 0)
    expect(overlay.type).toBe('text')
    expect(overlay.style!.textAlign).toBe('left')
    expect(overlay.style!.background).toBe('#fffde6')
  })

  it('creates an SFX overlay with sfx type', () => {
    const overlay = createOverlayFromPreset('sfx', 30, 40)
    expect(overlay.type).toBe('sfx')
    expect(overlay.style!.fontWeight).toBe('bold')
    expect(overlay.style!.border).toBe('none')
  })

  it('generates unique IDs for each overlay', () => {
    const a = createOverlayFromPreset('speech', 0, 0)
    const b = createOverlayFromPreset('speech', 0, 0)
    expect(a.id).not.toBe(b.id)
  })

  it('places overlay at specified coordinates', () => {
    const overlay = createOverlayFromPreset('narration', 123, 456)
    expect(overlay.x).toBe(123)
    expect(overlay.y).toBe(456)
  })

  it('produces overlay records that match the schema shape', () => {
    for (const name of PRESET_NAMES) {
      const overlay = createOverlayFromPreset(name, 0, 0)
      // Required fields
      expect(typeof overlay.id).toBe('string')
      expect(overlay.id.length).toBeGreaterThan(0)
      expect(['text', 'sfx']).toContain(overlay.type)
      expect(typeof overlay.content).toBe('string')
      expect(typeof overlay.x).toBe('number')
      expect(typeof overlay.y).toBe('number')
      expect(typeof overlay.width).toBe('number')
      expect(typeof overlay.height).toBe('number')
      // Style values must be strings
      if (overlay.style) {
        for (const [key, val] of Object.entries(overlay.style)) {
          expect(typeof key).toBe('string')
          expect(typeof val).toBe('string')
        }
      }
    }
  })
})
