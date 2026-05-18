export interface AgentRegistrationStatus {
  registered: boolean
  agentId: string | null
  agentName: string | null
  modelLabel: string | null
}

export interface AgentRegistrationResult {
  success: boolean
  agentId?: string
  txHash?: string
  error?: string
}

export interface OwnerBindingProof {
  message: string
  signature: string
  owsWalletAddress: string
  cachedAgent: AgentCacheEntry | null
}

export interface AgentCacheEntry {
  agentId: string
  agentName: string
  genre: string
  modelLabel: string
  registeredAt: string
  registeredBy: string
  walletAddress: string
}
