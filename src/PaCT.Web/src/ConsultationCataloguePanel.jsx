import { useCallback, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import CardGrid from './CardGrid'
import InformationCard from './InformationCard'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import { showSuccess } from './actionNotices'
import { agendaMoney } from './agendaTime'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import styles from './ManagerScheduling.module.css'

const labelFor = option => option.modality === 'Remote' ? 'Online' : option.publicLocation
const settings = rate => ({ durationMinutes: rate.durationMinutes ?? '', referencePrice: rate.referencePrice ?? '' })
const amount = value => value === '' ? null : Number(value)
const modes = { Prepayment: 'Pagamento antecipado', Postpayment: 'Pagamento posterior', Contribution: 'Contribuição livre', Free: 'Gratuita' }

export default function ConsultationCataloguePanel({ guard, busy }) {
  const read = useCallback(signal => apiRequest('consultations/catalogue', undefined, { signal }), [])
  const resource = useLiveResource('agenda', 'catalogue', read)
  const [editor, setEditor] = useState(null)
  const open = (service = null, remove = false) => guard(() => setEditor({ service, remove }))
  return <>
    <InformationCard title="Consultas individuais" loading={resource.loading} error={resource.error} onRetry={resource.refresh}
      actions={<ActionButton disabled={busy || !resource.data || !!resource.error} onClick={() => open()}>Nova consulta</ActionButton>}>
      <p>Gere as consultas que aparecem no Início e na Agenda. As marcações existentes conservam os dados registados.</p>
      {resource.data?.length === 0 && <p>Sem consultas individuais ativas.</p>}
    </InformationCard>
    {resource.data?.length > 0 && <CardGrid>{resource.data.map(service => <InformationCard title={service.title} key={service.id}
      actions={<><ActionButton variant="secondary" disabled={busy || !!resource.error} onClick={() => open(service)}>Editar</ActionButton>
        <ActionButton variant="text" disabled={busy || !!resource.error} aria-label={`Apagar ${service.title}`} onClick={() => open(service, true)}>Apagar</ActionButton></>}>
      <p>{service.durationMinutes} min{service.priced ? ` · ${agendaMoney(service.referencePrice)}` : ''}</p>
    </InformationCard>)}</CardGrid>}
    {editor && <CatalogueEditor {...editor} busy={busy} guard={guard} onClose={() => setEditor(null)} />}
  </>
}

function RateFields({ rate, value, onChange, inherit = false }) {
  const change = (key, event) => onChange({ ...value, [key]: event.target.value })
  return <div className="fields-grid">
    <label>Duração (minutos)<input type="number" min="15" max="720" step="1" required={!inherit}
      placeholder={inherit ? 'Duração base' : undefined} value={value.durationMinutes} onChange={event => change('durationMinutes', event)} /></label>
    {rate.priced && <label>Preço<input type="number" min="0.01" max="1000000" step="0.01" required={!inherit}
      placeholder={inherit ? 'Preço base' : undefined} value={value.referencePrice} onChange={event => change('referencePrice', event)} /></label>}
  </div>
}

function CatalogueEditor({ service, remove, guard, busy, onClose }) {
  const [title, setTitle] = useState(service?.title ?? '')
  const [description, setDescription] = useState(service?.presentation?.description ?? '')
  const [introduction, setIntroduction] = useState(service?.presentation?.introduction ?? '')
  const [recommendations, setRecommendations] = useState(service?.presentation?.recommendations ?? '')
  const [paymentMode, setPaymentMode] = useState(service?.paymentMode ?? '')
  const [inPerson, setInPerson] = useState(false), [remote, setRemote] = useState(false)
  const [base, setBase] = useState(() => settings(service ?? {}))
  const deliveryOptions = service?.options ?? []
  const [options, setOptions] = useState(() => deliveryOptions.map(settings))
  const [review, setReview] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState('')
  const disabled = busy || sending
  const priced = service?.priced ?? ['Prepayment', 'Postpayment'].includes(paymentMode)
  const summary = (rate, value) => <p>{value.durationMinutes || base.durationMinutes} min{rate.priced
    ? ` · ${agendaMoney(Number(value.referencePrice || base.referencePrice))}` : ''}</p>

  function prepare(event) {
    event.preventDefault()
    if (!title.trim() || !description.trim() || !service && !inPerson && !remote) {
      setError('Preenche o nome, a descrição e pelo menos uma modalidade da consulta.')
      return
    }
    setError('')
    setReview(true)
  }

  async function publish() {
    const input = value => ({ durationMinutes: amount(value.durationMinutes), referencePrice: amount(value.referencePrice) })
    setSending(true)
    setError('')
    try {
      const result = await apiRequest('consultations/commands', {
        action: remove ? 'RetireCatalogueConsultation' : 'PublishCatalogueConsultation',
        id: service?.id, version: service?.version, operationId: crypto.randomUUID(),
        ...(remove ? {} : { catalogueConsultation: { title: title.trim(), description: description.trim(),
          introduction: introduction.trim(), recommendations: recommendations.trim(), paymentMode, inPerson, remote,
          rates: { ...input(base), referencePrice: priced ? amount(base.referencePrice) : null,
            options: options.map((value, index) => ({ id: deliveryOptions[index].id, ...input(value) })) } } }),
      })
      if (!result.id || service && result.id !== service.id) throw new Error('Não foi possível confirmar a alteração.')
      showSuccess(remove ? 'Consulta retirada do catálogo.' : 'Consulta publicada.')
      onClose()
    } catch (failure) { setError(failure.message) }
    finally { setSending(false) }
  }

  return <ManagerSchedulingDialog title={remove ? 'Apagar consulta do catálogo' : service ? 'Editar consulta' : 'Nova consulta'} disabled={disabled} onClose={() => guard(onClose)}>
    {error && <p className="notice error" role="alert">{error}</p>}
    {remove ? <>
      <InformationCard title={title} headingLevel={3}>
        <p>A consulta deixa de estar disponível no Início e para novas marcações. As marcações e o histórico mantêm-se.</p>
      </InformationCard>
      <div className="button-row"><ActionButton variant="secondary" disabled={disabled} onClick={onClose}>Voltar</ActionButton>
        <ActionButton disabled={disabled} onClick={publish}>Confirmar remoção</ActionButton></div>
    </> : review ? <>
      <InformationCard title={title} headingLevel={3}>
        {introduction && <p>{introduction}</p>}<p>{description}</p>{recommendations && <p>{recommendations}</p>}
        <p>{modes[paymentMode]}</p>
        {!service && <p>{[inPerson && 'Presencial', remote && 'Online'].filter(Boolean).join(' e ')}</p>}
        <strong>Valores base</strong>{summary({ priced }, base)}
        {deliveryOptions.map((option, index) => <div key={option.id}><strong>{labelFor(option)}</strong>{summary(option, options[index])}</div>)}
      </InformationCard>
      <div className="button-row"><ActionButton variant="secondary" disabled={disabled} onClick={() => setReview(false)}>Voltar à edição</ActionButton>
        <ActionButton disabled={disabled} onClick={publish}>Publicar</ActionButton></div>
    </> : <form data-protect-draft onSubmit={prepare}>
      <fieldset className={styles.fields} disabled={disabled}>
        <InformationCard title="Apresentação pública" headingLevel={3}>
          <label>Nome da consulta<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label>Frase de apresentação (opcional)<input maxLength={500} value={introduction} onChange={event => setIntroduction(event.target.value)} /></label>
          <label>Descrição<textarea required maxLength={10000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <label>Recomendações (opcional)<textarea maxLength={4000} value={recommendations} onChange={event => setRecommendations(event.target.value)} /></label>
        </InformationCard>
        <InformationCard title="Valores base" headingLevel={3}>
          {service ? <p>{modes[paymentMode]}</p> : <>
            <label>Forma de pagamento<AdaptiveSelect aria-label="Forma de pagamento" required value={paymentMode} onChange={event => setPaymentMode(event.target.value)}>
              <option value="">Escolhe a forma de pagamento</option>{Object.entries(modes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </AdaptiveSelect></label>
            <fieldset><legend>Modalidades</legend>
              <label className="checkbox"><input type="checkbox" checked={inPerson} onChange={event => setInPerson(event.target.checked)} />Presencial nos locais publicados</label>
              <label className="checkbox"><input type="checkbox" checked={remote} onChange={event => setRemote(event.target.checked)} />Online</label>
            </fieldset>
          </>}
          <RateFields rate={{ priced }} value={base} onChange={setBase} />
        </InformationCard>
        {deliveryOptions.map((option, index) => <InformationCard key={option.id} title={labelFor(option)} headingLevel={3}>
          <RateFields rate={option} value={options[index]} inherit onChange={next => setOptions(current => current.map((value, i) => i === index ? next : value))} />
        </InformationCard>)}
        <div className="button-row"><ActionButton variant="secondary" onClick={() => guard(onClose)}>Voltar à gestão</ActionButton>
          <ActionButton type="submit">Rever antes de publicar</ActionButton></div>
      </fieldset>
    </form>}
  </ManagerSchedulingDialog>
}
