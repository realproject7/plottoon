/**
 * Minimal ERC-20 `balanceOf` reader for Dashboard balances (#249).
 *
 * Used by the Dashboard handler to surface USDC + PLOT balances next to
 * native ETH. Mirrors plotlink-ows's `wallet.ts` direct-RPC pattern, but
 * uses viem's `readContract` instead of hand-encoded `eth_call` selectors
 * so the call site is small and the address-padding logic stays inside
 * a battle-tested library.
 *
 * Returns the raw `uint256` balance as a base-10 string so the renderer
 * formats per-token (USDC is 6 decimals, PLOT is 18). Keeping the wei
 * string is consistent with how the Dashboard already passes ETH balance.
 */

import { createPublicClient, http, type Hex } from 'viem'
import { base } from 'viem/chains'

/** Base mainnet USDC token contract. Documented in plotlink-ows wallet.ts:60. */
export const USDC_BASE_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const ERC20_BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view'
  }
] as const

export interface Erc20BalanceConfig {
  rpcUrl: string
  /** Token contract on Base mainnet. */
  token: string
}

export async function readErc20Balance(
  walletAddress: string,
  config: Erc20BalanceConfig
): Promise<string> {
  const client = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl)
  })
  const balance = (await client.readContract({
    address: config.token as Hex,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args: [walletAddress as Hex]
  })) as bigint
  return balance.toString()
}
