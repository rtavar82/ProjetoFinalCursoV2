import CalendarInput from './CalendarInput'
import { useCallback, useState } from 'react'
import AdaptiveSelect from './AdaptiveSelect'
import ActionButton from './ActionButton'
import ClientSearch from './ClientSearch'
import ClientProfileForm from './ClientProfileForm'
import ConsultationDialog from './ConsultationDialog'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import styles from './ManagerScheduling.module.css'
import DateRangeFields from './DateRangeFields'
import InformationCard from './InformationCard'
import Heading from './Heading'
import SaleDetails from './SaleDetails'
import useLiveResource from './useLiveResource'
import useRecoveryState from './useRecoveryState'
import { apiRequest } from './identityApi'
import { physicalLocations } from './clientBookingOptions'
import { agendaMoney } from './agendaTime'
import { saleKinds, saleMethods, newSaleDraft, newSaleLine, saleCommand, saleTotal } from './financialSales'

export default function SaleEditor({ send, disabled, guard, feedback, onClose, perform, notify }) {
  const [draft, setDraft] = useRecoveryState('finance:sale-editor', newSaleDraft)
  const [review, setReview] = useState(null), [error, setError] = useState(''), [creatingClient, setCreatingClient] = useState(false)
  const needsServices = draft.lines.some(line => ['Pack', 'CompletedConsultation'].includes(line.kind))
  const readSetup = useCallback(signal => apiRequest('consultations/setup', undefined, { signal }), [])
  const catalogue = useLiveResource('agenda', 'sale-services', readSetup, needsServices)
  const services = catalogue.data?.services || []
  const total = saleTotal(draft.lines)
  const change = values => { setDraft(current => ({ ...current, ...values })); setError('') }
  function changeLine(key, values) { setDraft(current => ({ ...current, lines: current.lines.map(line => line.key === key ? { ...line, ...values } : line) })); setError('') }
  function dismiss() { if (!disabled) guard(() => { setDraft(newSaleDraft()); onClose() }) }
  function createClient(input) { perform(async () => {
    const response = await apiRequest('clients', input)
    notify(response.message, !response.saved)
    if (response.saved) { change({ client: response.client, anonymous: false }); setCreatingClient(false) }
  }) }
  async function submit(event) {
    event.preventDefault(); setError('')
    try {
      if (!review) { setReview(saleCommand(draft)); return }
      await send(review, false, () => { setDraft(newSaleDraft()); onClose() })
    } catch (failure) { setError(failure.message) }
  }
  return <>
    <ManagerSchedulingDialog title={review ? 'Rever venda recebida' : 'Registar venda recebida'} label="Registo de venda" disabled={disabled} onClose={dismiss}>
      {feedback}{error && <p className="notice error" role="alert">{error}</p>}
      {review ? <><SaleDetails sale={{ ...review.sale, total }} clientName={draft.anonymous ? 'Venda anónima' : [draft.client?.data.firstName, draft.client?.data.lastName].filter(Boolean).join(' ')} />
        <div className="button-row"><ActionButton variant="secondary" disabled={disabled} onClick={() => setReview(null)}>Voltar atrás</ActionButton><ActionButton disabled={disabled} onClick={submit}>Confirmar venda e recebimento</ActionButton></div>
      </> : <form data-protect-draft onSubmit={submit}><fieldset className={styles.fields} disabled={disabled}>
        <label className="checkbox"><input type="checkbox" checked={draft.anonymous} onChange={e => change({ anonymous: e.target.checked, client: null })} />Venda anónima, sem ficha de cliente</label>
        {!draft.anonymous && <><ClientSearch purpose="finance" selected={draft.client} disabled={disabled} onSelect={client => change({ client })} /><ActionButton variant="text" disabled={disabled} onClick={() => setCreatingClient(true)}>Criar ficha de cliente</ActionButton></>}
        <label>Data e hora do recebimento<CalendarInput type="datetime-local" value={draft.effectiveAt} required onChange={e => change({ effectiveAt: e.target.value })} /></label>
        {needsServices && <InformationCard cardId="sale-catalogue-status" loading={catalogue.loading} error={catalogue.error} onRetry={catalogue.refresh} />}
        {draft.lines.map((line, index) => <InformationCard key={line.key} title={'Linha ' + (index + 1)} headingLevel={3} cardId={'sale-line-' + line.key}>
          <div className="fields-grid">
            <label>Tipo de venda<AdaptiveSelect aria-label="Tipo de venda" value={line.kind} onChange={e => changeLine(line.key, { ...newSaleLine(), key: line.key, kind: e.target.value })}>{Object.entries(saleKinds).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</AdaptiveSelect></label>
            <label>Nome<input value={line.name} maxLength="200" required onChange={e => changeLine(line.key, { name: e.target.value })} /></label>
            <label>Quantidade<input type="number" min="1" max="1000" step="1" value={line.quantity} required onChange={e => changeLine(line.key, { quantity: e.target.value })} /></label>
            <label>{line.kind === 'Pack' ? 'Valor final de cada pack' : 'Preço unitário'}<input type="number" min="0.01" max="1000000" step="0.01" value={line.unitPrice} required onChange={e => changeLine(line.key, { unitPrice: e.target.value })} /></label>
            {line.kind === 'Product' && <><label>Peso (opcional)<input maxLength="100" value={line.weight} onChange={e => changeLine(line.key, { weight: e.target.value })} /></label><label>Tamanho (opcional)<input maxLength="100" value={line.size} onChange={e => changeLine(line.key, { size: e.target.value })} /></label></>}
            {line.kind === 'Pack' && <><label>Sessões por pack<input type="number" min="1" max="1000" step="1" required value={line.sessions} onChange={e => changeLine(line.key, { sessions: e.target.value })} /></label><label>Valor das mesmas sessões avulso<input type="number" min="0.01" max="1000000" step="0.01" required value={line.regularTotal} onChange={e => changeLine(line.key, { regularTotal: e.target.value })} /></label></>}
            {line.kind === 'CompletedConsultation' && <><label>Tipo de consulta<AdaptiveSelect value={line.serviceIds[0] || ''} required onChange={e => changeLine(line.key, { serviceIds: [e.target.value], name: services.find(s => s.id === e.target.value)?.title || line.name })}><option value="">Escolhe a consulta</option>{services.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</AdaptiveSelect></label><label>Modalidade<AdaptiveSelect value={line.modality} onChange={e => changeLine(line.key, { modality: e.target.value })}><option value="InPerson">Presencial</option><option value="Remote">Online</option></AdaptiveSelect></label>
              {line.modality === 'InPerson' && <label>Local<AdaptiveSelect required value={line.location} onChange={e => changeLine(line.key, { location: e.target.value })}><option value="">Escolhe o local</option>{physicalLocations(catalogue.data).map(place => <option key={place}>{place}</option>)}</AdaptiveSelect></label>}
              <DateRangeFields startLabel="Início efetivo" endLabel="Fim efetivo" required exclusive value={{ start: line.start, end: line.end }} onChange={range => changeLine(line.key, { start: range.start, end: range.end })} />
            </>}
            <label className="full-width">Descrição (opcional)<textarea maxLength="1000" value={line.description} onChange={e => changeLine(line.key, { description: e.target.value })} /></label>
          </div>
          {line.kind === 'Pack' && <fieldset className={styles.fields}><legend>Consultas e serviços abrangidos</legend>{services.filter(s => s.active && s.serviceKind !== 'Retreat' && s.paymentMode !== 'Free').map(s => <label className="checkbox" key={s.id}><input type="checkbox" checked={line.serviceIds.includes(s.id)} onChange={e => changeLine(line.key, { serviceIds: e.target.checked ? [...line.serviceIds, s.id] : line.serviceIds.filter(id => id !== s.id) })} />{s.title}</label>)}<label>Desconto sobre o avulso<input readOnly value={Number(line.regularTotal) > 0 ? Number(((1 - Number(line.unitPrice) / Number(line.regularTotal)) * 100).toFixed(2)) + '%' : 'Indica o valor avulso'} /></label></fieldset>}
          <p>Total da linha: <strong>{agendaMoney(saleTotal([line]))}</strong></p>
          {draft.lines.length > 1 && <ActionButton variant="text" onClick={() => change({ lines: draft.lines.filter(l => l.key !== line.key) })}>Retirar linha {index + 1}</ActionButton>}
        </InformationCard>)}
        <ActionButton variant="secondary" disabled={draft.lines.length >= 20} onClick={() => change({ lines: [...draft.lines, newSaleLine()] })}>Acrescentar linha</ActionButton>
        <InformationCard title="Dinheiro já recebido" cardId="sale-payments"><p>Total da venda: <strong>{agendaMoney(total)}</strong></p>
          {draft.payments.map((payment, index) => <div className="fields-grid" key={index}><label>Método de recebimento<AdaptiveSelect value={payment.method} onChange={e => change({ payments: draft.payments.map((p, i) => i === index ? { ...p, method: e.target.value } : p) })}>{Object.entries(saleMethods).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</AdaptiveSelect></label><label>Valor recebido<input type="number" required min="0.01" max="1000000" step="0.01" value={payment.amount} onChange={e => change({ payments: draft.payments.map((p, i) => i === index ? { ...p, amount: e.target.value } : p) })} /></label>{draft.payments.length > 1 && <ActionButton variant="text" onClick={() => change({ payments: draft.payments.filter((_, i) => i !== index) })}>Retirar método {index + 1}</ActionButton>}</div>)}
          <ActionButton variant="text" disabled={draft.payments.length >= 5} onClick={() => change({ payments: [...draft.payments, { method: Object.keys(saleMethods).find(method => !draft.payments.some(p => p.method === method)), amount: '' }] })}>Acrescentar método de recebimento</ActionButton>
        </InformationCard>
        <Heading level={3}>Total: {agendaMoney(total)}</Heading>
        <div className="button-row"><ActionButton variant="secondary" onClick={dismiss}>Voltar às vendas</ActionButton><ActionButton type="submit" disabled={needsServices && !catalogue.data}>Rever antes de confirmar</ActionButton></div>
      </fieldset></form>}
    </ManagerSchedulingDialog>
    {creatingClient && <ConsultationDialog title="Criar ficha de cliente" label="Cliente da venda" disabled={disabled} onClose={() => guard(() => setCreatingClient(false))}><ClientProfileForm manual busy={disabled} onSave={createClient} /></ConsultationDialog>}
  </>
}
