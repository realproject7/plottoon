import type { Overlay } from './CutList'

export type PresetName = 'speech' | 'thought' | 'whisper' | 'narration' | 'sfx'

interface PresetConfig {
  label: string
  type: 'text' | 'sfx'
  defaultContent: string
  width: number
  height: number
  style: Record<string, string>
}

const PRESETS: Record<PresetName, PresetConfig> = {
  speech: {
    label: 'Speech Bubble',
    type: 'text',
    defaultContent: '',
    width: 180,
    height: 60,
    style: {
      background: '#ffffff',
      borderRadius: '16px',
      border: '2px solid #222222',
      padding: '8px 12px',
      fontSize: '13px',
      textAlign: 'center'
    }
  },
  thought: {
    label: 'Thought Bubble',
    type: 'text',
    defaultContent: '',
    width: 160,
    height: 55,
    style: {
      background: '#f0f0f0',
      borderRadius: '50%',
      border: '2px dotted #888888',
      padding: '8px 12px',
      fontSize: '12px',
      fontStyle: 'italic',
      textAlign: 'center'
    }
  },
  whisper: {
    label: 'Whisper',
    type: 'text',
    defaultContent: '',
    width: 150,
    height: 40,
    style: {
      background: 'transparent',
      border: '1px dashed #aaaaaa',
      borderRadius: '8px',
      padding: '4px 8px',
      fontSize: '11px',
      fontStyle: 'italic',
      color: '#888888',
      textAlign: 'center'
    }
  },
  narration: {
    label: 'Narration Box',
    type: 'text',
    defaultContent: '',
    width: 200,
    height: 50,
    style: {
      background: '#fffde6',
      border: '1px solid #d4c97a',
      borderRadius: '2px',
      padding: '8px 12px',
      fontSize: '12px',
      textAlign: 'left'
    }
  },
  sfx: {
    label: 'SFX',
    type: 'sfx',
    defaultContent: '',
    width: 120,
    height: 45,
    style: {
      background: 'transparent',
      border: 'none',
      fontSize: '18px',
      fontWeight: 'bold',
      fontStyle: 'italic',
      textAlign: 'center',
      color: '#e53e3e'
    }
  }
}

export const PRESET_NAMES: PresetName[] = ['speech', 'thought', 'whisper', 'narration', 'sfx']

export function getPresetLabel(name: PresetName): string {
  return PRESETS[name].label
}

export function getPresetConfig(name: PresetName): PresetConfig {
  return PRESETS[name]
}

let overlayCounter = 0

export function createOverlayFromPreset(presetName: PresetName, x: number, y: number): Overlay {
  overlayCounter++
  const preset = PRESETS[presetName]
  return {
    id: `ovl-${Date.now()}-${overlayCounter}`,
    type: preset.type,
    content: preset.defaultContent,
    x,
    y,
    width: preset.width,
    height: preset.height,
    style: { ...preset.style }
  }
}

export function resetOverlayCounter(): void {
  overlayCounter = 0
}
