import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData')
  }
}))

import {
  resolveProjectPath,
  resolvePlotFolder,
  resolveAssetPath,
  resolveExportPath,
  resolveAppConfigPath,
  appConfigDir,
  PathEscapeError
} from '../services/safePaths'

const root = '/home/user/my-project'

describe('resolveProjectPath', () => {
  it('resolves a simple relative path', () => {
    expect(resolveProjectPath(root, 'file.txt')).toBe(path.join(root, 'file.txt'))
  })

  it('resolves nested segments', () => {
    expect(resolveProjectPath(root, 'plots', 'ch1', 'page.json')).toBe(
      path.join(root, 'plots', 'ch1', 'page.json')
    )
  })

  it('resolves the root itself', () => {
    expect(resolveProjectPath(root)).toBe(root)
  })

  it('normalizes ./dot paths', () => {
    expect(resolveProjectPath(root, './plots/../plots/ch1')).toBe(path.join(root, 'plots', 'ch1'))
  })

  it('rejects traversal above project root', () => {
    expect(() => resolveProjectPath(root, '..')).toThrow(PathEscapeError)
  })

  it('rejects traversal with intermediate segments', () => {
    expect(() => resolveProjectPath(root, 'plots', '..', '..', 'etc')).toThrow(PathEscapeError)
  })

  it('rejects absolute paths outside root', () => {
    expect(() => resolveProjectPath(root, '/etc/passwd')).toThrow(PathEscapeError)
  })

  it('rejects sneaky double-dot patterns', () => {
    expect(() => resolveProjectPath(root, 'plots/../../..')).toThrow(PathEscapeError)
  })
})

describe('resolvePlotFolder', () => {
  it('resolves to plots/<plotId>', () => {
    expect(resolvePlotFolder(root, 'chapter-1')).toBe(path.join(root, 'plots', 'chapter-1'))
  })

  it('rejects traversal in plotId', () => {
    expect(() => resolvePlotFolder(root, '../../../etc')).toThrow(PathEscapeError)
  })
})

describe('resolveAssetPath', () => {
  it('resolves inside assets dir', () => {
    expect(resolveAssetPath(root, 'images', 'bg.png')).toBe(
      path.join(root, 'assets', 'images', 'bg.png')
    )
  })

  it('rejects escape from assets', () => {
    expect(() => resolveAssetPath(root, '..', '..', 'secrets')).toThrow(PathEscapeError)
  })
})

describe('resolveExportPath', () => {
  it('resolves inside exports dir', () => {
    expect(resolveExportPath(root, 'out.pdf')).toBe(path.join(root, 'exports', 'out.pdf'))
  })

  it('rejects escape from exports', () => {
    expect(() => resolveExportPath(root, '..', '..', '..', 'tmp')).toThrow(PathEscapeError)
  })
})

describe('appConfigDir', () => {
  it('returns userData/config', () => {
    expect(appConfigDir()).toBe(path.join('/mock/userData', 'config'))
  })
})

describe('resolveAppConfigPath', () => {
  it('resolves a config filename', () => {
    expect(resolveAppConfigPath('settings.json')).toBe(
      path.join('/mock/userData', 'config', 'settings.json')
    )
  })

  it('rejects traversal above config dir', () => {
    expect(() => resolveAppConfigPath('..', '..', 'etc')).toThrow(PathEscapeError)
  })
})
