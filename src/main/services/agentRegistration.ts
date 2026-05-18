import { createPublicClient, createWalletClient, encodeFunctionData, http, type Hex } from 'viem'
import { base } from 'viem/chains'
import type { OWSCoreModule } from './owsAdapter'
import { createOwsViemAccount } from './owsViemAccount'
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
    name: 'agentIdByWallet',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
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

  const registryAddr = deps.config.registryAddress as Hex
  const wallet = walletAddress as Hex

  try {
    const agentId = (await client.readContract({
      address: registryAddr,
      abi: agentRegistryAbi,
      functionName: 'agentIdByWallet',
      args: [wallet]
    })) as bigint

    if (agentId > BigInt(0)) {
      const info = await client.readContract({
        address: registryAddr,
        abi: agentRegistryAbi,
        functionName: 'getAgentInfo',
        args: [wallet]
      })
      const [, agentName, modelLabel] = info as [bigint, string, string, boolean]
      return {
        registered: true,
        agentId: agentId.toString(),
        agentName,
        modelLabel
      }
    }
  } catch {
    // agentIdByWallet not available, fall through to getAgentInfo
  }

  try {
    const result = await client.readContract({
      address: registryAddr,
      abi: agentRegistryAbi,
      functionName: 'getAgentInfo',
      args: [wallet]
    })

    const [agentId, agentName, modelLabel, registered] = result as [bigint, string, string, boolean]

    return {
      registered,
      agentId: registered ? agentId.toString() : null,
      agentName: registered ? agentName : null,
      modelLabel: registered ? modelLabel : null
    }
  } catch {
    // getAgentInfo failed, try balanceOf as token fallback
  }

  const balance = (await client.readContract({
    address: registryAddr,
    abi: agentRegistryAbi,
    functionName: 'balanceOf',
    args: [wallet]
  })) as bigint

  return {
    registered: balance > BigInt(0),
    agentId: null,
    agentName: null,
    modelLabel: null
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
  const data = encodeFunctionData({
    abi: agentRegistryAbi,
    functionName: 'registerAgent',
    args: [agentName, modelLabel, metadata]
  })

  const account = createOwsViemAccount({
    ows: deps.ows,
    walletName: deps.walletName,
    walletAddress: deps.walletAddress,
    chain: deps.chain,
    passphrase: deps.passphrase
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

  const postStatus = await readAgentStatus(deps.walletAddress, { config: deps.config })

  return { success: true, agentId: postStatus.agentId ?? undefined, txHash }
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
