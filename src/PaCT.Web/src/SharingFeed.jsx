import AudioPlayer from './AudioPlayer'
import { audioAccept, validateAudioFile } from './audioAttachment'
import { useCallback, useEffect, useId, useState } from 'react'
import ActionButton from './ActionButton'
import AppIcon from './AppIcon'
import ClientSearch from './ClientSearch'
import ConsultationDialog from './ConsultationDialog'
import Heading from './Heading'
import InformationCard from './InformationCard'
import Pagination from './Pagination'
import SharingMediaGallery from './SharingMediaGallery'
import SharingTarget from './SharingTarget'
import useLiveResource from './useLiveResource'
import { apiRequest } from './identityApi'
import { agendaDate } from './agendaTime'
import { isManager } from './identityRoles'
import { showSuccess } from './actionNotices'
import { readSharingTarget, uploadSharingPost } from './sharingData'
import styles from './SharingFeed.module.css'

const labels = { Pending: 'Por validar', Approved: 'Aprovada', Rejected: 'Rejeitada', Hidden: 'Ocultada', Deleted: 'Eliminada',
  Published: 'Publicada', Edited: 'Editada' }
const moderation = { Pending: [['approve', 'Aprovar'], ['reject', 'Rejeitar'], ['hide', 'Ocultar']], Approved: [['hide', 'Ocultar']], Hidden: [['restore', 'Repor no feed']] }

export default function SharingFeed({ profile, onSignIn, guard = action => action() }) {
  const manager = isManager(profile?.role)
  const [scope, setScope] = useState('feed')
  const [paging, setPaging] = useState({ page: 1, before: '' })
  const [editor, setEditor] = useState(null)
  const [reference, setReference] = useState('')
  const query = new URLSearchParams({ scope, page: paging.page })
  if (paging.before) query.set('before', paging.before)
  const path = 'sharing?' + query
  const read = useCallback(signal => apiRequest(path, undefined, { signal }), [path])
  const feed = useLiveResource('sharing', path, read, scope !== 'permissions')
  const canPublish = manager || feed.data?.canPublish === true

  function changeScope(next) {
    setPaging({ page: 1, before: '' }); setScope(next)
  }

  return <section className={styles.feed} aria-label="Partilhas">
    <Heading level={1}>Partilhas</Heading>
    {profile && <nav className={styles.actions} aria-label="Áreas de Partilhas">
      {(manager ? [['feed', 'Feed'], ['mine', 'As minhas publicações'], ['moderation', 'Moderação']]
        : [['feed', 'Feed'], ['mine', 'As minhas publicações']]).map(([id, label]) =>
        <ActionButton key={id} variant={(scope === id || scope === 'permissions' && id === 'moderation') ? 'primary' : 'secondary'} aria-current={(scope === id || scope === 'permissions' && id === 'moderation') ? 'page' : undefined} onClick={() => changeScope(id)}>{label}</ActionButton>)}
    </nav>}
    {!profile && <p>Podes ler as partilhas. Para reagir, inicia sessão.</p>}
    {canPublish && ['feed', 'mine'].includes(scope) && <ActionButton onClick={() => setEditor({ id: crypto.randomUUID() })}>Nova publicação</ActionButton>}
    {manager && ['moderation', 'permissions'].includes(scope) && <nav className={styles.actions} aria-label="Moderação de Partilhas">
      <ActionButton variant={scope === 'moderation' ? 'primary' : 'secondary'} onClick={() => changeScope('moderation')}>Publicações a rever</ActionButton>
      <ActionButton variant={scope === 'permissions' ? 'primary' : 'secondary'} onClick={() => changeScope('permissions')}>Permissões de publicação</ActionButton>
    </nav>}
    {scope === 'permissions' ? <SharingPermissions /> : <>
      {scope === 'moderation' && <Heading level={2}>Publicações a rever</Heading>}
      {feed.loading && <p role="status">A carregar publicações…</p>}
      {feed.error && <InformationCard error={feed.error} onRetry={feed.refresh} />}
      {feed.data?.items.length === 0 && <InformationCard><p>{scope === 'moderation' ? 'Não há publicações por rever, ocultadas ou rejeitadas.' : 'Ainda não há publicações nesta lista.'}</p></InformationCard>}
      {feed.data?.items.map(post => <SharingCard key={post.id} post={post} profile={profile} canPublish={canPublish}
        onEdit={() => setEditor(post)} onAgenda={setReference} refresh={feed.refresh} />)}
      {feed.data && <Pagination total={feed.data.total} pageSize={feed.data.pageSize} page={paging.page}
        label="Páginas de Partilhas" onChange={page => setPaging({ page, before: page > 1 ? feed.data.before : '' })} />}
    </>}
    {editor && <PostEditor key={editor.id} post={editor} manager={manager} onClose={() => guard(() => setEditor(null))}
      onSaved={() => { setEditor(null); if (scope === 'feed' || scope === 'mine') setPaging({ page: 1, before: '' }) }} />}
    {reference && <SharingTarget key={reference} reference={reference} profile={profile} onSignIn={onSignIn} guard={guard} onClose={() => setReference('')} />}
  </section>
}

