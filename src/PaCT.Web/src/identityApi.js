import { announceSuccessfulWrite } from './liveUpdates.js'
import { reportFreshContent, reportStaleContent } from './readFreshness.js'
import { cancelSubmittedWrites, canReplay, clientOperation, requiresExplicitSubmission, submittedWrite } from './submittedWrites.js'

import { prepareManagerWrite, managerAccountHeaders, managerAccountIsCurrent } from './managerWriteRecovery.js'

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

export function uploadConsultationPhoto(consultationId, photoId, file, version, expectedAccount) { return uploadPhoto(consultationId, photoId, file, 'version', version, expectedAccount) }
export function uploadConversationPhoto(consultationId, photoId, file, version, expectedAccount) { return uploadPhoto(consultationId, photoId, file, 'conversationVersion', version, expectedAccount) }

async function uploadPhoto(consultationId, photoId, file, versionField, version, expectedAccount) {
  const accountHeaders = managerAccountHeaders(expectedAccount)
  const form = new FormData(); form.set('file', file); form.set(versionField, String(version))
  return submittedWrite(async sent => {
  const csrf = await apiRequest('identity/csrf')
  let response
  sent()
  try { response = await fetch(`/api/consultations/${consultationId}/photos/${photoId}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { ...accountHeaders, 'X-PaCT-CSRF': csrf.token }, body: form }) }
  catch { throw new Error('Não foi possível confirmar o envio da imagem. O preenchimento foi mantido e a confirmação não foi enviada.') }
  const result = await response.json().catch(() => ({}))
  if (response.status === 401 && managerAccountIsCurrent(accountHeaders)) window.dispatchEvent(new Event(SESSION_EXPIRED))
  if (!response.ok || result.id !== photoId || result.confirmed !== true) {
    const failure = new Error(result.title || 'Não foi possível confirmar esta imagem no servidor.')
    if (!response.ok) failure.status = response.status
    throw failure
  }
  }, true)
}

export function sendConversationAudio(id, command, audio, expectedAccount) {
  const accountHeaders = managerAccountHeaders(expectedAccount)
  const form = new FormData()
  form.set('operationId', command.operationId)
  form.set('conversationVersion', String(command.conversationVersion))
  form.set('messageText', command.messageText)
  command.photoIds.forEach(photoId => form.append('photoIds', photoId))
  command.messageIds?.forEach(messageId => form.append('messageIds', messageId))
  form.set('audio', audio)
  if (command.messageVideoId) form.set('messageVideoId', command.messageVideoId)
  return submittedWrite(async sent => {
    const csrf = await apiRequest('identity/csrf')
    sent()
    const response = await fetch(`/api/consultations/${id}/messages/audio`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { ...accountHeaders, 'X-PaCT-CSRF': csrf.token },
      body: form, signal: AbortSignal.timeout(120000),
    })
    const result = await response.json().catch(() => ({}))
    if (response.status === 401 && managerAccountIsCurrent(accountHeaders)) window.dispatchEvent(new Event(SESSION_EXPIRED))
    if (response.status === 429) throw rateLimitFailure(response, result.title)
    if (!response.ok || result.id !== command.operationId) {
      const error = new Error(result.title || 'Não foi possível confirmar o envio do áudio. O preenchimento foi mantido.')
      if (!response.ok) error.status = response.status
      throw error
    }
    announceSuccessfulWrite('consultations/commands', command)
    return result
  }, true)
}

export function uploadConversationVideo(consultationId, item, version, expectedAccount) {
  return uploadPrivateAttachment(`consultations/${consultationId}/messages/video/${item.id}`, item, 'conversationVersion', version, expectedAccount)
}

export function uploadClosureAttachment(consultationId, scope, item, version, expectedAccount) {
  return uploadPrivateAttachment(`consultations/${consultationId}/closure-media/${scope}/${item.id}`, item, 'version', version, expectedAccount)
}

function uploadPrivateAttachment(path, item, versionField, version, expectedAccount) {
  const accountHeaders = managerAccountHeaders(expectedAccount)
  const form = new FormData()
  form.set(versionField, String(version))
  form.set(item.kind === 'image' ? 'images' : item.kind, item.file)
  return submittedWrite(async sent => {
    const csrf = await apiRequest('identity/csrf')
    sent()
    const response = await fetch('/api/' + path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { ...accountHeaders, 'X-PaCT-CSRF': csrf.token },
      body: form, signal: AbortSignal.timeout(120000),
    })
    const result = await response.json().catch(() => ({}))
    if (response.status === 401 && managerAccountIsCurrent(accountHeaders)) window.dispatchEvent(new Event(SESSION_EXPIRED))
    if (response.status === 429) throw rateLimitFailure(response, result.title)
    if (!response.ok || result.id !== item.id || result.confirmed !== true) {
      const error = new Error(result.title || 'Não foi possível preparar o anexo. O envio não foi confirmado.')
      if (!response.ok) error.status = response.status
      throw error
    }
  }, true)
}

export async function apiRequest(path, body, { signal, publicOnly = false, responseType = 'json', recoveryScope, expectedAccount } = {}) {
  const accountHeaders = managerAccountHeaders(expectedAccount)
  if (publicOnly && body !== undefined) throw new Error('A visualização de visitante permite apenas consultar.')
  if (body !== undefined) {
    if (path === 'identity/sign-out') cancelSubmittedWrites()
    if (requiresExplicitSubmission(path)) {
      if (!navigator.onLine) {
        reportStaleContent()
        throw new Error('Sem ligação. Volta a carregar no botão quando a ligação regressar. Este pedido não ficou em fila.')
      }
      const submitted = JSON.stringify(body)
      let result
      try { result = await sendWrite(path, submitted, () => {}, undefined, async () => {}, accountHeaders) }
      catch (failure) {
        if (failure.status && failure.status < 500) throw failure
        reportStaleContent()
        throw new Error('Não foi possível confirmar este pedido de segurança. Não será reenviado automaticamente. Verifica o resultado antes de tentar novamente.', { cause: failure })
      }
      announceSuccessfulWrite(path, body)
      return result
    }
    let submitted = body instanceof FormData ? body : JSON.stringify(body)
    let operationKey = clientOperation(path) ? crypto.randomUUID() : undefined
    const recovery = prepareManagerWrite(path, submitted, operationKey, recoveryScope, accountHeaders['X-PaCT-Account'])
    if (recovery) { submitted = recovery.submitted; operationKey = recovery.headerKey }
    let serverSupportsRecovery = !operationKey
    let result
    try { if (recovery?.command) await recovery.support(true); result = await submittedWrite(sent => sendWrite(path, submitted, sent, operationKey, async supported => { serverSupportsRecovery = supported; await recovery?.support(supported) }, accountHeaders),
      () => serverSupportsRecovery && canReplay(path, body, operationKey)) } catch (error) { if (error.status && error.status < 500 && !error.keepRecovery) await recovery?.reject(); else recovery?.uncertain(); throw error }
    await recovery?.complete(result.saved !== false && result.confirmed !== false)
    announceSuccessfulWrite(path, body)
    if (path === 'identity/sign-out') window.dispatchEvent(new Event('pact:signed-out'))
    return result
  }
  if (!navigator.onLine) {
    reportStaleContent()
    throw new Error('Sem ligação. Não foi possível consultar a informação atual.')
  }
  const options = { credentials: publicOnly ? 'omit' : 'same-origin', cache: 'no-store', headers: publicOnly ? {} : accountHeaders, signal }
  let response
  options.signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
  try { response = await fetch('/api/' + path, options) }
  catch (failure) {
    if (signal?.aborted) throw failure
    reportStaleContent()
    throw new Error('Sem ligação à aplicação. Verifica a rede e volta a tentar.', { cause: failure })
  }
  if (response.ok && responseType === 'blob') return response.blob()
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status >= 500) reportStaleContent()
    if (response.status === 401 && !publicOnly && managerAccountIsCurrent(accountHeaders)) window.dispatchEvent(new Event(SESSION_EXPIRED))
    if (response.status === 429) throw rateLimitFailure(response, result.title)
    const failure = new Error(result.title || 'Não foi possível concluir o pedido. Nenhuma confirmação de sucesso foi recebida.')
    failure.status = response.status
    throw failure
  }
  reportFreshContent()
  return result
}

async function sendWrite(path, submitted, sent, operationKey, recoverySupport, accountHeaders) {
  const multipart = submitted instanceof FormData
  const options = { credentials: 'same-origin', cache: 'no-store', headers: accountHeaders, signal: AbortSignal.timeout(15000) }
  const csrf = await fetch('/api/identity/csrf', options)
  if (csrf.status === 429) throw rateLimitFailure(csrf)
  if (!csrf.ok) { const error = new Error('Não foi possível preparar o envio.'); error.status = csrf.status; throw error }
  const proof = await csrf.json()
  const token = proof.token
  if (operationKey) await recoverySupport(proof.clientWriteRecovery === true)
  sent()
  const response = await fetch('/api/' + path, {
    ...options, ...(multipart && { signal: AbortSignal.timeout(120000) }), method: 'POST',
    headers: { ...accountHeaders, ...(!multipart && { 'Content-Type': 'application/json' }), 'X-PaCT-CSRF': token, ...(operationKey ? { 'Idempotency-Key': operationKey } : {}) },
    body: submitted,
  })
  const result = await response.json().catch(() => ({}))
  if (response.status === 401 && managerAccountIsCurrent(accountHeaders)) window.dispatchEvent(new Event(SESSION_EXPIRED))
  if (response.status === 429) throw rateLimitFailure(response, result.title)
  if (!response.ok) { const error = new Error(result.title || 'Não foi possível concluir o pedido. O preenchimento foi mantido.'); error.status = response.status; throw error }
  reportFreshContent()
  return result
}
