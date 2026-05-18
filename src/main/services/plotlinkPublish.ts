import {
  encodeFunctionData,
  decodeEventLog,
  createWalletClient,
  createPublicClient,
  http,
  type Hex
} from 'viem'
import { base } from 'viem/chains'
import type {
  PublishTransactionPayload,
  PublishTransactionResult
} from '../../shared/publishTransaction'
import type { OWSCoreModule } from './owsAdapter'
import { createOwsViemAccount } from './owsViemAccount'
import { STORY_FACTORY_BASE_MAINNET, MCV2_BOND_BASE_MAINNET } from './owsRuntimeConfig'

export interface PublishConfig {
  rpcUrl: string
  plotlinkBaseUrl: string
  storyFactoryAddress: string
  mcv2BondAddress: string
  creationFeeWei?: string
  indexRetries: number
  indexRetryDelayMs: number
  indexInitialDelayMs: number
}

export interface PublishContentResult {
  cid: string
  contentHash: string
}

export interface PublishFullResult {
  txHash: string
  confirmed: boolean
  storylineId?: string
  plotIndex?: number
  contentCid: string
  contentHash: string
  gasCostWei?: string
  authorAddress: string
  indexed: boolean
  indexError?: string
}

export interface TransactionReceipt {
  status: 'success' | 'reverted'
  logs: Array<{ topics: string[]; data: string }>
  gasUsed: string
  effectiveGasPrice: string
}

export interface DecodedPublishEvent {
  storylineId?: string
  plotIndex?: number
}

export interface ContractEncoder {
  encodeCreateStoryline(
    title: string,
    cid: string,
    contentHash: string,
    hasDeadline: boolean
  ): string
  encodeChainPlot(storylineId: string, title: string, cid: string, contentHash: string): string
  decodePublishEvents(receipt: TransactionReceipt): DecodedPublishEvent
}

export interface TransactionSigner {
  sendTransaction(params: { to: string; data: string; value?: string }): Promise<{ txHash: string }>
  waitForReceipt(txHash: string): Promise<TransactionReceipt>
}

export interface IpfsClient {
  upload(content: string, key: string): Promise<{ cid: string }>
}

export type KeccakFn = (content: string) => string

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export interface PlotlinkPublishDeps {
  ows: OWSCoreModule
  signer: TransactionSigner
  encoder: ContractEncoder
  ipfs: IpfsClient
  keccak: KeccakFn
  fetch: FetchFn
  config: PublishConfig
}

