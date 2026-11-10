import { useCallback, useEffect, useState } from 'react'
import ActionButton from './ActionButton'
import ConsultationPhotoPreview from './ConsultationPhotoPreview'
import InformationCard from './InformationCard'
import ManagerSchedulingDialog from './ManagerSchedulingDialog'
import MbWayLogo from './MbWayLogo'
import { apiRequest } from './identityApi'
import { showSuccess } from './actionNotices'
import useLiveResource from './useLiveResource'
import { validateJpegPng } from './photoValidation'
import formStyles from './ManagerScheduling.module.css'

export default function SitePresentationPanel({ section, title, guard, busy }) {
  const path = `management/presentation/${section}`
  const messaging = section === 'WhatsApp'
  const read = useCallback(signal => apiRequest(path, undefined, { signal }), [path])
  const resource = useLiveResource('management', path, read)
  const [session, setSession] = useState(null), [opening, setOpening] = useState(false), [error, setError] = useState('')

  async function open() {
    const editor = crypto.randomUUID()
    setOpening(true)
    setError('')
    try {
      await apiRequest('management/presentation/editor', { editor })
      try { setSession({ ...(await read()), editor }) }
      catch (failure) {
        release(editor)
        throw failure
      }
    } catch (failure) { setError(failure.message) }
    finally { setOpening(false) }
  }

  function close() {
    release(session.editor)
    setSession(null)
    resource.refresh()
  }

  return <>
    <InformationCard title={title} cardId="site-presentation" loading={resource.loading}
      error={resource.error || error} onRetry={resource.error ? resource.refresh : undefined}
      actions={<ActionButton disabled={busy || opening || !resource.data || !!resource.error} onClick={() => guard(open)}>Editar</ActionButton>}>
      <p>{messaging ? 'Edita os modelos que a gestão pode escolher ao preparar uma mensagem no WhatsApp.' : section === 'Places'
        ? 'As descrições são públicas. A morada completa segue as regras de acesso da Agenda e será usada nos novos registos.'
        : 'Revê as alterações antes de as publicar na apresentação da PaCT.'}</p>
      {section === 'Payment' && <p>Para retirar a transferência bancária, limpa o IBAN e o BIC/SWIFT. Para retirar o MB WAY, limpa o número.</p>}
      {!messaging && resource.data && <p>{resource.data.version ? `Versão publicada ${resource.data.version}` : 'Conteúdo inicial'}</p>}
    </InformationCard>
    {session && <SiteEditor title={title} session={session} path={path} guard={guard} busy={busy} onClose={close} messaging={messaging} />}
  </>
}

function release(editor) {
  // If the window loses the connection, the reservation still expires at the server.
  if (navigator.onLine) void apiRequest('management/presentation/editor', { editor, release: true }).catch(() => {})
}

