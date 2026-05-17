export interface SigningResult {
  signature: string
  message: string
  timestamp: string
}

export interface SigningRequest {
  message: string
  requireConfirmation?: boolean
}

export type ConfirmationCallback = (message: string) => Promise<boolean>

export interface WalletSigningConfig {
  mode: 'live' | 'mock'
  sign?: (message: string) => Promise<string>
  onConfirmation?: ConfirmationCallback
}

const MOCK_SIGNATURE = 'mock-signature-placeholder'

async function mockSign(message: string): Promise<string> {
  return `${MOCK_SIGNATURE}:${Buffer.from(message).toString('base64url').slice(0, 16)}`
}

export function createWalletSigner(config: WalletSigningConfig) {
  const signFn = config.mode === 'mock' ? mockSign : config.sign

  if (!signFn) {
    throw new Error('Live mode requires a sign function')
  }

  async function requestSignature(request: SigningRequest): Promise<SigningResult> {
    if (request.requireConfirmation) {
      if (!config.onConfirmation) {
        throw new SigningError('Confirmation required but no confirmation handler configured')
      }
      const confirmed = await config.onConfirmation(request.message)
      if (!confirmed) {
        throw new SigningError('User rejected signing request')
      }
    }

    const timestamp = new Date().toISOString()
    const signature = await signFn(request.message)

    return { signature, message: request.message, timestamp }
  }

  function isMockMode(): boolean {
    return config.mode === 'mock'
  }

  return { requestSignature, isMockMode }
}

export class SigningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SigningError'
  }
}

export type WalletSigner = ReturnType<typeof createWalletSigner>
