import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import useLiveResource from './useLiveResource'
import useClosureDraft from './useClosureDraft'
import { uploadConsultationPhoto } from './identityApi'
import styles from './ClosureForm.module.css'

const fieldLabels = { outcome: 'Resultado', method: 'Tratamento financeiro', start: 'Início efetivo', end: 'Fim efetivo', amount: 'Valor final', shared: 'Nota partilhada', private: 'Nota privada', availability: 'Disponibilidade após cancelamento' }
const choiceLabels = { Performed: 'Realizada', NoShow: 'Não compareceu', CancelledManager: 'Cancelada pela terapeuta', Unpaid: 'Por pagar', Settle: 'Liquidar integralmente com crédito', Gift: 'Oferta', Free: 'Gratuita', Undefined: 'Contribuição por definir', Release: 'Libertar o horário', Keep: 'Manter bloqueado' }

function PhotoPreview({ file }) {
  const [url, setUrl] = useState('')
  const target = useRef(null)
  useEffect(() => {
    let value
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !value) { value = URL.createObjectURL(file); setUrl(value); observer.disconnect() }
    })
    observer.observe(target.current)
    return () => { observer.disconnect(); if (value) URL.revokeObjectURL(value) }
  }, [file])
  return <div ref={target} className={styles.preview}>{url && <img src={url} alt="Fotografia selecionada para partilhar no fecho" />}</div>
}

