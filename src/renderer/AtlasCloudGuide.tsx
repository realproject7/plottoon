export function AtlasCloudGuide(): JSX.Element {
  return (
    <div className="screen screen--narrow">
      <div className="screen__header">
        <div>
          <h2 className="screen__title">AtlasCloud Backend Guide</h2>
          <p className="screen__subtitle">
            Advanced image generation using AtlasCloud-style API backends, managed entirely by your
            connected Claude or Codex agent.
          </p>
        </div>
      </div>

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
            <strong>Agent environment:</strong> pass the key via the agent&apos;s environment
            variables when launching
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
