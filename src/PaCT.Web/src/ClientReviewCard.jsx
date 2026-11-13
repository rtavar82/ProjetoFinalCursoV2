import { useId, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import ClientDataSummary from './ClientDataSummary'
import DisclosureSummary from './DisclosureSummary'
import Heading from './Heading'
import InformationCard from './InformationCard'
import styles from './ClientReviewCard.module.css'

const fields = { FirstName: 'Nome', LastName: 'Apelido', Locality: 'Localidade', BirthDate: 'Nascimento', Gender: 'Género', Email: 'Email', Phone: 'Telefone e indicativo', Address: 'Morada', PostalCode: 'Código postal', ChildrenCount: 'Número de filhos', RelationshipStatus: 'Estado civil', DisplayName: 'Nome nas Partilhas' }
const keyOf = field => field[0].toLowerCase() + field.slice(1)
const nameOf = client => [client?.data.firstName, client?.data.lastName].filter(Boolean).join(' ') || 'Nome não indicado'
const reference = client => client.id.slice(-8)
function raw(data, field) { return field === 'Phone' ? [data?.dialCode ?? '', data?.phone ?? ''].join(':') : String(data?.[keyOf(field)] ?? '') }
function display(data, field) {
  const value = data?.[keyOf(field)]
  if (value == null || value === '') return 'Não indicado'
  if (field === 'Phone') return [data.dialCode ? '+' + data.dialCode : '', value].filter(Boolean).join(' ')
  if (field === 'BirthDate') return String(value).split('T')[0].split('-').reverse().join('/')
  if (field === 'Gender') return ({ Female: 'Feminino', Male: 'Masculino' })[value] || value
  if (field === 'RelationshipStatus') return ({ Married: 'Casada', Separated: 'Separada', Partnered: 'Comprometida', Unpartnered: 'Sem compromisso', Widowed: 'Viúva' })[value] || value
  return String(value)
}
function FieldChoice({ field, label, primary, donor, donorLabel, selected, onChange, group }) {
  return <fieldset className={styles.field} data-review-field={field}>
    <legend>{label}</legend>
    <div className={styles.options}>
      <label className={'checkbox ' + styles.option}><input type="radio" name={`${group}-${field}`} value="keep" checked={!selected} onChange={() => onChange(false)} /><span><span className={styles.caption}>Manter na ficha principal</span><strong>{display(primary.data, field)}</strong></span></label>
      <label className={'checkbox ' + styles.option}><input type="radio" name={`${group}-${field}`} value="copy" checked={selected} onChange={() => onChange(true)} /><span><span className={styles.caption}>Usar da {donorLabel}</span><strong>{display(donor, field)}</strong></span></label>
    </div>
    <p className={styles.result} aria-live="polite">Fica guardado: <strong>{display(selected ? donor : primary.data, field)}</strong></p>
  </fieldset>
}

export default function ClientReviewCard({ review, busy, onDecide }) {
  const group = useId()
  const candidates = review.candidates.filter(row => row.id !== review.source?.id)
  const [candidateId, setCandidateId] = useState(candidates.length === 1 ? candidates[0].id : '')
  const [primaryChoice, setPrimaryChoice] = useState('')
  const [selectedFields, setSelectedFields] = useState([])
  const [confirmed, setConfirmed] = useState(false)
  const candidate = candidates.find(row => row.id === candidateId)
  const choice = review.source ? primaryChoice : candidate ? 'Existing' : ''
  const primary = choice === 'Existing' ? candidate : choice === 'Current' ? review.source : null
  const donor = choice === 'Current' ? candidate?.data : review.source?.data ?? review.proposal
  const donorLabel = choice === 'Current' ? 'ficha existente' : review.source ? 'ficha do pedido' : 'proposta recebida'
  const retainedAccess = primary?.hasAccount ? primary : choice === 'Existing' ? review.source : candidate
  const availableFields = Object.keys(fields).filter(field => field !== 'DisplayName' || review.kind !== 'Manual')
  const different = primary ? availableFields.filter(field => raw(primary.data, field) !== raw(donor, field)) : []
  const equal = availableFields.filter(field => !different.includes(field))
  const proposalDiffers = review.source && availableFields.some(field => raw(review.source.data, field) !== raw(review.proposal, field))
  const title = review.origin === 'GuestRequest' ? 'Pedido de visitante com contactos coincidentes' : ({ Registration: 'Novo registo', Manual: 'Nova ficha manual', Edit: 'Alteração da ficha' })[review.kind] || 'Coincidência de dados'
  function reset() { setPrimaryChoice(''); setSelectedFields([]); setConfirmed(false) }
  function selectField(field, selected) { setSelectedFields(current => selected ? [...current.filter(value => value !== field), field] : current.filter(value => value !== field)); setConfirmed(false) }
  function accept(event) {
    event.preventDefault()
    if (!candidate || !primary || !confirmed || busy) return
    onDecide({ accept: true, candidateId, candidateVersion: candidate.version, sourceVersion: review.source?.version, selectedFields, primaryPersonId: primary.id })
  }
  return <InformationCard as="article" title={title} headingLevel={3} cardId={'client-review-' + review.id} className={styles.card}>
    <p className={styles.caption}>Recebida em {new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short' }).format(new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(review.createdAt) ? review.createdAt : review.createdAt + 'Z'))}</p>
    <Heading level={4}>{[review.proposal.firstName, review.proposal.lastName].filter(Boolean).join(' ') || 'Pedido sem nome'}</Heading>
    {review.needsConsolidation && <p className="notice" role="status">A identidade já foi aprovada. Falta reunir as fichas e escolher os dados finais.</p>}
    <form onSubmit={accept} data-protect-draft className={styles.form}>
      <fieldset disabled={busy} className={styles.controls}>
        {candidates.length > 1 ? <label>Ficha existente para comparar<AdaptiveSelect aria-label="Ficha existente para comparar" value={candidateId} onChange={event => { setCandidateId(event.target.value); reset() }} required>
          <option value="">Escolhe uma ficha</option>{candidates.map(row => <option value={row.id} key={row.id}>{nameOf(row)} · {row.data.email || row.data.phone || 'Sem contacto'} · ref. {reference(row)}</option>)}
        </AdaptiveSelect></label> : candidate && <p><strong>Ficha existente:</strong> {nameOf(candidate)} · {candidate.data.email || candidate.data.phone || 'Sem contacto'} · ref. {reference(candidate)}</p>}
        {!candidate && <details open={candidates.length === 0}><DisclosureSummary>Dados recebidos no pedido</DisclosureSummary><ClientDataSummary data={review.proposal} showEmpty={false} /></details>}
        {candidates.length === 0 && <p className="notice">Não existe uma ficha elegível para unir neste painel. Um email de uma conta existente não pode ser usado para criar outra conta.</p>}
        {candidate && <>
          {review.source ? <fieldset className={styles.block}><legend>Ficha que fica ativa</legend><p className={styles.caption}>A ficha escolhida conserva a referência e a data de criação. Escolher a ficha não confirma a união.</p>
            <div className={styles.options}>{[{ value: 'Existing', label: 'Ficha existente', client: candidate }, { value: 'Current', label: 'Ficha do pedido', client: review.source }].map(option => <label className={'checkbox ' + styles.option} key={option.value}>
              <input type="radio" name={group + '-primary'} value={option.value} required checked={primaryChoice === option.value} onChange={() => { setPrimaryChoice(option.value); setSelectedFields([]); setConfirmed(false) }} />
              <span><strong>{option.label} · {nameOf(option.client)}</strong><span className={styles.caption}>Ref. {reference(option.client)} · {option.client.hasAccount ? 'Com conta de acesso' : 'Sem conta de acesso'}</span></span>
            </label>)}</div></fieldset> : <p>A proposta será associada à ficha existente. Os dados só serão alterados depois de confirmares.</p>}
          {!primary && <div className={styles.block}><Heading level={4}>Comparar as fichas</Heading><div className={styles.options}>
            <div><Heading level={5}>Ficha existente</Heading><ClientDataSummary data={candidate.data} hasAccount={candidate.hasAccount} /></div>
            <div><Heading level={5}>Ficha do pedido</Heading><ClientDataSummary data={review.source.data} hasAccount={review.source.hasAccount} /></div>
          </div></div>}
        </>}
        {primary && <>
          <section className={styles.block} aria-label="Escolher os dados finais"><Heading level={4}>Dados diferentes</Heading>
            <p className={styles.caption}>Escolhe o valor final em cada campo. Por defeito, mantêm-se os dados da ficha principal.</p>
            {different.length ? different.map(field => <FieldChoice key={`${primary.id}:${candidateId}:${field}`} field={field} label={fields[field]} primary={primary} donor={donor} donorLabel={donorLabel} selected={selectedFields.includes(field)} onChange={selected => selectField(field, selected)} group={group} />) : <p>Os dados das duas fichas são iguais. Não há campos para substituir.</p>}
            {equal.length > 0 && <details><DisclosureSummary>Ver dados iguais ou não indicados · {equal.length} campos</DisclosureSummary><dl className={styles.same}>{equal.map(field => <div key={field}><dt>{fields[field]}</dt><dd>{display(primary.data, field)}</dd></div>)}</dl></details>}
          </section>
          <section className={styles.block} aria-label="Resultado da união"><Heading level={4}>Resultado da união</Heading>
            <p><strong>Fica ativa:</strong> {nameOf(primary)} · ref. {reference(primary)}.</p>
            <p>{review.source ? 'As marcações, consultas, packs, movimentos e histórico das duas fichas ficam reunidos. A outra ficha deixa de estar ativa.' : 'A proposta fica associada à ficha existente.'} As notas privadas continuam apenas na gestão.</p>
            <p><strong>Acesso a manter:</strong> {retainedAccess?.hasAccount ? retainedAccess.data.email : 'Sem conta de acesso.'}</p>
            {retainedAccess?.hasAccount && <p className={styles.caption}>O email final tem de corresponder à conta de acesso mantida. Alterar o email exige confirmação pelo titular.</p>}
            {review.source?.hasAccount && candidate.hasAccount && <p className="notice">As duas fichas têm acesso. Será mantido o acesso da ficha principal; o outro será encerrado e as suas sessões deixarão de ser válidas. As palavras-passe e os autenticadores não são misturados.</p>}
          </section>
          <label className="checkbox"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Verifiquei que se trata da mesma pessoa e confirmo a ficha principal e os dados finais.</label>
        </>}
        {proposalDiffers && <details><DisclosureSummary>Ver proposta original recebida</DisclosureSummary><p className={styles.caption}>A proposta difere dos dados atuais da ficha do pedido. A comparação acima usa os dados atuais, tal como na consolidação existente.</p><ClientDataSummary data={review.proposal} showEmpty={false} /></details>}
        <div className={styles.actions}>
          {!review.needsConsolidation && <ActionButton variant="secondary" disabled={busy} onClick={() => onDecide({ accept: false })}>{review.kind === 'Registration' && review.source?.hasAccount ? 'Manter fichas separadas' : 'Rejeitar proposta e preservar dados atuais'}</ActionButton>}
          {primary && <ActionButton type="submit" disabled={busy || !confirmed}>Confirmar união</ActionButton>}
        </div>
      </fieldset>
    </form>
  </InformationCard>
}
