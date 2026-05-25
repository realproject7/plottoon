/**
 * Renderer-side scrollback persistence for agent sessions (#273).
 *
 * Persists xterm scrollback to IndexedDB keyed by `${walletAddress}:
 * ${projectId}` so reopening the same wallet/project restores the
 * visible history. Mirrors plotlink-ows's `plotlink-terminal` store.
 *
 * Storage shape (one row per key):
 *   { key, walletAddress, projectId, content, updatedAt }
 *
 * The renderer code path NEVER persists secret strings: scrollback is
 * raw terminal output the user sees, so any sensitive content was
 * already on the user's screen. Tests pin that wallet A's scrollback
 * isn't returned when wallet B asks for the same project (the key
 * filter), and that an unset wallet returns nothing.
 */

const DB_NAME = 'plottoon-terminal'
const DB_VERSION = 1
const STORE_NAME = 'scrollback'
const MAX_SCROLLBACK_BYTES = 64 * 1024

export interface ScrollbackRow {
  key: string
  walletAddress: string
  projectId: string
  content: string
  updatedAt: string
}

function buildKey(walletAddress: string, projectId: string): string {
  return `${walletAddress.toLowerCase()}:${projectId}`
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (): void => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    req.onsuccess = (): void => resolve(req.result)
    req.onerror = (): void => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

export async function readScrollback(
  walletAddress: string,
  projectId: string
): Promise<string | null> {
  try {
    const db = await openDb()
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(buildKey(walletAddress, projectId))
      req.onsuccess = (): void => {
        const row = req.result as ScrollbackRow | undefined
        resolve(row?.content ?? null)
      }
      req.onerror = (): void => reject(req.error ?? new Error('read failed'))
    })
  } catch {
    return null
  }
}

export async function writeScrollback(
  walletAddress: string,
  projectId: string,
  content: string
): Promise<void> {
  try {
    const db = await openDb()
    const trimmed =
      content.length > MAX_SCROLLBACK_BYTES
        ? content.slice(content.length - MAX_SCROLLBACK_BYTES)
        : content
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const row: ScrollbackRow = {
        key: buildKey(walletAddress, projectId),
        walletAddress: walletAddress.toLowerCase(),
        projectId,
        content: trimmed,
        updatedAt: new Date().toISOString()
      }
      const req = store.put(row)
      req.onsuccess = (): void => resolve()
      req.onerror = (): void => reject(req.error ?? new Error('write failed'))
    })
  } catch {
    // Scrollback persistence is best-effort — never throw into the
    // renderer's mount/unmount path.
  }
}

export async function clearScrollback(walletAddress: string, projectId: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.delete(buildKey(walletAddress, projectId))
      req.onsuccess = (): void => resolve()
      req.onerror = (): void => reject(req.error ?? new Error('delete failed'))
    })
  } catch {
    // best effort
  }
}
