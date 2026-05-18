import {
  encodeFunctionData,
  decodeEventLog,
  createWalletClient,
  createPublicClient,
  http,
  serializeTransaction,
  type Hex
} from 'viem'
import { toAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import type {
  PublishTransactionPayload,
  PublishTransactionResult
} from '../../shared/publishTransaction'
import type { OWSCoreModule } from './owsAdapter'

export interface PublishConfig {
  rpcUrl: string
  plotlinkBaseUrl: string
  contractAddress: string
  ipfsUploadUrl: string
  creationFeeWei: string
  indexRetries: number
  indexRetryDelayMs: number
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
  upload(content: string): Promise<{ cid: string }>
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
      { name: 'token', type: 'address', indexed: false },
      { name: 'title', type: 'string', indexed: false },
      { name: 'contentCID', type: 'string', indexed: false },
      { name: 'contentHash', type: 'bytes32', indexed: false },
      { name: 'hasDeadline', type: 'bool', indexed: false },
      { name: 'plotIndex', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'PlotChained',
    inputs: [
      { name: 'storylineId', type: 'uint256', indexed: true },
      { name: 'plotIndex', type: 'uint256', indexed: true },
      { name: 'writer', type: 'address', indexed: false },
      { name: 'title', type: 'string', indexed: false },
      { name: 'contentCID', type: 'string', indexed: false },
      { name: 'contentHash', type: 'bytes32', indexed: false }
    ]
  }
] as const

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
          if (decoded.eventName === 'StorylineCreated' || decoded.eventName === 'PlotChained') {
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
  const account = toAccount({
    address: walletAddress as Hex,
    async signMessage({ message }) {
      const raw = typeof message === 'string' ? message : String(message.raw)
      const result = ows.signMessage(walletName, chain, raw, passphrase ?? null)
      return result.signature as Hex
    },
    async signTransaction(tx) {
      const serialized = serializeTransaction(tx)
      const result = ows.signTransaction(walletName, chain, serialized, passphrase ?? null)
      return result.signature as Hex
    },
    async signTypedData() {
      throw new Error('signTypedData not supported by OWS signer')
    }
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

async function uploadContent(
  markdown: string,
  deps: PlotlinkPublishDeps
): Promise<PublishContentResult> {
  const { cid } = await deps.ipfs.upload(markdown)
  const contentHash = deps.keccak(markdown)
  return { cid, contentHash }
}

async function indexWithRetry(
  url: string,
  body: Record<string, unknown>,
  deps: PlotlinkPublishDeps
): Promise<{ success: boolean; error?: string }> {
  for (let attempt = 0; attempt <= deps.config.indexRetries; attempt++) {
    try {
      const response = await deps.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (response.ok) {
        const json = (await response.json()) as { success: boolean }
        if (json.success) return { success: true }
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
  const content = await uploadContent(markdown, deps)

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
    to: deps.config.contractAddress,
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
      to: deps.config.contractAddress,
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

export function getDefaultPublishConfig(): PublishConfig {
  return {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    plotlinkBaseUrl: process.env.PLOTLINK_BASE_URL || 'https://plotlink.xyz',
    contractAddress:
      process.env.PLOTLINK_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
    ipfsUploadUrl: process.env.IPFS_UPLOAD_URL || 'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    creationFeeWei: process.env.PLOTLINK_CREATION_FEE_WEI || '100000000000000',
    indexRetries: 2,
    indexRetryDelayMs: 1000
  }
}
