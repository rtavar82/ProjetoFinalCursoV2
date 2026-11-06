import { useCallback, useState } from 'react'
import ActionButton from './ActionButton'
import InformationCard from './InformationCard'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import Pagination from './Pagination'
import PrivacyPolicy, { privacyTitle } from './PrivacyPolicy'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import { showSuccess } from './actionNotices'
import { agendaDate } from './agendaTime'

export default function PrivacyManagementPanel({ guard, disabled }) {
  const [page, setPage] = useState(1)
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const read = useCallback(signal => apiRequest('privacy/editor?page=' + page, undefined, { signal }), [page])
  const editor = useLiveResource('privacy', 'editor:' + page, read)
  const version = dialog?.mode === 'history' ? dialog.version : null
  const readVersion = useCallback(signal => apiRequest('privacy/editor/versions/' + version, undefined, { signal }), [version])
  const history = useLiveResource('privacy', 'version:' + version, readVersion, !!version)
  const data = editor.data
  const unavailable = disabled || busy || !!editor.error || editor.loading || editor.refreshing
  const pendingSections = dialog?.pendingSections ?? []
  const canPublishTest = data?.canPublishTest === true

  function open(mode, extra = {}) {
    setError('')
    setDialog({ mode, content: data.draft, revision: data.revision, pendingSections: data.pendingSections, ...extra })
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || (dialog.mode === 'publish' && pendingSections.length > 0 && !canPublishTest)) return
    setError('')
    setBusy(true)
    try {
      if (dialog.mode === 'edit') {
        const result = await apiRequest('privacy/editor/draft', { revision: dialog.revision, content: dialog.content })
        if (!Number.isInteger(result.revision) || result.revision < dialog.revision) throw new Error('O servidor não confirmou o rascunho.')
        showSuccess('Rascunho guardado.')
      } else {
        const result = await apiRequest('privacy/editor/publish', { revision: dialog.revision })
        if (!(result.version > 0)) throw new Error('O servidor não confirmou a publicação.')
        setPage(1)
        showSuccess(result.testOnly ? 'Versão de teste ' + result.version + ' publicada.' : 'Versão ' + result.version + ' publicada.')
      }
      setDialog(null)
    } catch (failure) {
      setError(failure.message)
      if (failure.status === 409) editor.refresh()
    } finally { setBusy(false) }
  }

  function change(key, value) {
    setDialog(current => ({ ...current, content: { ...current.content, [key]: value } }))
  }

  return <section aria-label="Documentos RGPD" data-pending-command={busy || undefined}>
    <InformationCard title={privacyTitle} cardId="privacy-editor" loading={editor.loading} error={editor.error} onRetry={editor.refresh}>
      {data && <>
        <p>{data.publishedVersion ? (data.publishedTestOnly ? 'Versão de teste publicada: ' : 'Versão publicada: ') + data.publishedVersion : 'Ainda não existe uma versão publicada.'}</p>
        <p>{data.updatedAt ? 'Última edição do rascunho: ' + agendaDate(data.updatedAt) : 'O modelo está pronto para completar.'}</p>
        <div className="button-row">
          <ActionButton disabled={unavailable} onClick={() => open('edit')}>Editar rascunho</ActionButton>
          <ActionButton variant="secondary" disabled={unavailable || (!data.updatedAt && !canPublishTest)} onClick={() => open('publish')}>Rever para publicar</ActionButton>
        </div>
      </>}
    </InformationCard>
    {data?.history.length > 0 && <InformationCard title="Histórico de publicações" cardId="privacy-history">
      {data.history.map(item => <p key={item.version}><ActionButton variant="text" disabled={unavailable} onClick={() => open('history', item)}>
        {item.testOnly ? 'Versão de teste' : 'Versão'} {item.version}</ActionButton> · {agendaDate(item.publishedAt)}</p>)}
      <Pagination page={page} total={data.total} onChange={setPage} disabled={unavailable} label="Páginas do histórico" />
    </InformationCard>}
    {dialog && <ManagerSchedulingDialog title={dialog.mode === 'edit' ? 'Editar rascunho' : privacyTitle} disabled={busy}
      onClose={() => dialog.mode === 'edit' ? guard(() => setDialog(null)) : setDialog(null)}>
      {error && <p className="notice error" role="alert">{error}</p>}
      {dialog.mode === 'edit' && <form data-protect-draft onSubmit={submit}>
        <label>Nome ou designação do responsável<input required maxLength={200} value={dialog.content.controllerName} onChange={event => change('controllerName', event.target.value)} disabled={busy} /></label>
        <label>Email de privacidade<input required type="email" maxLength={256} value={dialog.content.contactEmail} onChange={event => change('contactEmail', event.target.value)} disabled={busy} /></label>
        <label>Resumo do aviso<textarea required maxLength={450} value={dialog.content.summary} onChange={event => change('summary', event.target.value)} disabled={busy} /></label>
        <label>Aviso de notificações opcionais<textarea required maxLength={450} value={dialog.content.pushNotice} onChange={event => change('pushNotice', event.target.value)} disabled={busy} /></label>
        <label>Texto da política<textarea required maxLength={18000} rows={14} value={dialog.content.text} onChange={event => change('text', event.target.value)} disabled={busy} /></label>
        <p className="field-help">Começa uma linha com «# » para criar um título.</p>
        <ActionButton type="submit" disabled={busy}>Guardar rascunho</ActionButton>
      </form>}
      {dialog.mode === 'publish' && <form onSubmit={submit}>
        {pendingSections.length > 0 && <div className="notice">
          <strong>O rascunho ainda tem secções por completar</strong>
          <p>{canPublishTest ? 'Podes publicar o texto atual para testar o percurso na aplicação.' : 'Substitui as indicações do modelo pelas informações desta instalação.'}</p>
          <ul>{pendingSections.map(section => <li key={section}>{section}</li>)}</ul>
          <ActionButton variant="secondary" onClick={() => setDialog(current => ({ ...current, mode: 'edit' }))}>Voltar à edição</ActionButton>
        </div>}
        <InformationCard title="Resumo do aviso" cardId="privacy-summary-preview"><p>{dialog.content.summary}</p></InformationCard>
        <InformationCard title="Aviso de notificações opcionais" cardId="privacy-push-preview"><p>{dialog.content.pushNotice}</p></InformationCard>
        <PrivacyPolicy content={dialog.content} />
        {(canPublishTest || pendingSections.length === 0) && <>
          <p>{canPublishTest
            ? 'A versão de teste fica visível a clientes e visitantes no ambiente de desenvolvimento.'
            : 'Publicar torna esta versão visível. Os clientes e visitantes voltam a ver o aviso da política.'}</p>
          <ActionButton type="submit" disabled={busy}>{canPublishTest ? 'Publicar versão de teste' : 'Publicar nova versão'}</ActionButton>
        </>}
      </form>}
      {dialog.mode === 'history' && <InformationCard cardId="privacy-historical-version" loading={history.loading} error={history.error} onRetry={history.refresh}>
        <p>{dialog.testOnly ? 'Versão de teste' : 'Versão'} {version} · {agendaDate(dialog.publishedAt)}</p>
        <p>Publicado pela conta {dialog.authorId}</p>
        {history.data && <PrivacyPolicy content={history.data.content} />}
        {history.data && <p>Notificações opcionais · {history.data.content.pushNotice}</p>}
      </InformationCard>}
    </ManagerSchedulingDialog>}
  </section>
}
