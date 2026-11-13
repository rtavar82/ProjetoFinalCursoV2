import moneyText from './moneyText'
import RecoveryForm from './RecoveryForm'
import DisclosureSummary from './DisclosureSummary'
import AppArrow from './AppArrow'
import CalendarInput from './CalendarInput'
import { useCallback, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import ExpenseDetails from './ExpenseDetails'
import ExpenseAllocationFields from './ExpenseAllocationFields'
import Heading from './Heading'
import InformationCard from './InformationCard'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import { DirectoryPanel } from './ManagementPage'
import useLiveResource from './useLiveResource'
import useRecoveryState from './useRecoveryState'
import { apiRequest } from './identityApi'
import { agendaMoney, instant, localDate } from './agendaTime'
import { cents, saleMethods } from './financialSales'
import styles from './ManagerScheduling.module.css'

const vatRates = [23, 6, 0]
const newLine = () => ({ key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '', vat: 'Included', categoryId: '', kind: 'Expense' })
function lineTotal(line) {
  const quantityInThousandths = Math.round(Number(line.quantity || 0) * 1000)
  const vatRate = Number(line.vat) || 0
  return Math.round(quantityInThousandths * cents(line.unitPrice) * (100 + vatRate) / 100000) / 100
}
const startDraft = expense => ({ description: expense?.description || '', date: expense?.date || localDate(new Date()).slice(0, 10), supplier: expense?.supplierId ? { id: expense.supplierId, name: expense.supplierName } : null,
  invoiceNumber: expense?.invoiceNumber || '', invoiceDate: expense?.invoiceDate || '', reason: '', removeDocument: false,
  lines: expense?.lines.map(l => ({ ...l, key: crypto.randomUUID(),
    allocations: l.allocations?.map(a => ({ ...a, key: crypto.randomUUID() })) })) || [newLine()], payments: [] })

// Used both when recording an expense and when adding its later payments.
function PaymentFields({ payments, onChange, disabled }) {
  return <InformationCard title="Pagamentos efetuados" cardId="expense-payment-fields" headingLevel={3}>
    {!payments.length && <p>A despesa fica por pagar. Podes registar pagamentos mais tarde.</p>}
    {payments.map((payment, index) => <InformationCard key={payment.key} cardId={'expense-payment-input-' + index} variant="plain">
      <div className="fields-grid"><label>Valor pago<input data-recovery-controlled required type="number" min="0.01" max="1000000" step="0.01" value={payment.amount} onChange={e => onChange(payments.map((p, i) => i === index ? { ...p, amount: e.target.value } : p))} /></label>
        <label>Método<AdaptiveSelect aria-label="Método" value={payment.method} onChange={e => onChange(payments.map((p, i) => i === index ? { ...p, method: e.target.value } : p))}>{Object.entries(saleMethods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</AdaptiveSelect></label>
        <label>Data e hora efetivas<CalendarInput required type="datetime-local" value={payment.effectiveAt} onChange={e => onChange(payments.map((p, i) => i === index ? { ...p, effectiveAt: e.target.value } : p))} /></label>
      </div><ActionButton variant="text" disabled={disabled} onClick={() => onChange(payments.filter((_, i) => i !== index))}>Retirar pagamento {index + 1}</ActionButton>
    </InformationCard>)}
    <ActionButton variant="secondary" disabled={disabled || payments.length >= 20} onClick={() => onChange([...payments, { key: crypto.randomUUID(), amount: '', method: 'Transfer', effectiveAt: localDate(new Date()) }])}>Acrescentar pagamento efetuado</ActionButton>
  </InformationCard>
}

export default function ExpenseEditor({ expense, paymentOnly = false, disabled, error, clearError, write, onClose, guard }) {
  const [draft, setDraft] = useRecoveryState(`expense:${expense?.id || 'new'}:${paymentOnly}`, () => startDraft(expense))
  const [review, setReview] = useState(null), [localError, setLocalError] = useState(''), [reading, setReading] = useState(false), [documentError, setDocumentError] = useState('')
  const [document, setDocument] = useRecoveryState(`expense:${expense?.id || 'new'}:${paymentOnly}:document`, null)
  const readCategories = useCallback(async signal => {
    const rows = []; let page = 1, total
    do { const batch = await apiRequest(`management/ExpenseCategory?status=Active&page=${page++}`, undefined, { signal }); total = batch.total; if (!batch.items.length && rows.length < total) throw new Error('A lista de categorias mudou. Volta a tentar.'); rows.push(...batch.items) } while (rows.length < total)
    return rows
  }, [])
  const categories = useLiveResource('management', 'expense-categories', readCategories, !paymentOnly)
  const choices = [...(categories.data || []), ...(expense?.lines || []).filter(l => !categories.data?.some(c => c.id === l.categoryId)).map(l => ({ id: l.categoryId, name: l.categoryName }))]
    .filter((c, i, all) => all.findIndex(p => p.id === c.id) === i)
  const total = paymentOnly ? expense.total : draft.lines.reduce((sum, l) => sum + cents(lineTotal(l)), 0) / 100
  const paid = (expense?.paid || 0) + draft.payments.reduce((sum, p) => sum + cents(p.amount), 0) / 100
  const locked = disabled || reading
  function change(value) { setDraft(current => ({ ...current, ...value })); setLocalError(''); clearError() }
  function changeLine(key, values) { change({ lines: draft.lines.map(l => l.key === key ? { ...l, ...values } : l) }) }
  function dismiss() { guard(() => { setDraft(startDraft(expense), false); setDocument(null, false); onClose() }) }
  async function chooseDocument(file) {
    setDocument(null); setLocalError(''); setDocumentError('')
    if (!file) return
    if (file.size > 5242880) { setDocumentError('O documento pode ter até 5 MB.'); return }
    setReading(true)
    try {
      const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Não foi possível ler o documento.')); reader.readAsDataURL(file) })
      setDocument({ name: file.name, base64 }); change({ removeDocument: false })
    } catch (e) { setDocumentError(e.message) } finally { setReading(false) }
  }
  function prepare(event) {
    event.preventDefault(); clearError(); setLocalError('')
    try {
      if (documentError) throw new Error(documentError)
      if (cents(paid) > cents(total)) throw new Error('O valor pago excede o total da despesa.')
      if (paymentOnly && !draft.payments.length) throw new Error('Acrescenta o pagamento que efetuaste.')
      const payments = draft.payments.map(p => ({ amount: Number(p.amount), method: p.method, effectiveAt: instant(p.effectiveAt) }))
      if (payments.some(p => Date.parse(p.effectiveAt) > Date.now())) throw new Error('O pagamento não pode ter uma data futura.')
      const lines = draft.lines.map((l, index) => {
        const allocations = l.allocations || []
        if (allocations.some(a => {
          const amount = Number(a.amount)
          return !(amount > 0 && amount <= 1000000 && amount === cents(amount) / 100) || !a.activity && !a.location
        })) throw new Error('Na linha ' + (index + 1) + ', indica um valor positivo em euros, com até duas casas decimais, e escolhe uma atividade ou um local.')
        if (allocations.reduce((sum, a) => sum + cents(a.amount), 0) > cents(lineTotal(l)))
          throw new Error('A repartição da linha ' + (index + 1) + ' excede o total com IVA.')
        return { description: l.description.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice),
          vat: l.vat ?? null, categoryId: l.categoryId, kind: l.kind, allocations: allocations.map(a => ({
            amount: Number(a.amount), activityKind: a.activity?.kind, activityId: a.activity?.id, location: a.location
          })) }
      })
      const input = paymentOnly ? { action: 'Pay', version: expense.version, payments } : { action: 'Save', version: expense?.version || 0, description: draft.description.trim(), date: draft.date,
        supplierId: draft.supplier?.id || null, invoiceNumber: draft.invoiceNumber.trim() || null, invoiceDate: draft.invoiceDate || null, lines, payments: expense ? [] : payments, reason: expense ? draft.reason.trim() : null,
        document, removeDocument: draft.removeDocument }
      const preview = { ...expense, description: draft.description, date: draft.date, supplierName: draft.supplier?.name, invoiceNumber: draft.invoiceNumber, invoiceDate: draft.invoiceDate,
        lines: paymentOnly ? expense.lines : lines.map((l, index) => ({ ...l, total: lineTotal(l), categoryName: choices.find(c => c.id === l.categoryId)?.name,
          allocations: (draft.lines[index].allocations || []).map(a => ({ ...a, amount: Number(a.amount) })) })),
        payments: [...(expense?.payments || []), ...payments], total, paid, remaining: Math.round((total - paid) * 100) / 100,
        investments: paymentOnly ? expense.investments : lines.filter(l => l.kind === 'Investment').reduce((sum, l) => sum + cents(lineTotal(l)), 0) / 100,
        document: document || (draft.removeDocument ? null : expense?.document) }
      setReview({ input, preview })
    } catch (e) { setLocalError(e.message) }
  }
  async function confirm() { try { await write(expense?.id, review.input); setDraft(startDraft(), false); setDocument(null, false); onClose() } catch { /* Preserve the review and fields after rejection. */ } }
  return <ManagerSchedulingDialog title={review ? 'Rever antes de confirmar' : paymentOnly ? 'Registar pagamento da despesa' : expense ? 'Editar despesa' : 'Nova despesa ou investimento'} disabled={locked} onClose={dismiss}>
    {(error || localError || documentError) && <p className="notice error" role="alert">{error || localError || documentError}</p>}
    {review ? <><ExpenseDetails expense={review.preview} review /><InformationCard cardId="expense-effect"><p>Por pagar: {moneyText(agendaMoney(expense?.remaining ?? total))} <AppArrow direction="right" /> <strong>{moneyText(agendaMoney(review.preview.remaining))}</strong></p>{review.input.reason && <p>Motivo: {review.input.reason}</p>}</InformationCard>
      <div className="button-row"><ActionButton variant="secondary" disabled={locked} onClick={() => { setReview(null); clearError(); setLocalError('') }}>Voltar atrás</ActionButton><ActionButton disabled={locked} onClick={confirm}>{paymentOnly ? 'Confirmar pagamento efetuado' : 'Confirmar e guardar'}</ActionButton></div></>
      : <>
        {!paymentOnly && <details><DisclosureSummary>{draft.supplier ? 'Fornecedor: ' + draft.supplier.name : 'Escolher ou criar fornecedor (opcional)'}</DisclosureSummary>
          {draft.supplier && <ActionButton variant="text" disabled={locked} onClick={() => change({ supplier: null })}>Retirar fornecedor</ActionButton>}
          <DirectoryPanel kind="Supplier" busy={locked} guard={guard} selected={draft.supplier} onSelect={supplier => change({ supplier })} />
        </details>}
        <RecoveryForm recoveryKey={'expense:' + (expense?.id || 'new') + ':' + paymentOnly} recoveryVersion={expense?.version || 0} recoveryScopes={['expense:' + (expense?.id || 'new') + ':' + paymentOnly]} onVerified={onClose} data-protect-draft onSubmit={prepare}><fieldset className={styles.fields} disabled={locked}>
          {!paymentOnly && <>
            <div className="fields-grid"><label>Descrição da despesa<input data-recovery-controlled required maxLength="300" value={draft.description} onChange={e => change({ description: e.target.value })} /></label><label>Data da despesa<CalendarInput required type="date" max={localDate(new Date()).slice(0, 10)} value={draft.date} onChange={e => change({ date: e.target.value })} /></label></div>
            <InformationCard title="Fatura (opcional)" cardId="expense-invoice" headingLevel={3}><div className="fields-grid"><label>Número da fatura<input data-recovery-controlled maxLength="120" required={!!draft.invoiceDate} value={draft.invoiceNumber} onChange={e => change({ invoiceNumber: e.target.value })} /></label><label>Data da fatura<CalendarInput type="date" max={localDate(new Date()).slice(0, 10)} required={!!draft.invoiceNumber.trim()} value={draft.invoiceDate} onChange={e => change({ invoiceDate: e.target.value })} /></label></div></InformationCard>
            {(categories.loading || categories.error) && <InformationCard cardId="expense-categories-status" loading={categories.loading} error={categories.error} onRetry={categories.refresh} />}
            <Heading level={3}>Linhas da despesa</Heading>
            {draft.lines.map((line, index) => <InformationCard key={line.key} title={'Linha ' + (index + 1)} headingLevel={4} cardId={'expense-line-' + line.key}>
              <label>Descrição<input data-recovery-controlled required maxLength="500" value={line.description} onChange={e => changeLine(line.key, { description: e.target.value })} /></label>
              <div className="fields-grid">
                <label className="full-width">Quantidade<input data-recovery-controlled type="number" required min="0.001" max="1000000" step="0.001" value={line.quantity} onChange={e => changeLine(line.key, { quantity: e.target.value })} /></label>
                <div className={`full-width ${styles.pair} ${styles.keepPair}`}>
                  <label>Preço unitário<input data-recovery-controlled type="number" required min="0" max="1000000" step="0.01" value={line.unitPrice} onChange={e => changeLine(line.key, { unitPrice: e.target.value })} /></label>
                  <label>IVA<AdaptiveSelect aria-label="IVA" value={line.vat ?? 'Included'} onChange={e => changeLine(line.key, { vat: e.target.value })}>
                    <option value="Included">Incluído</option>
                    {vatRates.map(rate => <option key={rate} value={rate}>{rate} %</option>)}
                  </AdaptiveSelect></label>
                </div>
                <label>Categoria<AdaptiveSelect aria-label="Categoria" required value={line.categoryId} onChange={e => changeLine(line.key, { categoryId: e.target.value })}><option value="">Escolhe a categoria</option>{choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</AdaptiveSelect></label>
                <label>Tipo<AdaptiveSelect aria-label="Tipo" value={line.kind} onChange={e => changeLine(line.key, { kind: e.target.value })}><option value="Expense">Despesa</option><option value="Investment">Investimento</option></AdaptiveSelect></label></div>
              <p>Total da linha: <strong>{moneyText(agendaMoney(lineTotal(line)))}</strong></p>{draft.lines.length > 1 && <ActionButton variant="text" onClick={() => change({ lines: draft.lines.filter(l => l.key !== line.key) })}>Retirar linha {index + 1}</ActionButton>}
              <ExpenseAllocationFields allocations={line.allocations || []} total={lineTotal(line)} disabled={locked}
                onChange={allocations => changeLine(line.key, { allocations })} />
            </InformationCard>)}
            <ActionButton variant="secondary" disabled={draft.lines.length >= 100} onClick={() => change({ lines: [...draft.lines, newLine()] })}>Acrescentar linha</ActionButton>
            <label>Fotografia ou PDF (opcional, até 5 MB)<input type="file" accept="image/jpeg,image/png,application/pdf" onChange={e => chooseDocument(e.target.files[0])} /></label>
            {document && <p>Documento escolhido: {document.name} <ActionButton variant="text" onClick={() => setDocument(null)}>Retirar documento escolhido</ActionButton></p>}
            {expense?.document && <label><input type="checkbox" checked={draft.removeDocument} onChange={e => { setDocument(null); change({ removeDocument: e.target.checked }) }} />Retirar o documento atual ({expense.document.name})</label>}
            {expense && <label>Motivo da alteração<textarea data-recovery-controlled required maxLength="2000" value={draft.reason} onChange={e => change({ reason: e.target.value })} /></label>}
          </>}
          {(!expense || paymentOnly) && <PaymentFields payments={draft.payments} disabled={locked} onChange={payments => change({ payments })} />}
          <p>Total: <strong>{moneyText(agendaMoney(total))}</strong> · Pago: {moneyText(agendaMoney(paid))} · Por pagar: <strong>{moneyText(agendaMoney(total - paid))}</strong></p>
          <div className="button-row"><ActionButton variant="secondary" onClick={dismiss}>Voltar às despesas</ActionButton><ActionButton type="submit" disabled={!paymentOnly && (!categories.data || !!categories.error)}>Rever antes de confirmar</ActionButton></div>
        </fieldset></RecoveryForm>
      </>}
  </ManagerSchedulingDialog>
}
