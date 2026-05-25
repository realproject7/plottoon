import { useEffect, useState } from 'react'

export function AtlasCloudGuide(): JSX.Element {
  return (
    <div className="screen screen--narrow">
      <div className="screen__header">
        <div>
          <h2 className="screen__title">AtlasCloud Backend Guide</h2>
          <p className="screen__subtitle">
            Advanced image generation using AtlasCloud-style API backends. The provider account +
            API key are entirely user-owned — PlotToon never stores them. When you opt in below, the
            key in your shell is bridged into the agent process only.
          </p>
        </div>
      </div>

      <AtlasCloudBridgeCard />

      <GuideSection title="API Key Configuration">
        <p>
          PlotToon does not store API keys. Configure your AtlasCloud API key in your own local
          environment:
        </p>
        <ul>
          <li>
            <strong>Shell environment:</strong> export the key in your shell profile (e.g.{' '}
            <Code>export ATLASCLOUD_API_KEY=your-key</Code>)
          </li>
          <li>
            <strong>CLI config:</strong> set the key in your Claude or Codex CLI configuration file
          </li>
          <li>
            <strong>Agent environment bridge:</strong> use the opt-in toggle above so the agent
            process inherits <Code>ATLASCLOUD_API_KEY</Code> from your shell. The toggle defaults to
            off; the key value never crosses any renderer-facing IPC, log, or project file.
          </li>
        </ul>
        <WarningBox>
          Never paste your API key into PlotToon, GitHub, project files, or commit history. The
          agent reads the key from your environment at runtime.
        </WarningBox>
      </GuideSection>

      <GuideSection title="Output Path Rules">
        <p>The agent must save clean generated images to the following path structure:</p>
        <CodeBlock>{'plots/{plotId}/assets/{cutId}/clean-vNNN.webp'}</CodeBlock>
        <ul>
          <li>
            <Code>plotId</Code> — the plot&apos;s slug identifier
          </li>
          <li>
            <Code>cutId</Code> — the cut identifier (e.g. <Code>cut-001</Code>)
          </li>
          <li>
            <Code>vNNN</Code> — zero-padded version number (e.g. <Code>v001</Code>,{' '}
            <Code>v002</Code>)
          </li>
          <li>WebP is the preferred format; JPEG is an acceptable fallback</li>
        </ul>
      </GuideSection>

      <GuideSection title="cuts.json Updates">
        <p>
          After generating an image, the agent must update the cut&apos;s entry in{' '}
          <Code>cuts.json</Code> with:
        </p>
        <ul>
          <li>
            <Code>imageState.backend</Code> — identifier for the backend used (e.g.{' '}
            <Code>&quot;atlascloud&quot;</Code>)
          </li>
          <li>
            <Code>imageState.model</Code> — model name if known (e.g.{' '}
            <Code>&quot;atlas-xl-v2&quot;</Code>)
          </li>
          <li>
            <Code>imageState.prompt</Code> — the generation prompt sent to the API
          </li>
          <li>
            <Code>imageState.attempts</Code> — total number of generation attempts for this cut
          </li>
          <li>
            <Code>imageState.revisionNotes</Code> — notes on why a regeneration was requested
          </li>
        </ul>
      </GuideSection>

      <GuideSection title="Cost Warning">
        <WarningBox>
          AtlasCloud API calls incur costs on your provider account. The agent should confirm before
          batch or high-volume generation. Single-cut generation may proceed, but generating an
          entire plot or multiple plots requires explicit user approval.
        </WarningBox>
      </GuideSection>

      <GuideSection title="Agent Instructions">
        <p>
          When a project uses an AtlasCloud backend, the agent should follow these additional rules:
        </p>
        <ul>
          <li>Read the API key from the environment — never ask the user to provide it in chat</li>
          <li>
            Save images to the output path specified above and update <Code>cuts.json</Code>
          </li>
          <li>
            Set <Code>imageState.status</Code> to <Code>&quot;done&quot;</Code> only after
            confirming the file was written
          </li>
          <li>Log the generation action via the action log for auditability</li>
          <li>
            If the API returns an error, set <Code>imageState.status</Code> to{' '}
            <Code>&quot;failed&quot;</Code> and record the error in{' '}
            <Code>imageState.revisionNotes</Code>
          </li>
        </ul>
      </GuideSection>
    </div>
  )
}

