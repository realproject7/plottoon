import { useEffect, useReducer } from 'react'
import { checkExportCapabilities } from './exportChecks'

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

const STATUS_INDICATOR: Record<CheckStatus, { symbol: string; color: string }> = {
  pass: { symbol: 'OK', color: 'var(--color-success)' },
  fail: { symbol: 'FAIL', color: 'var(--color-error)' },
  info: { symbol: 'INFO', color: 'var(--color-text-muted)' }
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

  return {
    ...report,
    sections: report.sections.map((section) => {
      if (section.title === 'Local Capabilities') {
        return { ...section, checks: [...section.checks, ...exportChecks] }
      }
      return section
    })
  }
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
    return (
      <div style={{ color: 'var(--color-text-muted)', padding: 'var(--space-4)' }}>
        Running capability checks...
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div style={{ color: 'var(--color-error)', padding: 'var(--space-4)' }}>
        Failed to load capability report: {state.error}
      </div>
    )
  }

  const report = state.report!

  return (
    <div style={{ maxWidth: 640 }}>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 'var(--font-weight-semibold)' as never,
          fontSize: 18,
          marginBottom: 'var(--space-6)'
        }}
      >
        Capability Report
      </h2>

      {report.sections.map((section) => (
        <div key={section.title} style={{ marginBottom: 'var(--space-6)' }}>
          <h3
            style={{
              fontSize: 13,
              fontWeight: 'var(--font-weight-medium)' as never,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: 'var(--space-2)'
            }}
          >
            {section.title}
          </h3>
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden'
            }}
          >
            {section.checks.map((check, i) => {
              const indicator = STATUS_INDICATOR[check.status]
              return (
                <div
                  key={check.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) var(--space-4)',
                    borderTop: i > 0 ? '1px solid var(--color-border)' : 'none'
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 'var(--font-weight-semibold)' as never,
                      color: indicator.color,
                      minWidth: 36,
                      textAlign: 'center'
                    }}
                  >
                    {indicator.symbol}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 'var(--font-weight-medium)' as never }}>
                      {check.label}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {check.detail}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          marginTop: 'var(--space-2)'
        }}
      >
        Generated at {new Date(report.generatedAt).toLocaleString()}
      </div>
    </div>
  )
}
