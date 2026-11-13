import { canReplay } from './submittedWrites.js'
let active = null, requestOwner = null
export function installAccountRequestScope(owner) { requestOwner = owner; return () => { if (requestOwner === owner) requestOwner = null } }
export function installManagerWriteRecovery(runtime) { active = runtime; return () => { if (active === runtime) active = null } }
export function managerAccountHeaders(expectedAccount) { const owner = expectedAccount || requestOwner || active?.owner; return owner ? { 'X-PaCT-Account': owner } : {} }
export function managerAccountIsCurrent(headers) { const owner = requestOwner || active?.owner; return headers['X-PaCT-Account'] ? owner === headers['X-PaCT-Account'] : !owner }
export function prepareManagerWrite(path, submitted, key, explicitScope, expectedAccount) {
  if (!active || expectedAccount && expectedAccount !== active.owner || typeof submitted !== 'string') return null
  const body = JSON.parse(submitted)
  const command = !key && path.startsWith('consultations/') && !!body?.operationId && canReplay(path, body)
  if (!command && (!key || !/^(clients(?:\/|$)|profile$|finance\/expenses|management\/(Supplier|ExpenseCategory|presentation))/.test(path))) return null
  const form = active.captureForm(document.activeElement?.closest('form[data-recovery-key]')) || active.lastSubmittedForm()
  // Existing consultation/message controllers keep their own pending command.
  // The common adapter covers forms which otherwise regenerate an operation ID.
  if (command && !form?.generic && !explicitScope) return null
  return active.writeTicket(path, submitted, command ? body.operationId : key, form, command, explicitScope)
}
