import { announceSuccessfulWrite } from './liveUpdates.js'
import { reportFreshContent, reportStaleContent } from './readFreshness.js'
import { cancelSubmittedWrites, canReplay, clientOperation, submittedWrite } from './submittedWrites.js'

export const SESSION_EXPIRED = 'pact:session-expired'

export function request(path, body) { return apiRequest('identity/' + path, body) }

function rateLimitFailure(response, title) {
  const seconds = Number(response.headers.get('Retry-After'))
  const message = Number.isFinite(seconds) && seconds > 0
    ? `Aguarda ${Math.ceil(seconds / 60)} ${seconds <= 60 ? 'minuto' : 'minutos'} antes de voltar a tentar.`
    : title || 'O limite temporário de pedidos foi atingido. Aguarda antes de voltar a tentar.'
  const error = new Error(message)
  error.status = 429
  return error
}

export function uploadConsultationPhoto(consultationId, photoId, file, version) { return uploadPhoto(consultationId, photoId, file, 'version', version) }
export function uploadConversationPhoto(consultationId, photoId, file, version) { return uploadPhoto(consultationId, photoId, file, 'conversationVersion', version) }

async function uploadPhoto(consultationId, photoId, file, versionField, version) {
  const form = new FormData(); form.set('file', file); form.set(versionField, String(version))
  return submittedWrite(async sent => {
  const csrf = await apiRequest('identity/csrf')
  let response
  sent()
  try { response = await fetch(`/api/consultations/${consultationId}/photos/${photoId}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-PaCT-CSRF': csrf.token }, body: form }) }
  catch { throw new Error('Não foi possível confirmar o envio da imagem. O preenchimento foi mantido e a confirmação não foi enviada.') }
  const result = await response.json().catch(() => ({}))
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED))
  if (!response.ok || result.id !== photoId || result.confirmed !== true) {
    const failure = new Error(result.title || 'Não foi possível confirmar esta imagem no servidor.')
    if (!response.ok) failure.status = response.status
    throw failure
  }
  }, true)
}

export async function apiRequest(path, body, { signal, publicOnly = false } = {}) {
  if (publicOnly && body !== undefined) throw new Error('A visualização de visitante permite apenas consultar.')
  if (body !== undefined) {
    if (path === 'identity/sign-out') cancelSubmittedWrites()
    const submitted = JSON.stringify(body)
    const operationKey = clientOperation(path) ? crypto.randomUUID() : undefined
    let serverSupportsRecovery = !operationKey
    const result = await submittedWrite(sent => sendWrite(path, submitted, sent, operationKey, supported => { serverSupportsRecovery = supported }),
      () => serverSupportsRecovery && canReplay(path, body, operationKey))
    announceSuccessfulWrite(path, body)
    return result
  }
  if (!navigator.onLine) {
    reportStaleContent()
    throw new Error('Sem ligação. Não foi possível consultar a informação atual.')
  }
  const options = { credentials: publicOnly ? 'omit' : 'same-origin', cache: 'no-store', headers: {}, signal }
  let response
  options.signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  try { response = await fetch('/api/' + path, options) }
  catch (failure) {
    if (signal?.aborted) throw failure
    reportStaleContent()
    throw new Error('Sem ligação à aplicação. Verifica a rede e volta a tentar.', { cause: failure })
  }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status >= 500) reportStaleContent()
    if (response.status === 401 && !publicOnly) window.dispatchEvent(new Event(SESSION_EXPIRED))
    if (response.status === 429) throw rateLimitFailure(response, result.title)
    const failure = new Error(result.title || 'Não foi possível concluir o pedido. Nenhuma confirmação de sucesso foi recebida.')
    failure.status = response.status
    throw failure
  }
  reportFreshContent()
  return result
}

async function sendWrite(path, submitted, sent, operationKey, recoverySupport) {
  const options = { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) }
  const csrf = await fetch('/api/identity/csrf', options)
  if (csrf.status === 429) throw rateLimitFailure(csrf)
  if (!csrf.ok) { const error = new Error('Não foi possível preparar o envio.'); error.status = csrf.status; throw error }
  const proof = await csrf.json()
  const token = proof.token
  if (operationKey) recoverySupport(proof.clientWriteRecovery === true)
  sent()
  const response = await fetch('/api/' + path, { ...options, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PaCT-CSRF': token, ...(operationKey ? { 'Idempotency-Key': operationKey } : {}) }, body: submitted })
  const result = await response.json().catch(() => ({}))
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED))
  if (response.status === 429) throw rateLimitFailure(response, result.title)
  if (!response.ok) { const error = new Error(result.title || 'Não foi possível concluir o pedido. O preenchimento foi mantido.'); error.status = response.status; throw error }
  reportFreshContent()
  return result
}
