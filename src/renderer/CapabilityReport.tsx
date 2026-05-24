import { useEffect, useReducer } from 'react'
import { checkExportCapabilities } from './exportChecks'
import { evaluatePublishReadiness } from '../shared/publishReadiness'

type Phase = 'loading' | 'ready' | 'error'

interface State {
  phase: Phase
  report: FirstRunReport | null
  error: string | null
}

type Action = { type: 'loaded'; report: FirstRunReport } | { type: 'failed'; error: string }

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'loaded':
      return { phase: 'ready', report: action.report, error: null }
    case 'failed':
      return { phase: 'error', report: null, error: action.error }
  }
}

const STATUS_INDICATOR: Record<CheckStatus, { symbol: string; modifier: string }> = {
  pass: { symbol: 'OK', modifier: 'check-row__indicator--pass' },
  fail: { symbol: 'FAIL', modifier: 'check-row__indicator--fail' },
  info: { symbol: 'INFO', modifier: 'check-row__indicator--info' }
}

function augmentWithExportChecks(report: FirstRunReport): FirstRunReport {
  const result = checkExportCapabilities()

  const exportChecks: CapabilityCheck[] = [
    {
      id: 'export-webp',
      label: 'WebP export',
      status: result.webp ? 'pass' : 'fail',
      detail: result.webp ? 'WebP encoding supported' : 'WebP encoding not available'
    },
    {
      id: 'export-jpeg',
      label: 'JPEG export',
      status: result.jpeg ? 'pass' : 'fail',
      detail: result.jpeg ? 'JPEG fallback encoding supported' : 'JPEG encoding not available'
    },
    {
      id: 'font-render',
      label: 'Font rendering',
      status: result.fontRender ? 'pass' : 'fail',
      detail: result.fontRender
        ? `Text rendering verified (sample: "${result.fontSample}")`
        : 'Font rendering produced blank output'
    }
  ]

  const sectionsWithExports = report.sections.map((section) => {
    if (section.title === 'Local Capabilities') {
      return { ...section, checks: [...section.checks, ...exportChecks] }
    }
    return section
  })

  // #253: re-evaluate `publish-ready` against the full check list — now
  // including the browser-only export rows. The main-process call doesn't
  // see those rows, so it skips them; once the renderer adds them they're
  // enforced. If any export check fails, publish flips to fail with a
  // useful reason instead of staying stale.
  const allChecks = sectionsWithExports.flatMap((s) => s.checks)
  const refreshedPublishCheck = evaluatePublishReadiness(allChecks)
  const sections = sectionsWithExports.map((section) => {
    if (section.title === 'Publishing') {
      return {
        ...section,
        checks: section.checks.map((c) => (c.id === 'publish-ready' ? refreshedPublishCheck : c))
      }
    }
    return section
  })

  return { ...report, sections }
}

export function CapabilityReport(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, {
    phase: 'loading',
    report: null,
    error: null
  })

  useEffect(() => {
    window.plottoon.capability
      .getReport()
      .then((report) => dispatch({ type: 'loaded', report: augmentWithExportChecks(report) }))
      .catch((err: Error) => dispatch({ type: 'failed', error: err.message }))
  }, [])

  if (state.phase === 'loading') {
    return <div className="loading-state">Running capability checks...</div>
  }

  if (state.phase === 'error') {
    return (
      <div className="error-panel">
        <div className="error-panel__title">Capability checks failed</div>
        <p className="error-panel__message">{state.error}</p>
      </div>
    )
  }

  const report = state.report!

  return (
    <div className="screen screen--narrow">
      <div className="screen__header">
        <div>
          <h2 className="screen__title">Capability Report</h2>
          <p className="screen__subtitle">
            Local capability checks for CLI tools, image export, and integrations.
          </p>
        </div>
      </div>

      {report.sections.map((section) => (
        <div key={section.title} className="screen__section">
          <div className="screen__section-label">{section.title}</div>
          <div className="check-panel">
            {section.checks.map((check) => {
              const indicator = STATUS_INDICATOR[check.status]
              return (
                <div key={check.id} className="check-row">
                  <span className={`check-row__indicator ${indicator.modifier}`}>
                    {indicator.symbol}
                  </span>
                  <div className="check-row__body">
                    <div className="check-row__label">{check.label}</div>
                    <div className="check-row__detail">{check.detail}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="screen__meta">
        Generated at {new Date(report.generatedAt).toLocaleString()}
      </div>
    </div>
  )
}