function SiteEditor({ title, session, path, guard, busy, onClose, messaging }) {
  const { editor, fields, version, places: publishedPlaces, images = [] } = session
  const imageFields = images ?? []
  const [draft, setDraft] = useState(() => Object.fromEntries(fields.map(field => [field.key, field.value])))
  const [places, setPlaces] = useState(() => (publishedPlaces ?? []).map(place => ({ ...place, key: place.name, existing: true })))
  const [review, setReview] = useState(null), [sending, setSending] = useState(false), [error, setError] = useState('')
  const [files, setFiles] = useState({})
  const [checkingImage, setCheckingImage] = useState(false)
  const disabled = busy || sending || checkingImage
  const dirty = fields.some(field => draft[field.key].trim() !== field.value)
    || Object.keys(files).length > 0
    || places.length !== (publishedPlaces?.length ?? 0)
    || places.some((place, index) => !place.existing || ['description', 'address'].some(key => place[key].trim() !== publishedPlaces?.[index]?.[key]))
  const editPlace = (key, change) => setPlaces(current => current.map(place => place.key === key ? { ...place, ...change } : place))
  const imageTextKeys = new Set(imageFields.flatMap(image => [image.altKey, image.captionKey]))

  function fieldLabel(field, showOptional = false) {
    const label = showOptional && field.optional ? field.label + ' (opcional)' : field.label
    return field.key === 'payment.mbWay' ? <span><MbWayLogo compact decorative /> {label}</span> : label
  }

  function editField(field) {
    const Control = field.multiline ? 'textarea' : 'input'
    return <label key={field.key}>{fieldLabel(field, true)}<Control required={!field.optional} maxLength={field.maximum} value={draft[field.key]}
      onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} /></label>
  }

  async function chooseImage(key, event) {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    setCheckingImage(true)
    setError('')
    try {
      await validateJpegPng(file, 5)
      setFiles(current => ({ ...current, [key]: file }))
    } catch (failure) { setError(failure.message) }
    finally { setCheckingImage(false) }
  }

  function discardImage(key) {
    setFiles(current => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  useEffect(() => {
    let renewing = false
    const timer = window.setInterval(async () => {
      if (!navigator.onLine || renewing) return
      renewing = true
      try { await apiRequest('management/presentation/editor', { editor, renew: true }) }
      catch (failure) { setError(failure.message) }
      finally { renewing = false }
    }, 60000)
    return () => window.clearInterval(timer)
  }, [editor])

  function prepare(event) {
    event.preventDefault()
    setError('')
    setReview({
      values: Object.fromEntries(fields.map(field => [field.key, draft[field.key].trim()])),
      ...(publishedPlaces ? { places: places.map(({ name, description, address }) => ({ name: name.trim(), description: description.trim(), address: address.trim() })) } : {})
    })
  }

  async function publish() {
    setSending(true)
    setError('')
    try {
      const publication = { editor, version, ...review }
      let body = publication
      if (Object.keys(files).length > 0) {
        body = new FormData()
        body.set('publication', JSON.stringify(publication))
        for (const [key, file] of Object.entries(files)) body.set(key, file)
      }
      await apiRequest(`${path}/publish`, body)
      showSuccess(messaging ? 'Modelos de WhatsApp guardados.' : 'Alterações publicadas.')
      onClose()
    } catch (failure) { setError(failure.message) }
    finally { setSending(false) }
  }

  return <ManagerSchedulingDialog title={review ? (messaging ? 'Rever mensagens' : 'Rever publicação') : title} disabled={disabled} onClose={() => guard(onClose)}>
    {error && <p className="notice error" role="alert">{error}</p>}
    {review && <>
      <InformationCard title={messaging ? 'Alterações aos modelos' : 'Alterações a publicar'} headingLevel={3}>
        {fields.filter(field => review.values[field.key] !== field.value).map(field => <p key={field.key}><strong>{fieldLabel(field)}</strong> · {review.values[field.key] || 'Retirar da apresentação'}</p>)}
        {review.places?.filter(place => !publishedPlaces.some(old => old.name === place.name && old.description === place.description && old.address === place.address))
          .map(place => <div key={place.name}><p><strong>{place.name}</strong> · {place.description}</p><p>{place.address}</p></div>)}
        {publishedPlaces?.filter(place => !review.places.some(value => value.name === place.name)).map(place =>
          <p key={place.name}><strong>Apagar {place.name}</strong> · Sai das novas escolhas. Os registos existentes são conservados.</p>)}
        {imageFields.filter(image => files[image.key]).map(image => <div key={image.key}>
          <p><strong>{image.label}</strong> · {files[image.key].name}</p>
          <ConsultationPhotoPreview file={files[image.key]} alt={review.values[image.altKey] || image.label} />
        </div>)}
      </InformationCard>
      <div className="button-row">
        <ActionButton variant="secondary" disabled={disabled} onClick={() => setReview(null)}>Voltar à edição</ActionButton>
        <ActionButton disabled={disabled} onClick={publish}>{messaging ? 'Guardar modelos' : 'Publicar'}</ActionButton>
      </div>
    </>}
    <div hidden={!!review}><form data-protect-draft onSubmit={prepare}>
      <fieldset className={formStyles.fields} disabled={disabled}>
        {messaging && <p><code>{'{saudacao}'}</code> preenche «Olá» com o primeiro nome quando disponível.
          <br /><code>{'{horario}'}</code> insere a data e a hora, precedidas de « para », quando a mensagem tem cliente e horário.</p>}
        {fields.filter(field => !imageTextKeys.has(field.key)).map(editField)}
        {imageFields.length > 0 && <>
          <h3>Imagens da apresentação</h3>
          <p>Escolhe ficheiros JPEG ou PNG de até 5 MB. As imagens só ficam visíveis na página pública quando publicares.</p>
          {imageFields.map(image => <InformationCard key={image.key} title={image.label} headingLevel={4}>
            <ConsultationPhotoPreview src={image.url} file={files[image.key]} alt={draft[image.altKey] || image.label} />
            <label>Substituir {image.label.toLocaleLowerCase('pt-PT')}
              <input type="file" accept="image/jpeg,image/png" onChange={event => chooseImage(image.key, event)} />
            </label>
            {files[image.key] && <><p>{files[image.key].name}</p>
              <ActionButton variant="text" onClick={() => discardImage(image.key)}>Manter imagem publicada</ActionButton>
            </>}
            {fields.filter(field => field.key === image.altKey || field.key === image.captionKey).map(editField)}
          </InformationCard>)}
        </>}
        {publishedPlaces && <>
          {places.map(place => <InformationCard key={place.key} title={place.existing ? place.name : 'Novo local'} headingLevel={3}
            actions={<ActionButton variant="text" aria-label={`Apagar ${place.name || 'novo local'}`}
              onClick={() => setPlaces(current => current.filter(value => value.key !== place.key))}>Apagar</ActionButton>}>
            {!place.existing && <label>Nome do local<input value={place.name} required maxLength={120}
              onChange={event => editPlace(place.key, { name: event.target.value })} /></label>}
            <label>Descrição pública<textarea value={place.description} required maxLength={600}
              onChange={event => editPlace(place.key, { description: event.target.value })} /></label>
            <label>Morada completa<input value={place.address} required maxLength={500}
              onChange={event => editPlace(place.key, { address: event.target.value })} /></label>
          </InformationCard>)}
          <ActionButton variant="secondary" disabled={places.length >= 50} onClick={() =>
            setPlaces(current => [...current, { key: crypto.randomUUID(), name: '', description: '', address: '' }])}>Novo local</ActionButton>
        </>}
        <div className="button-row">
          <ActionButton variant="secondary" onClick={() => guard(onClose)}>Voltar à gestão</ActionButton>
          <ActionButton type="submit" disabled={!dirty}>{messaging ? 'Rever antes de guardar' : 'Rever antes de publicar'}</ActionButton>
        </div>
      </fieldset>
    </form></div>
  </ManagerSchedulingDialog>
}