function SharingCard({ post, profile, canPublish, onEdit, onAgenda, refresh }) {
  const manager = isManager(profile?.role)
  const publicPost = post.status === 'Pending' || post.status === 'Approved'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [comment, setComment] = useState(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [history, setHistory] = useState(null)
  const labelId = useId()
  const commentsId = labelId + '-comments'

  async function act(path, body, message) {
    setBusy(true); setError('')
    try {
      const result = await apiRequest('sharing/' + post.id + path, body)
      if (body && result.confirmed !== true) throw new Error('A operação ficou sem confirmação.')
      if (message) showSuccess(message)
      return result
    } catch (failure) {
      setError(failure.message)
      if (failure.status === 409 || failure.status === 404) refresh()
      return null
    } finally { setBusy(false) }
  }

  function decide(action, label) {
    if (action === 'delete' && !window.confirm('Eliminar esta publicação?')) return
    void act('/decision', { action, version: post.version }, label)
  }
  const date = agendaDate(post.createdAt)
  const initials = post.author.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase()
  const canReact = !!profile && publicPost
  const canSeeComments = post.comments.length > 0 || canPublish && post.status === 'Approved'
  const commentLabel = post.comments.length === 1 ? '1 comentário' : post.comments.length > 1 ? post.comments.length + ' comentários' : 'Comentários'
  return <InformationCard as="article" className={styles.postCard} aria-labelledby={labelId}>
    <div className={styles.postBody}>
      <header className={styles.postAuthor}>
        <span className={styles.avatar} aria-hidden="true">{initials}</span>
        <div>
          <Heading level={2} appearance="inherit" id={labelId}><strong>{post.author}</strong></Heading>
          <small className="muted"><time dateTime={post.createdAt}>{date}</time>{(manager || post.own || post.status === 'Pending') && <> · {labels[post.status]}</>}</small>
        </div>
      </header>
      {post.media.length > 0 && <SharingMediaGallery media={post.media} />}
      {post.text && <p className={styles.text}>{post.text}</p>}
      {post.link && <a href={post.link} target="_blank" rel="noopener noreferrer">{post.link}</a>}
      {post.agendaReference && <ActionButton variant="text" className={styles.agendaAction}
        onClick={() => onAgenda(post.agendaReference)}>{post.agendaReference.includes('@') ? 'Ver horário' : 'Ver evento'}</ActionButton>}
      <PostInteractionBar post={post} canReact={canReact} disabled={busy} onChange={reaction => act('/reaction', { reaction })}
        commentsAction={canSeeComments && <ActionButton variant="secondary"
          aria-expanded={commentsOpen} aria-controls={commentsId} onClick={() => setCommentsOpen(open => !open)}>
          <AppIcon name="comment" />{commentLabel}
        </ActionButton>} />
      {canSeeComments && <div id={commentsId} className={styles.comments} hidden={!commentsOpen}>
        {post.comments.map(item => <div key={item.id}>
          <p className={styles.text}>{item.text}</p>
          <p className="muted">{item.author} · {agendaDate(item.createdAt)}</p>
          {item.own && canPublish && publicPost && <ActionButton variant="text" disabled={busy} onClick={() => setComment(item)}>Editar comentário</ActionButton>}
          {(item.own && publicPost || manager) && <ActionButton variant="text" disabled={busy}
            onClick={() => void act('/comments/' + item.id, { version: item.version, delete: true }, 'Comentário eliminado.')}>Eliminar comentário</ActionButton>}
        </div>)}
        {canPublish && post.status === 'Approved' && <ActionButton variant="secondary" onClick={() => setComment({ id: crypto.randomUUID(), version: 0 })}>Comentar</ActionButton>}
      </div>}
      {(manager || post.own || post.canEdit) && <details className={styles.postOptions}>
        <summary>Opções da publicação</summary>
        <div className={styles.actions}>
          {post.canEdit && <ActionButton variant="text" onClick={onEdit} disabled={busy}>Editar</ActionButton>}
          {(manager || post.own) && <ActionButton variant="text" disabled={busy} onClick={async () => setHistory(await act('/history'))}>Ver histórico</ActionButton>}
          {post.own && <ActionButton variant="text" disabled={busy} onClick={() => decide('delete', 'Publicação eliminada.')}>Eliminar</ActionButton>}
          {manager && (moderation[post.status] || []).map(([id, label]) => <ActionButton key={id} variant="secondary" disabled={busy}
            onClick={() => decide(id, 'Moderação registada.')}>{label}</ActionButton>)}
        </div>
      </details>}
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
    {comment && <CommentEditor comment={comment} onClose={() => setComment(null)} onSave={async text => {
      const result = await act('/comments/' + comment.id, { text, version: comment.version }, 'Comentário guardado.')
      if (result) setComment(null)
      else throw new Error('Não foi possível guardar. Confirma se a publicação ainda aceita comentários.')
    }} />}
    {history && <ConsultationDialog title="Histórico da publicação" onClose={() => setHistory(null)}>
      {history.map((change, i) => <InformationCard key={i} title={labels[change.action] || change.action} headingLevel={3}>
        <p>{change.author || 'Conta PaCT'} · {agendaDate(change.at)}</p>
        {change.text && <p className={styles.text}>{change.text}</p>}
        {change.link && <p>{change.link}</p>}
      </InformationCard>)}
    </ConsultationDialog>}
  </InformationCard>
}

const reactions = [
  ['like', '👍', 'Gosto'], ['love', '❤️', 'Adoro'], ['smile', '😊', 'Sorriso'],
  ['hands', '🙌', 'Celebração'], ['wow', '😮', 'Surpresa'], ['clap', '👏', 'Aplausos'],
]

function PostInteractionBar({ post, canReact, disabled, onChange, commentsAction }) {
  const visibleReactions = canReact ? reactions : reactions.filter(([key]) => post.reactionCounts?.[key] > 0)
  if (!visibleReactions.length && !commentsAction) return null

  return <div className={styles.reactions}>
    <div className={styles.socialActions}>
      {canReact ? <div className={styles.reactionButtons} role="group" aria-label="Reagir à publicação">
        {visibleReactions.map(([key, icon, name]) => {
          const count = post.reactionCounts?.[key] || 0
          const selected = post.myReaction === key
          return <ActionButton key={key} variant="secondary" disabled={disabled}
            aria-label={name} aria-pressed={selected}
            aria-description={count + (count === 1 ? ' reação' : ' reações')}
            onClick={() => onChange(selected ? null : key)}>
            <span aria-hidden="true">{icon}</span>
            <small aria-hidden="true" className={count === 0 ? styles.emptyReactionCount : undefined}>{count}</small>
          </ActionButton>
        })}
      </div> : visibleReactions.length > 0 && <ul className={styles.reactionCounts} aria-label="Contagem de reações">
        {visibleReactions.map(([key, icon, name]) => <li key={key} aria-label={name + ': ' + post.reactionCounts[key]}>
          {icon} {post.reactionCounts[key]}
        </li>)}
      </ul>}
      {commentsAction}
    </div>
  </div>
}

function completeLink({ currentTarget: input, nativeEvent }) {
  const value = input.value
  if (nativeEvent.inputType?.startsWith('delete')) {
    if (/^https?:\/\/$/i.test(value)) input.value = ''
    return
  }
  if (!value) return

  const address = value.replace(/^https:\/\/(?=https?:\/\/)/i, '')
  const completed = /^[a-z][a-z\d+.-]*:\/\//i.test(address) ? address : 'https://' + address
  if (completed !== value) input.value = completed
}

function PostEditor({ post, manager, onClose, onSaved }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reference, setReference] = useState(post.agendaReference || '')
  const [preview, setPreview] = useState(null)
  const [checking, setChecking] = useState(false)
  const [removed, setRemoved] = useState([])
  const [attachments, setAttachments] = useState([])
  useEffect(() => () => attachments.forEach(item => URL.revokeObjectURL(item.url)), [attachments])

  function selectFiles(form) {
    const files = [...form.querySelectorAll('input[type="file"]')].flatMap(input =>
      Array.from(input.files, file => ({ type: input.name, name: file.name, url: URL.createObjectURL(file) })))
    setAttachments(files)
  }
  async function checkReference() {
    setChecking(true); setError(''); setPreview(null)
    try { setPreview(await readSharingTarget(reference.trim())) }
    catch (failure) { setError(failure.message) }
    finally { setChecking(false) }
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const form = new FormData(event.currentTarget)
      const photos = form.getAll('images').filter(file => file.name)
      const video = form.getAll('video').filter(file => file.name)
      const audio = form.getAll('audio').filter(file => file.name)
      const kept = (post.media || []).filter(item => !removed.includes(item.id))
      if (kept.filter(item => item.type.startsWith('image/')).length + photos.length > 5
        || kept.filter(item => item.type === 'video/mp4').length + video.length > 1
        || kept.filter(item => item.type.startsWith('audio/')).length + audio.length > 1) throw new Error('Podes juntar até cinco imagens, um vídeo e um áudio.')
      audio.forEach(validateAudioFile)
      if (photos.some(file => file.size > 4 * 1024 * 1024) || video.some(file => file.size > 25 * 1000 * 1000))
        throw new Error('Cada imagem pode ter até 4 MB e o vídeo até 25 MB.')
      form.delete('images'); form.delete('video'); form.delete('audio')
      photos.forEach(file => form.append('images', file))
      video.forEach(file => form.append('video', file))
      audio.forEach(file => form.append('audio', file))
      form.set('version', String(post.version || 0))
      removed.forEach(id => form.append('removeMediaIds', id))
      await uploadSharingPost(post.id, form)
      showSuccess(post.version ? 'Publicação atualizada.' : 'Publicação enviada.')
      onSaved()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <ConsultationDialog title={post.version ? 'Editar publicação' : 'Nova publicação'} disabled={busy} onClose={onClose}>
    <p>O teu nome público e o conteúdo da publicação ficam visíveis no feed.</p>
    <form onSubmit={save} data-protect-draft data-pending-command={busy || undefined} className={styles.editor}>
      <label>Texto<textarea name="text" defaultValue={post.text || ''} maxLength={5000} rows={5} disabled={busy} /></label>
      <label>Link (opcional)<input name="link" type="url" defaultValue={post.link || ''} placeholder="https://" onChange={completeLink} maxLength={2048} disabled={busy} /></label>
      <label>Referência da Agenda<input name="agendaReference" value={reference} onChange={event => { setReference(event.target.value); setPreview(null) }} maxLength={50} disabled={busy || checking} /></label>
      {reference.trim() && <ActionButton variant="text" disabled={busy || checking} onClick={checkReference}>Ver referência</ActionButton>}
      {preview && <p className="notice">{preview.title} · {agendaDate(preview.startsAt)}{preview.location && ' · ' + preview.location}</p>}
      <label>Imagens · até 5, de 4 MB cada<input type="file" name="images" accept="image/jpeg,image/png" multiple disabled={busy} onChange={event => selectFiles(event.currentTarget.form)} /></label>
      <label>Vídeo · até 30 segundos e 25 MB<input type="file" name="video" accept="video/mp4,video/quicktime,.mov,.mp4" disabled={busy} onChange={event => selectFiles(event.currentTarget.form)} /></label>
      <label>Áudio · MP3, WAV ou OGG até 9 MB<input type="file" name="audio" accept={audioAccept} disabled={busy} onChange={event => selectFiles(event.currentTarget.form)} /></label>
      {attachments.length > 0 && <div className={styles.attachments}>
        {attachments.map(item => item.type === 'video' ? <video key={item.url} src={item.url} controls playsInline preload="metadata" aria-label={item.name} />
          : item.type === 'audio' ? <AudioPlayer key={item.url} src={item.url} label={item.name} />
          : <img key={item.url} src={item.url} alt={item.name} />)}
      </div>}
      {post.media?.map((item, i) => <label className="checkbox" key={item.id}>
        <input type="checkbox" checked={removed.includes(item.id)} disabled={busy}
          onChange={event => setRemoved(list => event.target.checked ? [...list, item.id] : list.filter(id => id !== item.id))} />
        Retirar {item.type === 'video/mp4' ? 'vídeo' : item.type.startsWith('audio/') ? 'áudio' : 'imagem ' + (i + 1)}
      </label>)}
      {error && <p role="alert" className="notice error">{error}</p>}
      <ActionButton type="submit" disabled={busy || checking}>{busy ? 'A guardar…' : post.version ? 'Guardar alterações' : manager ? 'Publicar' : 'Enviar publicação'}</ActionButton>
    </form>
  </ConsultationDialog>
}

function CommentEditor({ comment, onClose, onSave }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <ConsultationDialog title={comment.version ? 'Editar comentário' : 'Novo comentário'} onClose={onClose} disabled={busy}>
    <form className={styles.editor} data-protect-draft data-pending-command={busy || undefined} onSubmit={async event => {
      event.preventDefault()
      const text = new FormData(event.currentTarget).get('text').trim()
      if (!text) { setError('Escreve um comentário.'); return }
      setError(''); setBusy(true)
      try { await onSave(text) } catch (failure) { setError(failure.message) } finally { setBusy(false) }
    }}>
      <label>Comentário<textarea name="text" defaultValue={comment.text || ''} maxLength={2000} required disabled={busy} rows={4} /></label>
      {error && <p role="alert" className="notice error">{error}</p>}
      <ActionButton type="submit" disabled={busy}>Guardar comentário</ActionButton>
    </form>
  </ConsultationDialog>
}

function SharingPermissions() {
  const [client, setClient] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const path = 'sharing/permissions/' + (client?.id || '')
  const read = useCallback(signal => apiRequest(path, undefined, { signal }), [path])
  const status = useLiveResource('sharing', path, read, !!client)
  return <InformationCard title="Permissões de publicação">
    <ClientSearch purpose="filter" selected={client} onSelect={value => { setClient(value); setError('') }} canSelect={person => person.hasAccount} disabled={busy} />
    {status.loading && <p role="status">A consultar a autorização…</p>}
    {(error || status.error) && <p role="alert" className="notice error">{error || status.error}</p>}
    {status.data && <>
      <p>{status.data.allowed ? 'Publicação autorizada.' : 'Sem autorização individual de publicação.'}</p>
      <ActionButton disabled={busy} onClick={async () => {
        setBusy(true); setError('')
        try {
          const result = await apiRequest(path, { allowed: !status.data.allowed })
          showSuccess(result.allowed ? 'Autorização concedida.' : 'Autorização retirada.')
        } catch (failure) { setError(failure.message) } finally { setBusy(false) }
      }}>{status.data.allowed ? 'Retirar autorização' : 'Autorizar publicação'}</ActionButton>
    </>}
  </InformationCard>
}