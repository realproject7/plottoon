/**
 * Vitest global setup.
 *
 * #272: jsdom doesn't implement `window.matchMedia`, but xterm calls
 * it at construction time. Provide a benign stub so any renderer test
 * that mounts the agent terminal (directly or via App) doesn't crash.
 *
 * Also stub `ResizeObserver` — used by the agent terminal panel to
 * fit xterm to its container — for the same jsdom-gap reason.
 */

if (typeof window !== 'undefined') {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      }) as MediaQueryList
  }

  if (typeof window.ResizeObserver === 'undefined') {
    class StubResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    ;(window as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver =
      StubResizeObserver
  }
}
