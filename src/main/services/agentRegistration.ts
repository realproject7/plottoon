import { createPublicClient, encodeFunctionData, http, type Hex } from 'viem'
import { base } from 'viem/chains'
import type { OWSCoreModule } from './owsAdapter'
import type {
  AgentRegistrationStatus,
  AgentRegistrationResult
} from '../../shared/agentRegistration'

const agentRegistryAbi = [
  {
    type: 'function',
    name: 'getAgentInfo',
    inputs: [{ name: 'agentWallet', type: 'address' }],
    outputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'agentName', type: 'string' },
      { name: 'modelLabel', type: 'string' },
      { name: 'registered', type: 'bool' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'registerAgent',
    inputs: [
      { name: 'agentName', type: 'string' },
      { name: 'modelLabel', type: 'string' },
      { name: 'metadata', type: 'string' }
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable'
  }
] as const

export interface AgentRegistrationConfig {
  rpcUrl: string
  registryAddress: string
}

export function getDefaultAgentRegistrationConfig(): AgentRegistrationConfig {
  return {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    registryAddress:
      process.env.PLOTLINK_AGENT_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000'
  }
}

export interface AgentRegistrationReadDeps {
  config: AgentRegistrationConfig
}

export async function readAgentStatus(
  walletAddress: string,
  deps: AgentRegistrationReadDeps
): Promise<AgentRegistrationStatus> {
  const client = createPublicClient({
    chain: base,
    transport: http(deps.config.rpcUrl)
  })

  const result = await client.readContract({
    address: deps.config.registryAddress as Hex,
    abi: agentRegistryAbi,
    functionName: 'getAgentInfo',
    args: [walletAddress as Hex]
  })

  const [agentId, agentName, modelLabel, registered] = result as [bigint, string, string, boolean]

  return {
    registered,
    agentId: registered ? agentId.toString() : null,
    agentName: registered ? agentName : null,
    modelLabel: registered ? modelLabel : null
  }
}

export interface AgentRegistrationWriteDeps {
  config: AgentRegistrationConfig
  ows: OWSCoreModule
  walletName: string
  walletAddress: string
  chain: string
  passphrase?: string
}

export async function executeAgentRegistration(
  agentName: string,
  modelLabel: string,
  metadata: string,
  deps: AgentRegistrationWriteDeps
): Promise<AgentRegistrationResult> {
  const { createWalletClient } = await import('viem')
  const { serializeTransaction } = await import('viem')
  const { toAccount } = await import('viem/accounts')

  const data = encodeFunctionData({
    abi: agentRegistryAbi,
    functionName: 'registerAgent',
    args: [agentName, modelLabel, metadata]
  })

  const account = toAccount({
    address: deps.walletAddress as Hex,
    async signMessage({ message }) {
      const raw = typeof message === 'string' ? message : String(message.raw)
      const result = deps.ows.signMessage(deps.walletName, deps.chain, raw, deps.passphrase ?? null)
      return result.signature as Hex
    },
    async signTransaction(tx) {
      const serialized = serializeTransaction(tx)
      const result = deps.ows.signTransaction(
        deps.walletName,
        deps.chain,
        serialized,
        deps.passphrase ?? null
      )
      return result.signature as Hex
    },
    async signTypedData() {
      throw new Error('signTypedData not supported by OWS signer')
    }
  })

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(deps.config.rpcUrl)
  })

  const txHash = await walletClient.sendTransaction({
    to: deps.config.registryAddress as Hex,
    data
  })

  const publicClient = createPublicClient({
    chain: base,
    transport: http(deps.config.rpcUrl)
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  if (receipt.status === 'reverted') {
    return { success: false, txHash, error: 'Registration transaction reverted' }
  }

  const agentId = txHash

  return { success: true, agentId, txHash }
}

export function buildOwnerBindingMessage(humanWallet: string, owsWallet: string): string {
  return `I authorize ${humanWallet} as my PlotLink owner. Wallet: ${owsWallet}`
}

export function signOwnerBinding(
  humanWallet: string,
  owsWallet: string,
  ows: OWSCoreModule,
  walletName: string,
  chain: string,
  passphrase?: string
): { message: string; signature: string } {
  const message = buildOwnerBindingMessage(humanWallet, owsWallet)
  const result = ows.signMessage(walletName, chain, message, passphrase ?? null)
  return { message, signature: result.signature }
}