const plotlinkAbi = [
  {
    type: 'function',
    name: 'createStoryline',
    inputs: [
      { name: 'title', type: 'string' },
      { name: 'cid', type: 'string' },
      { name: 'contentHash', type: 'bytes32' },
      { name: 'hasDeadline', type: 'bool' }
    ],
    outputs: [{ name: 'storylineId', type: 'uint256' }],
    stateMutability: 'payable'
  },
  {
    type: 'function',
    name: 'chainPlot',
    inputs: [
      { name: 'storylineId', type: 'uint256' },
      { name: 'title', type: 'string' },
      { name: 'cid', type: 'string' },
      { name: 'contentHash', type: 'bytes32' }
    ],
    outputs: [],
    stateMutability: 'nonpayable'
  },
  {
    type: 'event',
    name: 'StorylineCreated',
    inputs: [
      { name: 'storylineId', type: 'uint256', indexed: true },
      { name: 'writer', type: 'address', indexed: true },
      { name: 'tokenAddress', type: 'address', indexed: false },
      { name: 'title', type: 'string', indexed: false },
      { name: 'hasDeadline', type: 'bool', indexed: false },
      { name: 'openingCID', type: 'string', indexed: false },
      { name: 'openingHash', type: 'bytes32', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'PlotChained',
    inputs: [
      { name: 'storylineId', type: 'uint256', indexed: true },
      { name: 'plotIndex', type: 'uint256', indexed: true },
      { name: 'writer', type: 'address', indexed: true },
      { name: 'title', type: 'string', indexed: false },
      { name: 'contentCID', type: 'string', indexed: false },
      { name: 'contentHash', type: 'bytes32', indexed: false }
    ]
  }
] as const

const creationFeeAbi = [
  {
    type: 'function',
    name: 'creationFee',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view'
  }
] as const

export async function fetchCreationFee(config: {
  rpcUrl: string
  mcv2BondAddress: string
}): Promise<string> {
  const client = createPublicClient({
    chain: base,
    transport: http(config.rpcUrl)
  })
  const fee = (await client.readContract({
    address: config.mcv2BondAddress as Hex,
    abi: creationFeeAbi,
    functionName: 'creationFee'
  })) as bigint
  return fee.toString()
}

export function createViemContractEncoder(): ContractEncoder {
  return {
    encodeCreateStoryline(title: string, cid: string, contentHash: string, hasDeadline: boolean) {
      return encodeFunctionData({
        abi: plotlinkAbi,
        functionName: 'createStoryline',
        args: [title, cid, contentHash as Hex, hasDeadline]
      })
    },
    encodeChainPlot(storylineId: string, title: string, cid: string, contentHash: string) {
      return encodeFunctionData({
        abi: plotlinkAbi,
        functionName: 'chainPlot',
        args: [BigInt(storylineId), title, cid, contentHash as Hex]
      })
    },
    decodePublishEvents(receipt: TransactionReceipt): DecodedPublishEvent {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: plotlinkAbi,
            data: log.data as Hex,
            topics: log.topics as [Hex, ...Hex[]]
          })
          if (decoded.eventName === 'StorylineCreated') {
            const args = decoded.args as { storylineId: bigint }
            return {
              storylineId: args.storylineId.toString(),
              plotIndex: 0
            }
          }
          if (decoded.eventName === 'PlotChained') {
            const args = decoded.args as { storylineId: bigint; plotIndex: bigint }
            return {
              storylineId: args.storylineId.toString(),
              plotIndex: Number(args.plotIndex)
            }
          }
        } catch {
          continue
        }
      }
      return {}
    }
  }
}

export function createOWSViemSigner(
  ows: OWSCoreModule,
  walletName: string,
  walletAddress: string,
  chain: string,
  passphrase: string | undefined,
  rpcUrl: string
): TransactionSigner {
  const account = createOwsViemAccount({
    ows,
    walletName,
    walletAddress,
    chain,
    passphrase
  })

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl)
  })

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl)
  })

  return {
    async sendTransaction(params) {
      const hash = await walletClient.sendTransaction({
        to: params.to as Hex,
        data: params.data as Hex,
        value: params.value ? BigInt(params.value) : undefined
      })
      return { txHash: hash }
    },
    async waitForReceipt(txHash) {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as Hex
      })
      return {
        status: receipt.status,
        logs: receipt.logs.map((l) => ({
          topics: [...l.topics] as string[],
          data: l.data
        })),
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString()
      }
    }
  }
}

