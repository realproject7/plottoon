export interface PublishTransactionPayload {
  action: 'create-storyline' | 'chain-plot'
  storylineId?: string
  title: string
  contentCid: string
  contentHash: string
  creationFeeWei?: string
  hasDeadline?: boolean
}

export interface PublishTransactionResult {
  txHash: string
  confirmed: boolean
  storylineId?: string
  plotIndex?: number
}
