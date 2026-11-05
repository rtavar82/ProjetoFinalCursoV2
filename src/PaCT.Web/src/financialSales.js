import { instant, localDate } from './agendaTime'

export const saleKinds = { Product: 'Artigo / produto', Pack: 'Pack de sessões', Training: 'Formação', CompletedConsultation: 'Consulta já realizada', Service: 'Outro serviço realizado' }
export const saleMethods = { Transfer: 'Transferência bancária', Cash: 'Dinheiro', MbWay: 'MB WAY', Card: 'Cartão', Other: 'Outro' }
export const cents = value => Math.round(Number(value || 0) * 100)
export const saleTotal = lines => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * cents(line.unitPrice), 0) / 100
export const newSaleLine = () => ({ key: crypto.randomUUID(), kind: 'Product', name: '', description: '', quantity: '1', unitPrice: '', weight: '', size: '', serviceIds: [], sessions: '', regularTotal: '', modality: 'InPerson', location: '', start: '', end: '' })
export const newSaleDraft = () => ({ client: null, anonymous: false, effectiveAt: localDate(new Date()), lines: [newSaleLine()], payments: [{ method: 'Transfer', amount: '' }] })
export function saleCommand(draft) {
  if (!draft.anonymous && !draft.client) throw new Error('Escolhe uma ficha ou assinala venda anónima.')
  const lines = draft.lines.map(line => ({
    kind: line.kind, name: line.name.trim(), description: line.description.trim() || null,
    quantity: Number(line.quantity), unitPrice: Number(line.unitPrice),
    ...(line.kind === 'Product' && { weight: line.weight.trim() || null, size: line.size.trim() || null }),
    ...(line.kind === 'Pack' && { sessions: Number(line.sessions), regularTotal: Number(line.regularTotal), serviceIds: line.serviceIds }),
    ...(line.kind === 'CompletedConsultation' && { serviceIds: line.serviceIds, modality: line.modality, location: line.modality === 'Remote' ? null : line.location, startsAt: instant(line.start), endsAt: instant(line.end) })
  }))
  if (draft.anonymous && lines.some(l => l.kind === 'Pack')) throw new Error('Para vender um pack, escolhe uma ficha titular.')
  const payments = draft.payments.map(p => ({ method: p.method, amount: Number(p.amount) }))
  const total = saleTotal(lines)
  if (total <= 0 || payments.some(p => !Number.isFinite(p.amount) || p.amount <= 0) || payments.reduce((sum, p) => sum + cents(p.amount), 0) !== cents(total))
    throw new Error('Os recebimentos devem perfazer exatamente o total da venda.')
  if (new Set(payments.map(p => p.method)).size !== payments.length) throw new Error('Usa uma linha por método de recebimento.')
  const effectiveAt = instant(draft.effectiveAt)
  if (Date.parse(effectiveAt) > Date.now()) throw new Error('O recebimento não pode ter uma data futura.')
  return { action: 'RecordSale', sale: { personId: draft.anonymous ? null : draft.client.id, anonymous: draft.anonymous, effectiveAt, lines, payments } }
}
