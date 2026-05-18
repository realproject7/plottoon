export type PublishProgressState =
  | 'uploading'
  | 'estimating'
  | 'signing'
  | 'broadcasting'
  | 'confirming'
  | 'indexing'
  | 'done'
  | 'error'

export interface PublishPreflightResult {
  ready: boolean
  walletAddress?: string
  walletSource?: string
  signerMode: 'mock' | 'live'
  errors: string[]
}

export interface PublishRequest {
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

export interface PublishProgress {
  state: PublishProgressState
  detail?: string
}

export interface PublishResultMeta {
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

export interface PublishExecuteResult {
  success: boolean
  error?: string
  result?: PublishResultMeta
}
