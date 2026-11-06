import AudioPlayer from './AudioPlayer'
import { audioAccept, validateAudioFile } from './audioAttachment'
import styles from './ClosureAttachments.module.css'

const kinds = [
  { kind: 'image', label: 'Imagens · até 3, de 4 MB cada', accept: 'image/jpeg,image/png,.jpg,.jpeg,.png', limit: 3 },
  { kind: 'video', label: 'Vídeo · MP4 ou MOV até 30 segundos e 25 MB', accept: 'video/mp4,video/quicktime,.mp4,.mov', limit: 1 },
  { kind: 'audio', label: 'Áudio · MP3, WAV ou OGG até 9 MB', accept: audioAccept, limit: 1 },
]

export function ClosureAttachmentFields({ title, files, onChange, onError }) {
  function add(kind, selected, limit) {
    if (!selected.length) return
    const previous = files.filter(item => item.kind === kind)
    if (previous.length + selected.length > limit) throw new Error('Esta secção já atingiu o limite deste tipo de anexo. Retira um ficheiro antes de adicionar outro.')
    for (const file of selected) {
      if (kind === 'audio') validateAudioFile(file)
      if (kind === 'image' && (!/\.(jpe?g|png)$/i.test(file.name) || !file.size || file.size > 4 * 1024 * 1024))
        throw new Error('Escolhe imagens JPEG ou PNG até 4 MB cada.')
      if (kind === 'video' && (!/\.(mp4|mov)$/i.test(file.name) || !file.size || file.size > 25_000_000))
        throw new Error('Escolhe um vídeo MP4 ou MOV até 25 MB.')
    }
    onChange([...files, ...selected.map(file => ({ id: crypto.randomUUID(), kind, file }))])
  }
  return <fieldset className={styles.fields}>
    <legend>{title}</legend>
    {kinds.map(({ kind, label, accept, limit }) => <label key={kind}>{label}<input type="file" accept={accept} multiple={limit > 1}
      onChange={event => {
        const selected = Array.from(event.target.files); event.target.value = ''
        try { add(kind, selected, limit); onError('') } catch (failure) { onError(failure.message) }
      }} /></label>)}
    {files.length > 0 && <ul className={styles.files}>{files.map(item => <li key={item.id}>{item.file.name}{' '}
      <button type="button" className="secondary" onClick={() => onChange(files.filter(f => f.id !== item.id))}>Retirar anexo</button>
    </li>)}</ul>}
  </fieldset>
}

export function ClosureAttachmentList({ consultationId, scope, items }) {
  if (!items?.length) return null
  const label = scope === 'private' ? 'das notas privadas' : 'da informação partilhada'
  return <div className={styles.media}>{items.map((item, index) => {
    const src = `/api/consultations/${consultationId}/closure-media/${scope}/${item.id}`
    if (item.kind === 'image') return <img key={item.id} src={src} loading="lazy" alt={`Imagem ${index + 1} ${label}`} />
    if (item.kind === 'video') return <video key={item.id} src={src} controls playsInline preload="none" aria-label={`Vídeo ${label}`} />
    if (item.kind === 'audio') return <AudioPlayer key={item.id} src={src} label={`Áudio ${label}`} />
    return null
  })}</div>
}
