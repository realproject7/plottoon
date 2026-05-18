export interface RoyaltyInfo {
  earnedWei: string
  claimedWei: string
  unclaimedWei: string
  reserveToken: string
}

export interface RoyaltyClaimRequest {
  reserveToken: string
}

export interface RoyaltyClaimResult {
  success: boolean
  txHash?: string
  gasCostWei?: string
  error?: string
}

export type RoyaltyClaimProgressState =
  | 'preparing'
  | 'signing'
  | 'broadcasting'
  | 'confirming'
  | 'done'
  | 'error'

export interface RoyaltyClaimProgress {
  state: RoyaltyClaimProgressState
  detail?: string
}