export default function ClosureForm({ detail, disabled, onClose, instant, canClose = true }) {
  const draft = useClosureDraft(detail)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const fields = draft.fields
  if (!fields || !draft.available) return <div className="notice" role="status">{draft.error || draft.status}</div>
  async function confirm(event) {
    event.preventDefault()
    if (sending) return
    setSending(true); setError('')
    try {
      await draft.flush()
      if (fields.outcome !== 'Performed' && draft.files.length) throw new Error('As fotografias só podem ser partilhadas numa consulta realizada. Conserva ou remove as imagens antes de alterar o resultado.')
      for (let i = 0; i < draft.files.length; i++) await uploadConsultationPhoto(detail.id, fields.photoIds[i], draft.files[i], detail.version)
      await onClose({ action: 'Close', id: detail.id, version: detail.version, choice: fields.outcome,
        method: fields.method, availabilityChoice: fields.availability, amount: fields.amount ? Number(fields.amount) : null,
        ...(fields.method === 'Pack' && fields.outcome === 'Performed' ? { packId: fields.packId } : {}),
        startsAt: fields.outcome === 'Performed' ? instant(fields.start) : undefined,
        endsAt: fields.outcome === 'Performed' ? instant(fields.end) : undefined, sharedNote: fields.shared, privateNote: fields.private, photoIds: fields.photoIds || [] }, draft.clear)
    } catch (failure) { setError(failure.message) } finally { setSending(false) }
  }
  const input = name => ({ value: fields[name], onChange: event => draft.change(name, event.target.value) })
  return <form data-protect-draft onSubmit={confirm}><h3>Fechar consulta</h3><p role="status">{draft.status}</p>
    {!canClose && <div className="notice"><p>A consulta já foi tratada. Este rascunho foi conservado para consulta e não será enviado.</p><button type="button" className="secondary" onClick={async () => { if (window.confirm('Queres eliminar apenas este rascunho deste aparelho? Os dados confirmados no servidor não serão alterados.')) { try { await draft.clear() } catch (failure) { setError(failure.message) } } }}>Eliminar este rascunho do aparelho</button></div>}
    {draft.conflict && <div className="notice error" role="alert">A consulta mudou desde este rascunho. Os teus dados não foram substituídos.<button type="button" className="secondary" onClick={draft.acceptCurrentVersion}>Revi a consulta atual; manter estes campos para continuar</button></div>}
    {(draft.error || error) && <div className="notice error" role="alert">{draft.error || error}<button type="button" className="secondary" onClick={() => draft.flush().catch(() => {})}>Tentar guardar rascunho novamente</button><button type="button" className="secondary" onClick={() => draft.compareSaved().catch(failure => setError(failure.message))}>Comparar com o rascunho guardado</button></div>}
    {draft.comparison && <div className="notice"><h4>Versão guardada no aparelho</h4>{draft.comparison.fields ? <dl className={styles.comparison}>{Object.entries(fieldLabels).map(([name, label]) => <div key={name}><dt>{label}</dt><dd>{choiceLabels[draft.comparison.fields[name]] || draft.comparison.fields[name] || 'Não preenchido'}</dd></div>)}</dl> : <p>Já não existe uma versão guardada neste aparelho. A tua edição continua no formulário.</p>}<p>{draft.comparison.files.length} fotografias nesta versão.</p>{draft.comparison.files.map((file, index) => <div key={index}><p>{file.name}</p><PhotoPreview file={file} /></div>)}<button type="button" className="secondary" onClick={() => { if (window.confirm('Comparaste as versões e queres guardar a tua edição atual em vez da versão apresentada?')) draft.replaceCompared() }}>Guardar a minha edição em vez desta versão</button></div>}
    <fieldset disabled={disabled || sending || !canClose || draft.conflict} className={styles.fields}>
      <label>Resultado<select name="outcome" {...input('outcome')}><option value="Performed">Realizada</option><option value="NoShow">Não compareceu</option><option value="CancelledManager">Cancelada pela terapeuta</option></select></label>
      {fields.outcome === 'Performed' ? <><label>Início efetivo<input type="datetime-local" name="start" required {...input('start')} /></label><label>Fim efetivo<input type="datetime-local" name="end" required {...input('end')} /></label>
        <label>Tratamento financeiro<select name="method" {...input('method')}><option value="Unpaid">Por pagar</option><option value="Settle">Liquidar integralmente com crédito</option><option value="Pack">Usar uma sessão de pack</option><option value="Gift">Oferta</option>{detail.paymentMode === 'Free' && <option value="Free">Gratuita</option>}{detail.paymentMode === 'Contribution' && <option value="Undefined">Contribuição por definir</option>}</select></label>
        {fields.method === 'Pack' && <PackChoice personId={detail.personId} serviceId={detail.serviceId} at={fields.start} instant={instant} value={fields.packId || ''} onChange={event => draft.change('packId', event.target.value)} />}
        {['Unpaid', 'Settle'].includes(fields.method) && <label>Valor final<input type="number" name="amount" min="0.01" step="0.01" required {...input('amount')} /></label>}
        <label>Nota partilhada (opcional)<textarea name="shared" maxLength="8000" {...input('shared')} /></label></> : <p>Sem dívida e sem consumo de crédito ou sessões de pack.</p>}
      {fields.outcome === 'CancelledManager' && <label>Disponibilidade após cancelar<select name="availability" required {...input('availability')}><option value="">Escolhe o destino do horário</option><option value="Release">Libertar o horário</option><option value="Keep">Manter bloqueado</option></select></label>}
      <label>Nota privada (opcional)<textarea name="private" maxLength="8000" {...input('private')} /></label>
      <label>Fotografias a partilhar após o fecho<input type="file" accept="image/jpeg,image/png" multiple onChange={async event => { const files = [...event.target.files]; event.target.value = ''; try { await draft.addPhotos(files); setError('') } catch (failure) { setError(failure.message) } }} /></label>
      {draft.files.map((file, index) => <div className={styles.photo} key={fields.photoIds[index]}><p>{file.name}</p><PhotoPreview file={file} /><button type="button" className="secondary" onClick={() => draft.removePhoto(index)}>Retirar fotografia {index + 1} do rascunho</button></div>)}
      <p>O resultado e o valor definido não podem ser alterados depois de confirmar.</p>{canClose && <button>Confirmar fecho definitivo</button>}
    </fieldset>
  </form>
}

export function PackChoice({ personId, serviceId, at, instant, value, onChange }) {
  const [page, setPage] = useState(1)
  let reference = ''
  try { reference = at ? instant(at) : '' } catch { /* Keep the editor unchanged until the date is valid. */ }
  const query = new URLSearchParams({ personId, serviceId: serviceId || '', at: reference, scope: 'Compatible', page })
  const key = query.toString()
  const read = useCallback(signal => apiRequest('consultations/packs?' + key, undefined, { signal }), [key])
  const result = useLiveResource('packs', key, read, !!reference && !!serviceId)
  return <div>{!reference && <p>Preenche o início efetivo para escolheres o pack.</p>}{result.error && <p role="alert">{result.error}</p>}
    <label>Pack compatível<select name="packId" value={value} onChange={onChange} required><option value="">Seleciona o pack</option>{result.data?.items.map(pack => <option key={pack.id} value={pack.id}>{pack.title} · {pack.remaining} sessões</option>)}</select></label>
    {result.data?.total > 8 && <nav className="pager"><button type="button" className="secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</button><button type="button" className="secondary" disabled={page * 8 >= result.data.total} onClick={() => setPage(p => p + 1)}>Seguinte</button></nav>}
  </div>
}
