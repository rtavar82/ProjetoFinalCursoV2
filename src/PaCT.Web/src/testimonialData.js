import { apiRequest, SESSION_EXPIRED } from './identityApi'
import { invalidateResources } from './liveUpdates'
import { submittedWrite } from './submittedWrites'

export function validateTestimonials(rows, manager = false) {
  if (!Array.isArray(rows) || rows.some(row => typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/.test(row.id) || typeof row.text !== 'string' || row.text.length > 10000
    || row.imageUrl !== null && (typeof row.imageUrl !== 'string' || !/^\/api\/(?:public\/)?testimonials\/[a-f0-9-]{36}\/images\/[a-f0-9-]{36}$/.test(row.imageUrl))
    || manager && (typeof row.published !== 'boolean' || !Number.isSafeInteger(row.version) || row.version < 1))) throw new Error('Não foi possível ler os testemunhos. Tenta novamente.')
  return rows
}
export async function readPublicTestimonials() { return validateTestimonials(await apiRequest('public/testimonials')) }
export async function readManagedTestimonials() { return validateTestimonials(await apiRequest('testimonials'), true) }

export async function saveTestimonial(item, fields, file, published) {
  const form = new FormData()
  form.set('text', fields.text); form.set('version', String(item.version)); form.set('operationId', fields.operationId)
  form.set('published', String(published)); form.set('removeImage', String(!file && fields.removeImage))
  if (file) form.set('image', file)
  return submittedWrite(async sent => {
  const csrf = await apiRequest('identity/csrf')
  let response
  sent()
  try { response = await fetch(`/api/testimonials/${item.id}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-PaCT-CSRF': csrf.token }, body: form }) }
  catch { throw new Error('A ligação foi interrompida. Verifica se a publicação foi guardada antes de repetir; o preenchimento foi mantido neste formulário.') }
  const result = await response.json().catch(() => ({}))
  if (response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED))
  if (!response.ok || !result.confirmed || result.publication?.id !== item.id) { const error = new Error(result.title || 'Não foi possível confirmar a gravação da publicação.'); if (!response.ok) error.status = response.status; throw error }
  invalidateResources(['testimonials', 'publicTestimonials'])
  return validateTestimonials([result.publication], true)[0]
  }, true)
}
