/// <reference types="vite/client" />

interface ProjectMeta {
  name: string
  version: number
  createdAt: string
  updatedAt: string
  description?: string
}

interface DiscoveredProject {
  id: string | null
  path: string
  meta: ProjectMeta | null
  error: string | null
}

interface CreatedProject {
  id: string
  path: string
  meta: ProjectMeta
}

interface PlottoonFs {
  openProject(): Promise<string | null>
  listProjects(): Promise<Array<{ id: string; root: string }>>
  readProjectFile(projectId: string, ...segments: string[]): Promise<string>
  writeProjectFile(projectId: string, segments: string[], content: string): Promise<void>
  writeProjectFileBinary(projectId: string, segments: string[], base64: string): Promise<void>
  regeneratePlotText(projectId: string, plotSlug: string): Promise<void>
  listProjectDir(projectId: string, ...segments: string[]): Promise<string[]>
  projectFileExists(projectId: string, ...segments: string[]): Promise<boolean>
  resolveProjectFilePath(projectId: string, ...segments: string[]): Promise<string>
  readAppConfig(filename: string): Promise<string>
  writeAppConfig(filename: string, content: string): Promise<void>
  importCleanImage(
    projectId: string,
    plotSlug: string,
    cutId: string
  ): Promise<{ relativePath: string; absolutePath: string; filename: string } | null>
  detectCleanImages(
    projectId: string,
    plotSlug: string,
    cutId: string
  ): Promise<Array<{ relativePath: string; filename: string }>>
  registerAgentFile(
    projectId: string,
    plotSlug: string,
    cutId: string,
    filename: string
  ): Promise<{ relativePath: string; absolutePath: string; filename: string }>
}

interface CliStatus {
  name: string
  command: string
  installed: boolean
  version: string | null
}

interface CapabilityReport {
  detectedAt: string
  clis: CliStatus[]
}

interface PlottoonProject {
  discover(): Promise<DiscoveredProject[]>
  readMeta(projectId: string): Promise<ProjectMeta>
  writeMeta(projectId: string, meta: ProjectMeta): Promise<void>
  create(name: string, description?: string): Promise<CreatedProject | null>
  setProjectsDir(): Promise<string | null>
  getProjectsDir(): Promise<string | null>
  detectClis(): Promise<CapabilityReport>
}

interface TerminalSessionMeta {
  id: string
  projectId: string
  cwd: string
  state: 'connected' | 'disconnected' | 'exited'
  createdAt: string
  exitCode: number | null
}

interface PlottoonTerminal {
  create(projectId: string): Promise<TerminalSessionMeta>
  getSession(sessionId: string): Promise<TerminalSessionMeta | null>
  findByProject(projectId: string): Promise<TerminalSessionMeta | null>
  connect(sessionId: string): Promise<boolean>
  write(sessionId: string, data: string): Promise<boolean>
  disconnect(sessionId: string): Promise<boolean>
  restart(sessionId: string): Promise<boolean>
  destroy(sessionId: string): Promise<boolean>
  onData(callback: (sessionId: string, data: string) => void): () => void
  onExit(callback: (sessionId: string, code: number | null) => void): () => void
}

type CheckStatus = 'pass' | 'fail' | 'info'

interface CapabilityCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

interface CapabilitySection {
  title: string
  checks: CapabilityCheck[]
}

interface FirstRunReport {
  generatedAt: string
  sections: CapabilitySection[]
}

interface PlottoonCapability {
  getReport(): Promise<FirstRunReport>
}

interface ActionEntry {
  timestamp: string
  action: string
  projectId: string | null
  plotId: string | null
  detail: string
}

interface PlottoonActionLog {
  log(action: string, detail: string, projectId?: string, plotId?: string): Promise<ActionEntry>
  get(projectId?: string): Promise<ActionEntry[]>
}

interface PublishPreflightResult {
  ready: boolean
  walletAddress?: string
  walletSource?: string
  signerMode: 'mock' | 'live'
  errors: string[]
}

interface PublishResultMeta {
  txHash: string | null
  storylineId: string | null
  plotIndex: number | null
  contentCid: string | null
  contentHash: string | null
  authorAddress: string | null
  gasCostWei: string | null
  totalCostWei: string | null
  plotlinkUrl: string | null
  walletAddress: string | null
  walletSource: string | null
  indexed: boolean
  indexError: string | null
  publishedAt: string | null
}

interface PublishExecuteResult {
  success: boolean
  error?: string
  result?: PublishResultMeta
}

interface PublishProgress {
  state: string
  detail?: string
}

interface PublishRequest {
  action: 'create-storyline' | 'chain-plot'
  title: string
  markdown: string
  projectId: string
  plotSlug: string
  storylineId?: string
  hasDeadline?: boolean
  isNsfw?: string
  contentType?: string
}