function computeGasCost(receipt: TransactionReceipt): string {
  const gasUsed = BigInt(receipt.gasUsed)
  const gasPrice = BigInt(receipt.effectiveGasPrice)
  return (gasUsed * gasPrice).toString()
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

export function generateUploadKey(
  action: 'create-storyline' | 'chain-plot',
  title: string,
  storylineId?: string
): string {
  const ts = Date.now()
  if (action === 'create-storyline') {
    return `plotlink/storylines/${ts}-${slugify(title)}.json`
  }
  return `plotlink/plots/${storylineId ?? 'unknown'}-${ts}-${slugify(title)}.json`
}

async function uploadContent(
  markdown: string,
  key: string,
  deps: PlotlinkPublishDeps
): Promise<PublishContentResult> {
  const { cid } = await deps.ipfs.upload(markdown, key)
  const contentHash = deps.keccak(markdown)
  return { cid, contentHash }
}

async function indexWithRetry(
  url: string,
  body: Record<string, unknown>,
  deps: PlotlinkPublishDeps
): Promise<{ success: boolean; error?: string }> {
  if (deps.config.indexInitialDelayMs > 0) {
    await new Promise((r) => setTimeout(r, deps.config.indexInitialDelayMs))
  }
  for (let attempt = 0; attempt <= deps.config.indexRetries; attempt++) {
    try {
      const response = await deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (response.ok) {
        const json = (await response.json()) as Record<string, unknown>
        if (json.success === true || (json.ok === true && json.cached === true)) {
          return { success: true }
        }
      }
      if (attempt < deps.config.indexRetries) {
        await new Promise((r) => setTimeout(r, deps.config.indexRetryDelayMs))
      }
    } catch {
      if (attempt < deps.config.indexRetries) {
        await new Promise((r) => setTimeout(r, deps.config.indexRetryDelayMs))
      }
    }
  }
  return { success: false, error: 'Index failed after retries' }
}

export async function realPublish(
  payload: PublishTransactionPayload,
  markdown: string,
  authorAddress: string,
  deps: PlotlinkPublishDeps,
  indexMeta?: { isNsfw?: string; contentType?: string }
): Promise<PublishFullResult> {
  const uploadKey = generateUploadKey(payload.action, payload.title, payload.storylineId)
  const content = await uploadContent(markdown, uploadKey, deps)

  let txData: string
  let txValue: string | undefined

  if (payload.action === 'create-storyline') {
    txData = deps.encoder.encodeCreateStoryline(
      payload.title,
      content.cid,
      content.contentHash,
      payload.hasDeadline ?? false
    )
    txValue = payload.creationFeeWei
  } else {
    txData = deps.encoder.encodeChainPlot(
      payload.storylineId!,
      payload.title,
      content.cid,
      content.contentHash
    )
  }

  const { txHash } = await deps.signer.sendTransaction({
    to: deps.config.storyFactoryAddress,
    data: txData,
    value: txValue
  })

  const receipt = await deps.signer.waitForReceipt(txHash)

  if (receipt.status === 'reverted') {
    return {
      txHash,
      confirmed: false,
      contentCid: content.cid,
      contentHash: content.contentHash,
      authorAddress,
      indexed: false
    }
  }

  const decoded = deps.encoder.decodePublishEvents(receipt)
  const storylineId =
    payload.action === 'create-storyline' ? decoded.storylineId : payload.storylineId
  const plotIndex = decoded.plotIndex
  const gasCostWei = computeGasCost(receipt)

  const indexUrl =
    payload.action === 'create-storyline'
      ? `${deps.config.plotlinkBaseUrl}/api/index/storyline`
      : `${deps.config.plotlinkBaseUrl}/api/index/plot`

  const indexBody: Record<string, unknown> =
    payload.action === 'create-storyline'
      ? {
          storylineTitle: payload.title,
          contentType: indexMeta?.contentType ?? 'cartoon',
          isNsfw: indexMeta?.isNsfw ?? 'false',
          content: markdown,
          txHash
        }
      : {
          storylineId: payload.storylineId,
          isNsfw: indexMeta?.isNsfw ?? 'false',
          content: markdown,
          txHash
        }

  const indexResult = await indexWithRetry(indexUrl, indexBody, deps)

  return {
    txHash,
    confirmed: true,
    storylineId,
    plotIndex,
    contentCid: content.cid,
    contentHash: content.contentHash,
    gasCostWei,
    authorAddress,
    indexed: indexResult.success,
    indexError: indexResult.error
  }
}

export function createPublishTransactionFn(deps: PlotlinkPublishDeps, walletName: string) {
  return async (payload: PublishTransactionPayload): Promise<PublishTransactionResult> => {
    let txData: string
    let txValue: string | undefined

    if (payload.action === 'create-storyline') {
      txData = deps.encoder.encodeCreateStoryline(
        payload.title,
        payload.contentCid,
        payload.contentHash,
        payload.hasDeadline ?? false
      )
      txValue = payload.creationFeeWei
    } else {
      txData = deps.encoder.encodeChainPlot(
        payload.storylineId!,
        payload.title,
        payload.contentCid,
        payload.contentHash
      )
    }

    const message = `PlotLink: ${payload.action}\nContent: ${payload.contentCid}`
    deps.ows.signMessage(walletName, 'eip155:8453', message)

    const { txHash } = await deps.signer.sendTransaction({
      to: deps.config.storyFactoryAddress,
      data: txData,
      value: txValue
    })

    const receipt = await deps.signer.waitForReceipt(txHash)

    if (receipt.status === 'reverted') {
      return { txHash, confirmed: false }
    }

    const decoded = deps.encoder.decodePublishEvents(receipt)
    const storylineId =
      payload.action === 'create-storyline' ? decoded.storylineId : payload.storylineId
    const plotIndex = decoded.plotIndex

    return { txHash, confirmed: true, storylineId, plotIndex }
  }
}

export function createRealPublishDeps(
  ows: OWSCoreModule,
  walletName: string,
  walletAddress: string,
  chain: string,
  passphrase: string | undefined,
  ipfs: IpfsClient,
  keccak: KeccakFn,
  fetchFn: FetchFn,
  config: PublishConfig
): PlotlinkPublishDeps {
  return {
    ows,
    signer: createOWSViemSigner(ows, walletName, walletAddress, chain, passphrase, config.rpcUrl),
    encoder: createViemContractEncoder(),
    ipfs,
    keccak,
    fetch: fetchFn,
    config
  }
}

export function validatePublishConfig(config: PublishConfig): string[] {
  const errors: string[] = []
  if (
    !config.storyFactoryAddress ||
    config.storyFactoryAddress === '0x0000000000000000000000000000000000000000'
  ) {
    errors.push('PLOTLINK_STORY_FACTORY_ADDRESS is required for live publish')
  }
  if (
    !config.mcv2BondAddress ||
    config.mcv2BondAddress === '0x0000000000000000000000000000000000000000'
  ) {
    errors.push('MCV2_BOND_ADDRESS is required for live publish')
  }
  if (!config.rpcUrl) {
    errors.push('BASE_RPC_URL is required for live publish')
  }
  if (!config.plotlinkBaseUrl) {
    errors.push('PLOTLINK_BASE_URL is required for live publish')
  }
  return errors
}

export function createPlotlinkUploadClient(
  plotlinkBaseUrl: string,
  fetchFn: (url: string, init: RequestInit) => Promise<Response> = fetch as unknown as (
    url: string,
    init: RequestInit
  ) => Promise<Response>
): IpfsClient {
  return {
    async upload(content: string, key: string) {
      const uploadUrl = `${plotlinkBaseUrl}/api/upload`
      const response = await fetchFn(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, key })
      })
      if (!response.ok) {
        throw new Error(`PlotLink upload failed: ${response.status}`)
      }
      const json = (await response.json()) as { cid: string }
      return { cid: json.cid }
    }
  }
}

export function getDefaultPublishConfig(): PublishConfig {
  return {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    plotlinkBaseUrl: process.env.PLOTLINK_BASE_URL || 'https://plotlink.xyz',
    storyFactoryAddress:
      process.env.PLOTLINK_STORY_FACTORY_ADDRESS || STORY_FACTORY_BASE_MAINNET,
    mcv2BondAddress: process.env.MCV2_BOND_ADDRESS || MCV2_BOND_BASE_MAINNET,
    creationFeeWei: process.env.PLOTLINK_CREATION_FEE_WEI || undefined,
    indexRetries: 10,
    indexRetryDelayMs: 30000,
    indexInitialDelayMs: 8000
  }
}
