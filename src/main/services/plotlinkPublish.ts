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

export function createOWSTransactionSigner(
  ows: OWSCoreModule,
  walletName: string,
  chain: string,
  passphrase: string | undefined,
  rpcSender: TransactionSigner
): TransactionSigner {
  return {
    async sendTransaction(params) {
      const signResult = ows.signTransaction(walletName, chain, params.data, passphrase ?? null)
      return rpcSender.sendTransaction({
        ...params,
        data: signResult.signature
      })
    },
    waitForReceipt: rpcSender.waitForReceipt.bind(rpcSender)
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
