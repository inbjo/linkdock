type JsonObject = Record<string, unknown>

function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  return bytes.buffer
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object') throw new Error('Invalid passkey options')
  return value as JsonObject
}

export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && 'PublicKeyCredential' in window
    && !!navigator.credentials
}

export async function createPasskey(options: unknown): Promise<JsonObject> {
  const wrapper = object(options)
  const source = object(wrapper.publicKey)
  const user = object(source.user)
  const excludeCredentials = Array.isArray(source.excludeCredentials)
    ? source.excludeCredentials.map((item) => {
        const credential = object(item)
        return { ...credential, id: decodeBase64Url(String(credential.id)) }
      })
    : undefined
  const publicKey = {
    ...source,
    challenge: decodeBase64Url(String(source.challenge)),
    user: { ...user, id: decodeBase64Url(String(user.id)) },
    excludeCredentials,
  } as PublicKeyCredentialCreationOptions
  const credential = await navigator.credentials.create({ publicKey })
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey creation was cancelled')
  const response = credential.response as AuthenticatorAttestationResponse
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: encodeBase64Url(response.attestationObject),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

export async function getPasskey(options: unknown): Promise<JsonObject> {
  const wrapper = object(options)
  const source = object(wrapper.publicKey)
  const allowCredentials = Array.isArray(source.allowCredentials)
    ? source.allowCredentials.map((item) => {
        const credential = object(item)
        return { ...credential, id: decodeBase64Url(String(credential.id)) }
      })
    : undefined
  const publicKey = {
    ...source,
    challenge: decodeBase64Url(String(source.challenge)),
    allowCredentials,
  } as PublicKeyCredentialRequestOptions
  const credential = await navigator.credentials.get({ publicKey })
  if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey login was cancelled')
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: encodeBase64Url(response.authenticatorData),
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}