function GuideSection({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="docs-section">
      <h3 className="docs-section__title">{title}</h3>
      <div className="docs-section__body">{children}</div>
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }): JSX.Element {
  return <code className="inline-code">{children}</code>
}

function CodeBlock({ children }: { children: React.ReactNode }): JSX.Element {
  return <pre className="code-block">{children}</pre>
}

function WarningBox({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div role="alert" className="warning-box">
      {children}
    </div>
  )
}

/**
 * #276: opt-in toggle for the ATLASCLOUD_API_KEY env bridge. Reads
 * the renderer-safe status (enabled / configured booleans only — never
 * the key value) and lets the user flip the per-backend toggle.
 */
function AtlasCloudBridgeCard(): JSX.Element {
  // Defensive: older preloads (or test fixtures that mock a smaller
  // subset of `window.plottoon`) may not expose the bridge IPC. We
  // resolve that in the useState initializer rather than inside the
  // useEffect body so we don't trip the React rule against synchronous
  // setState in effects.
  const bridgeApi = window.plottoon?.agentEnvBridge?.getStatus
    ? window.plottoon.agentEnvBridge
    : null
  const [status, setStatus] = useState<AgentEnvBridgeStatus | null>(
    bridgeApi ? null : { entries: [] }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bridgeApi) return
    let cancelled = false
    bridgeApi
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load bridge status')
      })
    return () => {
      cancelled = true
    }
  }, [bridgeApi])

  const atlasEntry = status?.entries.find((e) => e.bridgeKey === 'atlascloud')

  const handleToggle = async (next: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const refreshed = await window.plottoon.agentEnvBridge.setConfig({ atlascloud: next })
      setStatus(refreshed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update bridge')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="docs-section" data-testid="atlascloud-bridge-card">
      <h3 className="docs-section__title">Env bridge (opt-in)</h3>
      <div className="docs-section__body">
        <p>
          Forward <Code>ATLASCLOUD_API_KEY</Code> from your shell into the agent process. The toggle
          is off by default; PlotToon stores only your on/off choice and never reads or persists the
          key value.
        </p>
        {error && (
          <div className="warning-box" role="alert" data-testid="atlascloud-bridge-error">
            {error}
          </div>
        )}
        {!status && !error && (
          <div className="docs-section__body" data-testid="atlascloud-bridge-loading">
            Loading…
          </div>
        )}
        {atlasEntry && (
          <div className="bridge-row" data-testid="atlascloud-bridge-row">
            <div className="bridge-row__labels">
              <span className="bridge-row__title">
                ATLASCLOUD_API_KEY{' '}
                <span
                  className={`bridge-row__chip bridge-row__chip--${
                    atlasEntry.configured ? 'configured' : 'missing'
                  }`}
                  data-testid="atlascloud-bridge-configured"
                >
                  {atlasEntry.configured ? 'configured in shell' : 'not set in shell'}
                </span>
              </span>
              <span className="bridge-row__detail">
                {atlasEntry.enabled
                  ? 'Bridge is enabled. The agent process will receive the key while this toggle is on.'
                  : 'Bridge is disabled. The agent process will not see this key.'}
              </span>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => handleToggle(!atlasEntry.enabled)}
              data-testid="atlascloud-bridge-toggle"
              aria-pressed={atlasEntry.enabled}
            >
              {busy ? 'Updating…' : atlasEntry.enabled ? 'Disable bridge' : 'Enable bridge'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
