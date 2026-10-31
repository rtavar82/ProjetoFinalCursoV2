import AdaptiveSelect from './AdaptiveSelect'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import ClientProfileForm from './ClientProfileForm'
import ClientComparison from './ClientComparison'
import ClientDataSummary from './ClientDataSummary'
import ClientAccessSettings from './ClientAccessSettings'
import styles from './Clients.module.css'
import useLiveResource from './useLiveResource'
import InformationCard from './InformationCard'
import CardGrid from './CardGrid'
import SummaryCard from './SummaryCard'
import { observeResource } from './liveUpdates'

function nameOf(client) { return [client.data.firstName, client.data.lastName].filter(Boolean).join(' ') || 'Nome ainda não indicado' }
function dateOf(value) { return new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value.endsWith('Z') ? value : value + 'Z')) }
function Pager({ data, change }) { const pages = Math.ceil(data.total / 8); return pages > 1 && <nav className="pager" aria-label="Paginação"><button className="secondary" disabled={data.page <= 1} onClick={() => change(data.page - 1)}>Anterior</button><span>Página {data.page} de {pages}</span><button className="secondary" disabled={data.page >= pages} onClick={() => change(data.page + 1)}>Seguinte</button></nav> }

export default function Clients({ busy, perform, notify, guard, initialView = 'Directory', initialId = null, pendingReviewCount }) {
  const [view, setView] = useState(initialId ? 'Detail' : initialView)
  const [editedClient, setClient] = useState(null)
  const dirty = useRef(false)
  const openedId = editedClient?.id
  useEffect(() => {
    if (view !== 'Detail' || !openedId) return
    let current = true
    const stop = observeResource('clients', async () => {
      try { const value = await apiRequest('clients/' + openedId); if (current && !dirty.current) setClient(value) }
      catch { /* The shared read warning reports connection failures; keep the open form. */ }
    })
    return () => { current = false; stop() }
  }, [view, openedId])
  const readInitial = useCallback(signal => apiRequest('clients/' + initialId, undefined, { signal }), [initialId])
  const initial = useLiveResource('clients', 'client-entry:' + initialId, readInitial, !!initialId && view === 'Detail' && !editedClient)
  const client = editedClient || (view === 'Detail' ? initial.data : null)
  const [query, setQuery] = useState({ field: 'Name', term: '', page: 1 })
  const read = useCallback(signal => apiRequest('clients?' + new URLSearchParams(query), undefined, { signal }), [query])
  const directory = useLiveResource('clients', JSON.stringify(query), read, view === 'Directory')
  const result = directory.data
  const failure = directory.error
  function search(event) { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); setQuery({ ...values, page: 1 }) }
  function open(id) { perform(async () => { const data = await apiRequest('clients/' + id); dirty.current = false; setClient(data); setView('Detail') }) }
  function save(input) { perform(async () => {
    const saved = await apiRequest(client ? 'clients/' + client.id : 'clients', input)
    notify(saved.message, !saved.saved)
    if (saved.saved) { dirty.current = false; setClient(saved.client); setView('Detail') }
  }) }
  return <section className={styles.page} aria-labelledby="clients-title" onChangeCapture={event => { if (event.target.closest('form.client-form') && !dirty.current) { dirty.current = true; if (client) setClient(client) } }}>
    <div className="section-heading"><div><h1 id="clients-title">Clientes</h1><p>Pesquisa uma ficha para consultar os dados e o acompanhamento do cliente.</p></div></div>
    <nav className="section-tabs" aria-label="Área Clientes">
      <button disabled={busy} aria-pressed={view === 'Directory'} className={view === 'Directory' ? '' : 'secondary'} onClick={() => { if (view !== 'Directory') guard(() => { setView('Directory'); setClient(null) }) }}>Pesquisar clientes</button>
      <button disabled={busy} className={view === 'Create' ? '' : 'secondary'} aria-pressed={view === 'Create'} onClick={() => { if (view !== 'Create') guard(() => { setClient(null); setView('Create') }) }}>Criar ficha</button>
      <button disabled={busy} className={view === 'Reviews' ? '' : 'secondary'} aria-pressed={view === 'Reviews'} onClick={() => { if (view !== 'Reviews') guard(() => setView('Reviews')) }}>Ocorrências para rever{pendingReviewCount > 0 ? ` (${pendingReviewCount})` : ''}</button>
    </nav>
    {view === 'Directory' && <>
      <InformationCard className="search-panel" title="Pesquisar clientes" cardId="client-search"><p>Pesquisa por nome, email ou telefone. São usadas as fichas existentes, incluindo clientes sem conta registada.</p>
        <form onSubmit={search} data-allow-update><div className="fields-grid"><label>Pesquisar por<AdaptiveSelect name="field" defaultValue="Name"><option value="Name">Nome</option><option value="Email">Email</option><option value="Phone">Telefone</option></AdaptiveSelect></label><label>Pesquisa de clientes<input name="term" maxLength="256" placeholder="Por nome: pelo menos três caracteres" /></label></div>
          <div className="button-row"><button disabled={busy}>Pesquisar</button><button type="button" className="secondary" onClick={() => { setQuery({ field: 'Name', term: '', page: 1 }) }}>Ver todas as fichas</button></div>
        </form><p className="field-help">Email: endereço completo. Telefone: algarismos do número, com ou sem indicativo.</p>
      </InformationCard>
      {failure && <div className="notice error" role="alert">{failure}<button className="secondary" onClick={directory.refresh}>Voltar a tentar</button></div>}
      {!result && !failure && <p role="status">A carregar fichas…</p>}
      {result && <><SummaryCard cardId="client-count" label={result.total === 1 ? 'Ficha encontrada' : 'Fichas encontradas'} value={result.total} unit="registos" icon="people" />{result.total === 0 && <p>Ainda não existem fichas correspondentes. Podes criar uma ficha com dados novos.</p>}
        <CardGrid>{result.items.map(row => <InformationCard as="article" cardId={'client-' + row.id} key={row.id}><div><h3>{nameOf(row)}</h3><p>{row.data.locality || 'Localidade não indicada'}</p>{row.data.email && <p>{row.data.email}</p>}{row.data.phone && <p>+{row.data.dialCode} {row.data.phone}</p>}<span className="client-badge">{row.hasAccount ? 'Com conta · ' + accountState(row.accountState) : 'Ficha sem conta'}</span>{row.identityReviewStatus === 'Pending' && <p>Identidade por verificar</p>}</div><button className="secondary" disabled={busy} onClick={() => open(row.id)}>Abrir ficha</button></InformationCard>)}</CardGrid>
        <Pager data={result} change={page => { setQuery(current => ({ ...current, page })) }} />
      </>}
    </>}
    {view === 'Create' && <InformationCard title="Criar ficha de cliente" cardId="client-create"><ClientProfileForm key="new" manual busy={busy} onSave={save} /></InformationCard>}
    {view === 'Detail' && !client && <InformationCard loading={initial.loading} error={initial.error} onRetry={initial.refresh} cardId="client-entry" />}
    {view === 'Detail' && client && <InformationCard title={nameOf(client)} cardId="client-editor"><p className="client-badge">{client.hasAccount ? 'Com conta · ' + accountState(client.accountState) : 'Ficha de gestão sem conta de acesso'}</p><ClientProfileForm key={client.id + ':' + client.version} client={client} busy={busy} onSave={save} />{client.hasAccount && client.accountState === 'Active' && <ClientAccessSettings key={client.id} client={client} busy={busy} perform={perform} notify={notify} />}</InformationCard>}
    {view === 'Reviews' && <Reviews busy={busy} perform={perform} notify={notify} onChange={directory.refresh} />}
  </section>
}

