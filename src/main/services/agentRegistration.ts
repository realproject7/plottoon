import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  type Hex
} from 'viem'
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
    name: 'register',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable'
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
    name: 'tokenOfOwnerByIndex',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' }
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'agentURI',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'uri', type: 'string' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'uri', type: 'string' }],
    stateMutability: 'view'
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true }
    ]
  }
] as const

export interface AgentRegistrationConfig {
  rpcUrl: string
  registryAddress: string
}

export const ERC8004_REGISTRY_BASE_MAINNET = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'

export function validateAgentRegistrationConfig(config: AgentRegistrationConfig): string[] {
  const errors: string[] = []
  if (
    !config.registryAddress ||
    config.registryAddress === '0x0000000000000000000000000000000000000000'
  ) {
    errors.push('PLOTLINK_AGENT_REGISTRY_ADDRESS is required for agent registration')
  }
  if (!config.rpcUrl) {
    errors.push('BASE_RPC_URL is required for agent registration')
  }
  return errors
}

export function getDefaultAgentRegistrationConfig(): AgentRegistrationConfig {
  return {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    registryAddress: process.env.PLOTLINK_AGENT_REGISTRY_ADDRESS || ERC8004_REGISTRY_BASE_MAINNET
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
      const uri = await readAgentURI(client, registryAddr, agentId)
      return {
        registered: true,
        agentId: agentId.toString(),
        agentURI: uri
      }
    }
  } catch {
    // agentIdByWallet not available, fall through to ownership detection
  }

  try {
    const balance = (await client.readContract({
      address: registryAddr,
      abi: agentRegistryAbi,
      functionName: 'balanceOf',
      args: [wallet]
    })) as bigint

    if (balance > BigInt(0)) {
      try {
        const tokenId = (await client.readContract({
          address: registryAddr,
          abi: agentRegistryAbi,
          functionName: 'tokenOfOwnerByIndex',
          args: [wallet, BigInt(0)]
        })) as bigint

        const uri = await readAgentURI(client, registryAddr, tokenId)
        return {
          registered: true,
          agentId: tokenId.toString(),
          agentURI: uri
        }
      } catch {
        return { registered: true, agentId: null, agentURI: null }
      }
    }
  } catch {
    // balanceOf not available
  }

  return { registered: false, agentId: null, agentURI: null }
}

async function readAgentURI(
  client: ReturnType<typeof createPublicClient>,
  registryAddr: Hex,
  agentId: bigint
): Promise<string | null> {
  try {
    return (await client.readContract({
      address: registryAddr,
      abi: agentRegistryAbi,
      functionName: 'agentURI',
      args: [agentId]
    })) as string
  } catch {
    try {
      return (await client.readContract({
        address: registryAddr,
        abi: agentRegistryAbi,
        functionName: 'tokenURI',
        args: [agentId]
      })) as string
    } catch {
      return null
    }
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

export function buildAgentURI(params: {
  agentName: string
  modelLabel: string
  genre?: string
  description?: string
}): string {
  return JSON.stringify({
    name: params.agentName,
    description: params.description || `AI writer agent: ${params.agentName}`,
    genre: params.genre || '',
    llmModel: params.modelLabel,
    registeredBy: 'plottoon',
    registeredAt: new Date().toISOString()
  })
}

export function encodeRegister(agentURI: string): string {
  return encodeFunctionData({
    abi: agentRegistryAbi,
    functionName: 'register',
    args: [agentURI]
  })
}

export function decodeRegisteredEvent(
  logs: { topics: Hex[]; data: Hex }[]
): { agentId: string; agentURI: string; owner: string } | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: agentRegistryAbi,
        eventName: 'Registered',
        topics: log.topics,
        data: log.data
      })
      return {
        agentId: (decoded.args as { agentId: bigint }).agentId.toString(),
        agentURI: (decoded.args as { agentURI: string }).agentURI,
        owner: (decoded.args as { owner: string }).owner
      }
    } catch {
      continue
    }
  }
  return null
}

export async function executeAgentRegistration(
  agentURI: string,
  deps: AgentRegistrationWriteDeps
): Promise<AgentRegistrationResult> {
  const data = encodeRegister(agentURI)

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

  const registeredEvent = decodeRegisteredEvent(receipt.logs as { topics: Hex[]; data: Hex }[])

  return {
    success: true,
    agentId: registeredEvent?.agentId,
    txHash
  }
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
