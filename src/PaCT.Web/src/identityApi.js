import { announceSuccessfulWrite } from './liveUpdates.js'

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

export async function uploadConsultationPhoto(consultationId, photoId, file, version) {
  if (!navigator.onLine) throw new Error('Sem ligação. A fotografia permanece no rascunho cifrado deste aparelho.')
  const csrf = await apiRequest('identity/csrf')
  const form = new FormData(); form.set('file', file); form.set('version', String(version))
  let response
  try { response = await fetch(`/api/consultations/${consultationId}/photos/${photoId}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-PaCT-CSRF': csrf.token }, body: form }) }
  catch { throw new Error('Não foi possível confirmar o envio da fotografia. O rascunho foi conservado; o fecho não foi enviado.') }
  const result = await response.json().catch(() => ({}))
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED))
  if (!response.ok || result.id !== photoId || result.confirmed !== true) throw new Error(result.title || 'Não foi possível confirmar esta fotografia no servidor.')
}

export async function apiRequest(path, body, { signal } = {}) {
  if (!navigator.onLine) throw new Error('Sem ligação. Os dados privados e as operações precisam de rede. Nada ficou em fila para envio automático.')
  const options = { credentials: 'same-origin', cache: 'no-store', headers: {}, signal }
  if (body !== undefined) {
    const csrf = await fetch('/api/identity/csrf', options)
    if (csrf.status === 429) throw rateLimitFailure(csrf)
    if (!csrf.ok) throw new Error('Não foi possível preparar um pedido seguro. Atualiza a página.')
    options.method = 'POST'
    options.headers = { 'Content-Type': 'application/json', 'X-PaCT-CSRF': (await csrf.json()).token }
    options.body = JSON.stringify(body)
  }
  let response
  try { response = await fetch('/api/' + path, options) }
  catch { throw new Error(body !== undefined ? 'A ligação foi interrompida e não foi possível confirmar o resultado. Não repitas automaticamente o pedido; verifica o estado antes de continuar.' : 'Sem ligação à aplicação. Verifica a rede e volta a tentar.') }
  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED))
    if (response.status === 429) throw rateLimitFailure(response, result.title)
    const failure = new Error(result.title || 'Não foi possível concluir o pedido. Nenhuma confirmação de sucesso foi recebida.')
    failure.status = response.status
    throw failure
  }
  if (body !== undefined) announceSuccessfulWrite(path, body)
  return result
}
