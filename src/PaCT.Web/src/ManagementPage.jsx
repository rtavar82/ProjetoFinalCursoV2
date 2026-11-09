import { useCallback, useId, useState } from 'react'
import ActionButton from './ActionButton'
import AdaptiveSelect from './AdaptiveSelect'
import CardGrid from './CardGrid'
import ConsultationDialog from './ConsultationDialog'
import ConsultationCataloguePanel from './ConsultationCataloguePanel'
import GoogleCalendarPanel from './GoogleCalendarPanel'
import Heading from './Heading'
import InformationCard from './InformationCard'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import Pagination from './Pagination'
import SearchInput from './SearchInput'
import SitePresentationPanel from './SitePresentationPanel'
import PrivacyManagementPanel from './PrivacyManagementPanel'
import SecurityOperationsPanel from './SecurityOperationsPanel'
import SummaryCard from './SummaryCard'
import useLiveResource from './useLiveResource'
import useRecoveryState from './useRecoveryState'
import { apiRequest } from './identityApi'
import { showSuccess } from './actionNotices'
import { agendaDate } from './agendaTime'
import formStyles from './ManagerScheduling.module.css'
import { isManager } from './identityRoles'
import styles from './ManagementPage.module.css'

const areas = {
  Supplier: { title: 'Fornecedores', singular: 'fornecedor', create: 'Novo fornecedor', search: 'Nome ou identificação fiscal' },
  ExpenseCategory: { title: 'Categorias', singular: 'categoria', create: 'Nova categoria', search: 'Nome da categoria' },
}
const actions = { Created: 'Criação', Updated: 'Alteração', Reactivated: 'Reativação', Deactivated: 'Desativação', Deleted: 'Eliminação' }
const decisions = { Activate: 'Reativar', Deactivate: 'Desativar', Delete: 'Eliminar' }