function accountState(state) { return ({ Active: 'Acesso ativo', ConfirmEmail: 'Email por confirmar', SetPassword: 'Palavra-passe por definir', Closed: 'Conta encerrada' })[state] || state }

function Reviews({ busy, perform, notify, onChange }) {
  const [reviews, setReviews] = useState(null)
  const [page, setPage] = useState(1)
  useEffect(() => { let current = true; async function load() { try { const data = await apiRequest('clients/reviews'); if (current) setReviews({ items: data }) } catch (error) { if (current) setReviews(previous => ({ ...previous, error: error.message })) } } const stop = observeResource('clientReviews', load); return () => { current = false; stop() } }, [])
  function decide(review, decision) { perform(async () => {
    const result = await apiRequest('clients/reviews/' + review.id, { version: review.version, ...decision })
    notify(result.message); setReviews({ items: await apiRequest('clients/reviews') }); setPage(1); onChange()
  }) }
  return <section className="record-panel"><h2>Ocorrências para rever</h2><p>Uma coincidência não prova que sejam a mesma pessoa. A proposta ainda não substituiu os dados atuais.</p>
    {!reviews && <p role="status">A carregar ocorrências…</p>}{reviews?.error && <p role="alert" className="notice error">{reviews.error}</p>}
    {reviews?.items?.length === 0 && <p>Não existem ocorrências por resolver.</p>}
    {reviews?.items?.slice((page - 1) * 8, page * 8).map(review => <ReviewCard key={review.id} review={review} busy={busy} onDecide={decision => decide(review, decision)} />)}
    {reviews?.items && <Pager data={{ total: reviews.items.length, page }} change={setPage} />}
  </section>
}

