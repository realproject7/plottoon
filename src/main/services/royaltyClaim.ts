import { encodeFunctionData, createWalletClient, createPublicClient, http, type Hex } from 'viem'
import { base } from 'viem/chains'
import type { OWSCoreModule } from './owsAdapter'
import { createOwsViemAccount } from './owsViemAccount'
import { resolveRpcUrl } from './owsRuntimeConfig'
import type { RoyaltyInfo, RoyaltyClaimResult } from '../../shared/royaltyFlow'

export const PLOT_TOKEN_BASE_MAINNET = '0x4F567DACBF9D15A6acBe4A47FC2Ade0719Fb63C4'

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
  mcv2BondAddress: string
  plotTokenAddress: string
}

export function validateRoyaltyConfig(config: RoyaltyClaimConfig): string[] {
  const errors: string[] = []
  if (
    !config.mcv2BondAddress ||
    config.mcv2BondAddress === '0x0000000000000000000000000000000000000000'
  ) {
    errors.push('MCV2_BOND_ADDRESS is required for royalty operations')
  }
  if (
    !config.plotTokenAddress ||
    config.plotTokenAddress === '0x0000000000000000000000000000000000000000'
  ) {
    errors.push('PLOT_TOKEN_ADDRESS is required for royalty operations')
  }
  if (!config.rpcUrl) {
    errors.push('BASE_RPC_URL is required for royalty operations')
  }
  return errors
}

export function getDefaultRoyaltyConfig(): RoyaltyClaimConfig {
  return {
    rpcUrl: resolveRpcUrl(),
    mcv2BondAddress: process.env.MCV2_BOND_ADDRESS || '',
    plotTokenAddress: process.env.PLOT_TOKEN_ADDRESS || PLOT_TOKEN_BASE_MAINNET
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
    address: deps.config.mcv2BondAddress as Hex,
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

  progress('broadcasting', 'Broadcasting claim transaction')

  const txHash = await walletClient.sendTransaction({
    to: deps.config.mcv2BondAddress as Hex,
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
