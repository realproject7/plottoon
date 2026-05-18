import {
  encodeFunctionData,
  createWalletClient,
  createPublicClient,
  http,
  serializeTransaction,
  type Hex
} from 'viem'
import { toAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import type { OWSCoreModule } from './owsAdapter'
import type { RoyaltyInfo, RoyaltyClaimResult } from '../../shared/royaltyFlow'

const royaltyAbi = [
  {
    type: 'function',
    name: 'getRoyaltyInfo',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'reserveToken', type: 'address' }
    ],
    outputs: [
      { name: 'earned', type: 'uint256' },
      { name: 'claimed', type: 'uint256' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'claimRoyalties',
    inputs: [{ name: 'reserveToken', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable'
  }
] as const

export interface RoyaltyClaimConfig {
  rpcUrl: string
  contractAddress: string
  defaultReserveToken: string
}

export function getDefaultRoyaltyConfig(): RoyaltyClaimConfig {
  return {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    contractAddress:
      process.env.PLOTLINK_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
    defaultReserveToken:
      process.env.PLOTLINK_RESERVE_TOKEN || '0x0000000000000000000000000000000000000000'
  }
}

export interface RoyaltyReadDeps {
  config: RoyaltyClaimConfig
}

export interface RoyaltyClaimDeps {
  config: RoyaltyClaimConfig
  ows: OWSCoreModule
  walletName: string
  walletAddress: string
  chain: string
  passphrase?: string
  onProgress?: (state: string, detail: string) => void
}

export async function readRoyaltyInfo(
  walletAddress: string,
  reserveToken: string,
  deps: RoyaltyReadDeps
): Promise<RoyaltyInfo> {
  const client = createPublicClient({
    chain: base,
    transport: http(deps.config.rpcUrl)
  })

  const result = await client.readContract({
    address: deps.config.contractAddress as Hex,
    abi: royaltyAbi,
    functionName: 'getRoyaltyInfo',
    args: [walletAddress as Hex, reserveToken as Hex]
  })

  const [earned, claimed] = result as [bigint, bigint]
  const unclaimed = earned - claimed

  return {
    earnedWei: earned.toString(),
    claimedWei: claimed.toString(),
    unclaimedWei: unclaimed.toString(),
    reserveToken
  }
}

export async function executeRoyaltyClaim(
  reserveToken: string,
  deps: RoyaltyClaimDeps
): Promise<RoyaltyClaimResult> {
  const progress = deps.onProgress ?? (() => {})

  progress('preparing', 'Encoding claim transaction')

  const data = encodeFunctionData({
    abi: royaltyAbi,
    functionName: 'claimRoyalties',
    args: [reserveToken as Hex]
  })

  progress('signing', 'Signing transaction with OWS wallet')

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

  progress('broadcasting', 'Broadcasting claim transaction')

  const txHash = await walletClient.sendTransaction({
    to: deps.config.contractAddress as Hex,
    data
  })

  progress('confirming', 'Waiting for confirmation')

  const publicClient = createPublicClient({
    chain: base,
    transport: http(deps.config.rpcUrl)
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  if (receipt.status === 'reverted') {
    progress('error', 'Claim transaction reverted')
    return { success: false, txHash, error: 'Transaction reverted on chain' }
  }

  const gasUsed = BigInt(receipt.gasUsed)
  const gasPrice = BigInt(receipt.effectiveGasPrice)
  const gasCostWei = (gasUsed * gasPrice).toString()

  progress('done', 'Royalties claimed successfully')

  return { success: true, txHash, gasCostWei }
}

export function encodeClaimRoyalties(reserveToken: string): string {
  return encodeFunctionData({
    abi: royaltyAbi,
    functionName: 'claimRoyalties',
    args: [reserveToken as Hex]
  })
}