const fieldLabels = { FirstName: 'Nome', LastName: 'Apelido', Locality: 'Localidade', BirthDate: 'Nascimento', Gender: 'Género', Email: 'Email', Phone: 'Telefone e indicativo', Address: 'Morada', PostalCode: 'Código postal', ChildrenCount: 'Número de filhos', RelationshipStatus: 'Estado civil', DisplayName: 'Nome público' }
function ReviewCard({ review, busy, onDecide }) {
  const [candidateId, setCandidateId] = useState('')
  const [comparisonId, setComparisonId] = useState(null)
  const [primaryChoice, setPrimaryChoice] = useState('')
  const candidate = review.candidates.find(row => row.id === candidateId)
  const primary = primaryChoice === 'Existing' ? candidate : primaryChoice === 'Current' ? review.source : null
  const donor = primaryChoice === 'Current' ? candidate?.data : review.source?.data ?? review.proposal
  const destinationLabel = primaryChoice === 'Existing' ? 'perfil existente selecionado' : 'perfil atual do pedido'
  const originLabel = primaryChoice === 'Current' ? 'perfil existente selecionado' : review.source ? 'perfil atual do pedido' : 'dados recebidos no pedido'
  const retainedAccess = primary?.hasAccount ? primary : primaryChoice === 'Existing' ? review.source : candidate
  function accept(event) { event.preventDefault(); const fields = new FormData(event.currentTarget).getAll('selectedFields'); onDecide({ accept: true, candidateId, candidateVersion: candidate.version, sourceVersion: review.source?.version, selectedFields: fields, primaryPersonId: primaryChoice === 'Existing' ? candidateId : review.source.id }) }
  return <article className="review-card"><h3>{review.origin === 'GuestRequest' ? 'Pedido de visitante com contactos coincidentes' : ({ Registration: 'Novo registo', Manual: 'Nova ficha manual', Edit: 'Alteração da ficha' })[review.kind]}</h3><p>Recebida em {dateOf(review.createdAt)}</p>
    <h4>Dados recebidos no pedido</h4><ClientDataSummary data={review.proposal} showEmpty={false} />
    {review.source && <p>Ficha atual: {nameOf(review.source)} · {review.source.data.email || review.source.data.phone}</p>}
    {review.needsConsolidation && <p className="notice" role="status">A identidade já foi aprovada, mas as duas fichas ficaram ativas. Conclui a consolidação escolhendo a ficha principal e os dados finais.</p>}
    {review.kind === 'Registration' && review.source?.hasAccount && <p>Confirmar a mesma pessoa consolida os perfis numa única ficha ativa. Se apenas uma ficha tiver conta de acesso, essa conta será ligada à ficha principal.</p>}
    {review.source && <button type="button" className="text-button" onClick={() => setComparisonId(review.source.id)}>Ver ficha atual para comparar</button>}
    {review.candidates.length > 0 && <div className="comparison-links"><h4>Fichas com dados coincidentes</h4>{review.candidates.map(row => <button key={row.id} type="button" className="text-button" onClick={() => setComparisonId(row.id)}>Ver ficha de {nameOf(row)} para comparar</button>)}</div>}
    {comparisonId && <ClientComparison personId={comparisonId} onClose={() => setComparisonId(null)} />}
    <form onSubmit={accept} data-protect-draft><label>Ficha a associar após verificar a identidade<AdaptiveSelect aria-label="Ficha a associar após verificar a identidade" value={candidateId} onChange={event => { setCandidateId(event.target.value); setPrimaryChoice('') }} required><option value="">Seleciona depois de comparar as fichas</option>{review.candidates.map(row => <option value={row.id} key={row.id}>{nameOf(row)} · {row.data.email || row.data.phone}</option>)}</AdaptiveSelect></label>
      {candidate && <label>Qual perfil deve ficar ativo?<AdaptiveSelect aria-label="Ficha principal a manter" value={primaryChoice} onChange={event => setPrimaryChoice(event.target.value)} required><option value="">Escolhe o perfil que vai permanecer</option><option value="Existing">Perfil existente selecionado · {nameOf(candidate)}</option>{review.source && <option value="Current">Perfil atual do pedido · {nameOf(review.source)}</option>}</AdaptiveSelect></label>}
      {candidate && primary && <div key={`${candidateId}:${primaryChoice}`}><p><strong>Fica ativo: {destinationLabel} — {nameOf(primary)}.</strong> Conserva o seu identificador e a data de criação.{review.source && <> O {originLabel} será desativado, mesmo que não copies nenhum campo.</>}</p><p>Cópia opcional: do {originLabel} para o {destinationLabel}. Se não selecionares nenhum campo, todos os dados do perfil que fica ativo são mantidos.</p><fieldset><legend>Campos a copiar para o perfil que fica ativo (opcional)</legend>{Object.entries(fieldLabels).filter(([key]) => key !== 'DisplayName' || review.kind !== 'Manual').map(([key, label]) => <label className="checkbox" key={key}><input name="selectedFields" value={key} type="checkbox" />{label}: {String(donor[key[0].toLowerCase() + key.slice(1)] ?? 'Não indicado')}</label>)}</fieldset>
        <p className="field-help">As marcações, consultas, packs, movimentos e histórico das duas fichas ficam reunidos na ficha escolhida, sem duplicar registos. As notas privadas continuam apenas na gestão. A outra ficha deixa de estar ativa. O email final deve corresponder à conta de acesso mantida.</p>{retainedAccess?.hasAccount && <p>Acesso a manter: <strong>{retainedAccess.data.email}</strong>.</p>}{review.source?.hasAccount && candidate.hasAccount && <p className="notice">As duas fichas têm acesso. Será mantido o acesso da ficha principal; o outro será encerrado e as suas sessões deixarão de ser válidas. As palavras-passe e os autenticadores não são misturados.</p>}<label className="checkbox"><input type="checkbox" required />Verifiquei que se trata da mesma pessoa e confirmo a ficha principal e os dados finais.</label><button disabled={busy}>Confirmar identidade e consolidar perfis</button></div>}
      {review.candidates.length === 0 && <p>O identificador já pertence a uma conta de acesso que não pode ser unida neste painel. Não é possível criar outra conta com esse email.</p>}
      {!review.needsConsolidation && <button type="button" className="secondary" disabled={busy} onClick={() => onDecide({ accept: false })}>{review.kind === 'Registration' && review.source?.hasAccount ? 'Manter fichas separadas' : 'Rejeitar proposta e preservar dados atuais'}</button>}
    </form>
  </article>
}
