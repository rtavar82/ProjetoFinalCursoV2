import { useEffect, useState } from 'react'
import { apiRequest } from './identityApi'
import ClientProfileForm from './ClientProfileForm'
import styles from './PersonalProfile.module.css'
function dateOf(value) { return new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value.endsWith('Z') ? value : value + 'Z')) }

export default function PersonalProfile({ busy, perform, notify }) {
  const [client, setClient] = useState(null)
  const [reviews, setReviews] = useState([])
  const [error, setError] = useState('')
  useEffect(() => { let current = true; async function load() { try { const [data, updates] = await Promise.all([apiRequest('profile'), apiRequest('profile/reviews')]); if (current) { setClient(data); setReviews(updates) } } catch (failure) { if (current) setError(failure.message) } } load(); return () => { current = false } }, [])
  function save(input) { perform(async () => { const result = await apiRequest('profile', input); notify(result.message, !result.saved); if (result.saved) setClient(result.client); setReviews(await apiRequest('profile/reviews')) }) }
  return <section className={styles.page}><h1>Meus dados</h1>{error && <p role="alert" className="notice error">{error}</p>}{!client && !error && <p role="status">A carregar os teus dados…</p>}
    {client?.identityReviewStatus === 'Pending' && <div className="notice" role="status"><strong>Identidade por verificar</strong><p>A gestão está a verificar os teus dados. Podes continuar a usar a tua conta. Nenhuma ficha anterior foi associada automaticamente.</p></div>}
    {client && <ClientProfileForm key={client.version} client={client} requireBirthDate busy={busy} onSave={save} />}
    {reviews.length > 0 && <details><summary>Revisões dos meus dados</summary>{reviews.map(review => <p key={review.id}>{dateOf(review.createdAt)} — {review.message}</p>)}</details>}
  </section>
}