export default function ManagementPage({ role, guard, busy }) {
  const [kind, setKind] = useState(() => window.location.hash.split('?')[0] === '#calendario-google' ? 'GoogleCalendar' : 'Supplier')
  const areaLabel = useId()
  const presentation = { Home: 'Página inicial', Therapist: 'Apresentação da terapeuta', Places: 'Locais e moradas',
    Contacts: 'Contactos e redes sociais', Payment: 'Formas de pagamento', WhatsApp: 'Gestão de mensagens' }
  const technical = role === 'TechnicalManager'
  const manager = isManager(role)
  const tabs = [...Object.entries(areas).map(([key, area]) => [key, area.title]), ...Object.entries(presentation), ['Catalogue', 'Catálogo de consultas'], ['GoogleCalendar', 'Google Calendar'],
    ...(technical ? [['Privacy', 'Documentos RGPD']] : []), ...(manager ? [['SecurityOperations', 'Auditoria de segurança']] : [])]
  function openArea(key) { guard(() => setKind(key)) }

  return <section aria-labelledby="application-management-title"><Heading level={1} id="application-management-title">Gestão da aplicação</Heading>
    <label className={styles.areaPicker}><span id={areaLabel}>Área de gestão</span>
      <AdaptiveSelect aria-labelledby={areaLabel} value={kind} disabled={busy} onChange={event => openArea(event.target.value)}>
        {tabs.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
      </AdaptiveSelect>
    </label>
    <nav className={styles.areas} aria-label="Áreas de gestão">{tabs.map(([key, title]) => <ActionButton key={key} variant={kind === key ? 'primary' : 'secondary'} aria-pressed={kind === key} disabled={busy} onClick={() => openArea(key)}>{title}</ActionButton>)}</nav>
    {kind === 'Catalogue' ? <ConsultationCataloguePanel guard={guard} busy={busy} />
      : kind === 'GoogleCalendar' ? <GoogleCalendarPanel guard={guard} busy={busy} />
      : kind === 'Privacy' && technical ? <PrivacyManagementPanel guard={guard} disabled={busy} />
      : kind === 'SecurityOperations' && manager ? <SecurityOperationsPanel guard={guard} disabled={busy} />
      : presentation[kind] ? <SitePresentationPanel key={kind} section={kind} title={presentation[kind]} guard={guard} busy={busy} />
        : <DirectoryPanel key={kind} kind={kind} guard={guard} busy={busy} />}
  </section>
}

function DirectorySummary({ entry }) {
  return <InformationCard cardId="directory-summary" title={entry.name} headingLevel={3}>
    {entry.taxId && <p>NIF / identificação fiscal: <strong>{entry.taxId}</strong></p>}
    <p>{entry.active ? 'Ativo' : 'Desativado'}</p>
    {entry.privateNotes && <><Heading level={4}>Notas privadas da gestão</Heading><p>{entry.privateNotes}</p></>}
  </InformationCard>
}

export function DirectoryPanel({ kind, guard, busy: profileBusy, onSelect, selected }) {
  const area = areas[kind]
  const [filters, setFilters] = useState({ term: '', status: 'Active' }), [term, setTerm] = useState(''), [status, setStatus] = useState('Active')
  const [page, setPage] = useState(1), [detailId, setDetailId] = useState(null), [historyPage, setHistoryPage] = useState(1)
  const [editor, setEditor] = useState(null), [decision, setDecision] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const query = new URLSearchParams({ ...filters, page }).toString()
  const read = useCallback(signal => apiRequest(`management/${kind}?${query}`, undefined, { signal }), [kind, query])
  const list = useLiveResource('management', kind + ':' + query, read)
  const readDetail = useCallback(signal => apiRequest(`management/${kind}/${detailId}?historyPage=${historyPage}`, undefined, { signal }), [kind, detailId, historyPage])
  const detail = useLiveResource('management', kind + ':' + detailId + ':' + historyPage, readDetail, !!detailId)
  const disabled = busy || profileBusy
  async function write(id, input) {
    setError(''); setBusy(true)
    try {
      const result = await apiRequest('management/' + kind + (id ? '/' + id : ''), input)
      if (!result.confirmed) {
        if (result.duplicate && result.entry?.id) return result
        throw new Error('Não foi possível confirmar a alteração. O preenchimento foi mantido.')
      }
      if (!result.entry?.id || id && result.entry.id !== id || !(result.entry.version > (input.version || 0)))
        throw new Error('Não foi possível confirmar o registo devolvido pelo servidor.')
      showSuccess(result.message, `management:${result.entry.id}:${result.entry.version}`)
      return result
    } catch (failure) { setError(failure.message); throw failure }
    finally { setBusy(false) }
  }
  function closeDetail() { if (!disabled) { setDetailId(null); setDecision(null); setError('') } }
  function openDetail(id) { setHistoryPage(1); setDecision(null); setError(''); setDetailId(id) }
  async function confirmDecision() {
    try { await write(decision.entry.id, { action: decision.action, version: decision.entry.version }); closeDetail() }
    catch { /* Error stays beside the confirmation; no false success or navigation. */ }
  }
  return <section aria-label={area.title} data-pending-command={busy || undefined}>
    <InformationCard title={area.title} cardId="management-directory" actions={<ActionButton disabled={disabled || !list.data || !!list.error} onClick={() => guard(() => { setError(''); setEditor({ entry: null }) })}>{area.create}</ActionButton>}>
      <details><summary>Pesquisar {area.title.toLowerCase()}</summary><form onSubmit={event => { event.preventDefault(); setFilters({ term: term.trim(), status }); setPage(1) }}><div className="fields-grid">
        <label>{area.search}<SearchInput value={term} showClear={!!(term || filters.term)} maxLength="200" disabled={disabled} onChange={event => setTerm(event.target.value)} onClear={() => { setTerm(''); setFilters(current => ({ ...current, term: '' })); setPage(1) }} /></label>
        <label>Disponibilidade<AdaptiveSelect value={status} disabled={disabled} onChange={event => setStatus(event.target.value)}><option value="Active">Ativos</option><option value="Inactive">Desativados</option><option value="All">Todos</option></AdaptiveSelect></label>
      </div><ActionButton type="submit" disabled={disabled}>Pesquisar</ActionButton></form></details>
    </InformationCard>
    {(list.loading || list.error) && <InformationCard cardId="management-list-status" loading={list.loading} error={list.error} onRetry={list.refresh} />}
    {list.data && <><SummaryCard cardId="management-count" label={area.title} value={list.data.total} unit="registos" icon="people" />
      <CardGrid>{list.data.items.map(entry => <InformationCard as="article" key={entry.id} title={entry.name} headingLevel={3} cardId={'directory-' + entry.id}>
        {entry.taxId && <p>{entry.taxId}</p>}<p>{entry.active ? 'Ativo' : 'Desativado'}</p>
        {onSelect ? <ActionButton variant="text" disabled={disabled || !entry.active} onClick={() => onSelect(entry)}>{selected?.id === entry.id ? 'Selecionado' : 'Escolher ' + area.singular}</ActionButton>
          : <ActionButton variant="text" disabled={disabled} onClick={() => openDetail(entry.id)}>Ver {area.singular}</ActionButton>}
      </InformationCard>)}</CardGrid>
      {list.data.total === 0 && <InformationCard cardId="management-empty"><p>Não existem registos nesta pesquisa.</p></InformationCard>}
      <Pagination total={list.data.total} page={page} pageSize={list.data.pageSize} correctPage={!list.error} onChange={setPage} disabled={disabled} label={'Páginas de ' + area.title.toLowerCase()} />
    </>}
    {editor && <DirectoryEditor kind={kind} entry={editor.entry} disabled={disabled} guard={guard} write={write} error={error} clearError={() => setError('')} onClose={() => { setEditor(null); setError('') }} />}
    {detailId && <ConsultationDialog title={decision ? decisions[decision.action] + ' ' + area.singular : 'Detalhe de ' + area.singular} label={'Detalhe de ' + area.singular} disabled={disabled} onClose={closeDetail}>
      {error && <p className="notice error" role="alert">{error}</p>}
      <InformationCard cardId="management-detail-status" variant="plain" loading={detail.loading} error={detail.error} onRetry={detail.refresh}>
        {detail.data && (decision ? <><DirectorySummary entry={decision.entry} /><p>{decision.action === 'Delete' ? 'A eliminação só é permitida sem utilizações. O histórico de auditoria mantém-se.' : decision.action === 'Deactivate' ? 'Deixa de estar disponível para novos registos. O histórico mantém-se.' : 'Volta a estar disponível para novos registos.'}</p>
          <div className="button-row"><ActionButton variant="secondary" disabled={disabled} onClick={() => { setDecision(null); setError('') }}>Voltar atrás</ActionButton><ActionButton disabled={disabled} onClick={confirmDecision}>Confirmar {decisions[decision.action].toLowerCase()}</ActionButton></div>
        </> : <><DirectorySummary entry={detail.data.entry} />
          <div className="button-row"><ActionButton disabled={disabled || detail.loading || !!detail.error} onClick={() => { setEditor({ entry: detail.data.entry }); closeDetail() }}>Editar {area.singular}</ActionButton>
            <ActionButton variant="secondary" disabled={disabled || detail.loading || !!detail.error} onClick={() => setDecision({ entry: detail.data.entry, action: detail.data.entry.active ? 'Deactivate' : 'Activate' })}>{detail.data.entry.active ? 'Desativar' : 'Reativar'}</ActionButton>
            <ActionButton variant="text" disabled={disabled || detail.loading || !!detail.error} onClick={() => setDecision({ entry: detail.data.entry, action: 'Delete' })}>Eliminar {area.singular}</ActionButton></div>
          <details><summary>Histórico de alterações</summary>{detail.data.history.map(item => <InformationCard key={item.entry.version} cardId={'directory-revision-' + item.entry.version} title={actions[item.action]} headingLevel={3}>
            <p>{item.entry.name}{item.entry.taxId ? ' · ' + item.entry.taxId : ''}</p>{item.entry.privateNotes && <p>{item.entry.privateNotes}</p>}
            <p>{item.entry.active ? 'Ativo' : 'Desativado'} · Versão {item.entry.version}</p><small>{detail.data.authors?.[item.entry.authorId] || 'Gestão'} · {agendaDate(item.entry.updatedAt)}</small>
          </InformationCard>)}<Pagination total={detail.data.historyTotal} page={historyPage} onChange={setHistoryPage} disabled={disabled} label="Páginas do histórico de alterações" /></details>
        </>)}
      </InformationCard>
    </ConsultationDialog>}
  </section>
}

function DirectoryEditor({ kind, entry, disabled, guard, write, error, clearError, onClose }) {
  const area = areas[kind]
  const notesLabel = useId()
  const [draft, setDraft] = useRecoveryState(`management:${kind}:${entry?.id || 'new'}:${entry?.version || 0}`, () => ({ name: entry?.name || '', taxId: entry?.taxId || '', privateNotes: entry?.privateNotes || '' }))
  const [review, setReview] = useState(null), [duplicate, setDuplicate] = useState(null)
  function close() { if (!disabled) { setDraft({ name: '', taxId: '', privateNotes: '' }); onClose() } }
  function change(values) { setDraft(current => ({ ...current, ...values })); clearError(); setDuplicate(null) }
  async function confirm(id = entry?.id, input = review) {
    try { const result = await write(id, input); if (result.duplicate) setDuplicate(result); else close() }
    catch { /* Preserve form and review on rejection or uncertain connection. */ }
  }
  return <ManagerSchedulingDialog title={review ? 'Rever ' + area.singular : entry ? 'Editar ' + area.singular : area.create} label={'Editor de ' + area.singular} disabled={disabled} onClose={() => guard(close)}>
    {error && <p className="notice error" role="alert">{error}</p>}
    {duplicate && <InformationCard title={duplicate.message} cardId="management-duplicate"><DirectorySummary entry={duplicate.entry} />
      {!duplicate.entry.active && <ActionButton disabled={disabled} onClick={() => confirm(duplicate.entry.id, { action: 'Activate', version: duplicate.entry.version })}>Confirmar reativação do registo existente</ActionButton>}
    </InformationCard>}
    {review ? <><DirectorySummary entry={{ ...review, active: entry?.active ?? true }} /><div className="button-row"><ActionButton variant="secondary" disabled={disabled} onClick={() => { setReview(null); setDuplicate(null); clearError() }}>Voltar atrás</ActionButton><ActionButton disabled={disabled || !!duplicate} onClick={() => confirm()}>Confirmar e guardar</ActionButton></div></>
      : <form data-protect-draft onSubmit={event => { event.preventDefault(); clearError(); setDuplicate(null); setReview({ action: 'Save', version: entry?.version || 0, name: draft.name.trim(), ...(kind === 'Supplier' ? { taxId: draft.taxId.trim(), privateNotes: draft.privateNotes.trim() || null } : {}) }) }}>
        <fieldset className={formStyles.fields} disabled={disabled}><label>{kind === 'Supplier' ? 'Nome ou designação' : 'Nome da categoria'}<input required maxLength="200" value={draft.name} onChange={event => change({ name: event.target.value })} /></label>
          {kind === 'Supplier' && <><label>NIF / identificação fiscal<input required minLength="2" maxLength="64" value={draft.taxId} onChange={event => change({ taxId: event.target.value })} /></label><label><span id={notesLabel}>Notas privadas da gestão (opcional)</span><textarea aria-labelledby={notesLabel} maxLength="2000" rows="5" value={draft.privateNotes} onChange={event => change({ privateNotes: event.target.value })} /></label></>}
          <div className="button-row"><ActionButton variant="secondary" onClick={() => guard(close)}>Voltar à lista</ActionButton><ActionButton type="submit">Rever antes de confirmar</ActionButton></div>
        </fieldset>
      </form>}
  </ManagerSchedulingDialog>
}