interface DashboardPlotEntry {
  projectId: string
  projectName: string
  plotSlug: string
  plotTitle: string
  cutCount: number
  plotState: string
  publishedAt: string | null
  publishResult: {
    txHash: string
    storylineId: string | null
    plotIndex: number | null
    contentCid: string
    contentHash: string
    authorAddress: string
    gasCostWei: string | null
    totalCostWei: string | null
    plotlinkUrl: string | null
    walletAddress: string
    walletSource: string
    indexed: boolean
    indexError: string | null
  } | null
}

interface DashboardStorylineGroup {
  storylineId: string
  projectId: string
  projectName: string
  plots: DashboardPlotEntry[]
  publishedCount: number
  notIndexedCount: number
  latestPublishedAt: string | null
  totalPublishCostWei: string
}

interface DashboardLocalGroup {
  groupKey: string
  projectId: string
  projectName: string
  plots: DashboardPlotEntry[]
}

interface DashboardCounts {
  totalProjects: number
  totalPlots: number
  publishedPlots: number
  pendingPlots: number
  notIndexedPlots: number
  failedPlots: number
}

interface DashboardWalletSummary {
  address: string | null
  source: string | null
  connected: boolean
  balanceWei: string | null
  balanceError: string | null
}

interface DashboardTokenPrice {
  ethUsd: number | null
  error: string | null
}

interface DashboardRoyaltySummary {
  earnedWei: string | null
  claimedWei: string | null
  unclaimedWei: string | null
  error: string | null
}

interface DashboardData {
  counts: DashboardCounts
  storylines: DashboardStorylineGroup[]
  localGroups: DashboardLocalGroup[]
  wallet: DashboardWalletSummary
  tokenPrice: DashboardTokenPrice
  royalty: DashboardRoyaltySummary
  generatedAt: string
}

interface PlottoonDashboard {
  getData(): Promise<DashboardData>
}

interface RoyaltyInfoResult {
  info: {
    earnedWei: string
    claimedWei: string
    unclaimedWei: string
    reserveToken: string
  } | null
  error: string | null
}

interface RoyaltyClaimResult {
  success: boolean
  txHash?: string
  gasCostWei?: string
  error?: string
}

interface RoyaltyClaimRecord {
  txHash: string
  walletAddress: string
  reserveToken: string
  gasCostWei: string | null
  status: 'confirmed' | 'failed'
  error: string | null
  claimedAt: string
}

interface RoyaltyClaimProgress {
  state: string
  detail?: string
}

interface PlottoonRoyalty {
  getInfo(): Promise<RoyaltyInfoResult>
  claim(confirmed: boolean): Promise<RoyaltyClaimResult>
  getClaimHistory(): Promise<{ claims: RoyaltyClaimRecord[] }>
  onProgress(callback: (progress: RoyaltyClaimProgress) => void): () => void
}

interface AgentCacheEntry {
  agentId: string
  agentName: string
  genre: string
  modelLabel: string
  agentURI: string
  registeredAt: string
  registeredBy: string
  walletAddress: string
}

interface AgentRegistrationStatus {
  registered: boolean
  agentId: string | null
  agentURI: string | null
}

interface AgentRegistrationResult {
  success: boolean
  agentId?: string
  txHash?: string
  error?: string
}

interface OwnerBindingProof {
  message: string
  signature: string
  owsWalletAddress: string
  cachedAgent: AgentCacheEntry | null
}

interface AgentStatusResult {
  status: AgentRegistrationStatus | null
  cached: AgentCacheEntry | null
  error: string | null
}

interface PlottoonAgent {
  getStatus(): Promise<AgentStatusResult>
  register(params: { agentName: string; genre?: string }): Promise<AgentRegistrationResult>
  getBindingProof(humanWallet: string): Promise<OwnerBindingProof | { error: string }>
}

interface IndexRetryParams {
  projectId: string
  plotSlug: string
  fallbackContent?: string
  meta?: { contentType?: string; isNsfw?: string; genre?: string; language?: string }
}

interface MarkNotIndexedParams {
  projectId: string
  plotSlug: string
  reason: string
}

interface IndexRetryResult {
  success: boolean
  error?: string
}

interface PlottoonPublish {
  preflight(): Promise<PublishPreflightResult>
  execute(request: PublishRequest, confirmed: boolean): Promise<PublishExecuteResult>
  onProgress(callback: (progress: PublishProgress) => void): () => void
  retryIndex(params: IndexRetryParams): Promise<IndexRetryResult>
  markNotIndexed(params: MarkNotIndexedParams): Promise<IndexRetryResult>
}

interface Window {
  plottoon: {
    version: string
    terminal: PlottoonTerminal
    fs: PlottoonFs
    publish: PlottoonPublish
    agent: PlottoonAgent
    dashboard: PlottoonDashboard
    royalty: PlottoonRoyalty
    project: PlottoonProject
    capability: PlottoonCapability
    actionLog: PlottoonActionLog
  }
}
