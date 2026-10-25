import { request } from './identityApi'

const encode = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))
function supported() {
  if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials?.create || !navigator.credentials?.get) throw new Error('Este navegador não permite Passkeys nesta ligação. Usa HTTPS e um navegador compatível.')
}
function normalize(options, registration) {
  const result = { ...options, challenge: decode(options.challenge) }
  if (registration) result.user = { ...options.user, id: decode(options.user.id) }
  for (const field of ['excludeCredentials', 'allowCredentials']) if (options[field]) result[field] = options[field].map(credential => ({ ...credential, id: decode(credential.id) }))
  return result
}
function serialize(credential, registration) {
  if (!credential) throw new Error('A verificação da Passkey não foi concluída.')
  const r = credential.response
  const response = { clientDataJSON: encode(r.clientDataJSON) }
  if (registration) { response.attestationObject = encode(r.attestationObject); response.transports = r.getTransports?.() || [] }
  else { response.authenticatorData = encode(r.authenticatorData); response.signature = encode(r.signature); response.userHandle = r.userHandle ? encode(r.userHandle) : null }
  return { id: credential.id, rawId: encode(credential.rawId), type: credential.type, response, extensions: credential.getClientExtensionResults() }
}
async function nativeCredential(options, registration) {
  try { return await navigator.credentials[registration ? 'create' : 'get']({ publicKey: normalize(options, registration) }) }
  catch (error) {
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') throw new Error('A verificação foi cancelada ou não foi confirmada a tempo. Podes tentar novamente.', { cause: error })
    if (error.name === 'InvalidStateError') throw new Error('Este dispositivo já tem uma Passkey para a conta. Usa outra Passkey ou outro dispositivo.', { cause: error })
    if (error.name === 'SecurityError') throw new Error('A Passkey exige o domínio HTTPS configurado para esta instalação. Não uses o endereço IP do computador.', { cause: error })
    throw new Error('Não foi possível utilizar a Passkey neste dispositivo. Verifica as opções de segurança do navegador.', { cause: error })
  }
}
export async function enrollPasskey(password, name, rememberDevice) {
  supported()
  const options = await request('passkeys/registration/options', { password })
  const credential = await nativeCredential(options.publicKey, true)
  return request('passkeys/registration/finish', { challengeId: options.challengeId, credential: serialize(credential, true), name, rememberDevice })
}
export async function verifyPasskey(rememberDevice) {
  supported()
  const options = await request('passkeys/assertion/options', {})
  const credential = await nativeCredential(options.publicKey, false)
  return request('passkeys/assertion/finish', { challengeId: options.challengeId, credential: serialize(credential, false), rememberDevice })
}
