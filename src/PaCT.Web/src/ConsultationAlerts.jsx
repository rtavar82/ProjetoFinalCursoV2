import { useEffect, useRef, useState } from 'react'
import { apiRequest } from './identityApi'
import { observeResource } from './liveUpdates'
import { agendaDate } from './agendaTime'
import styles from './ConsultationAlerts.module.css'

const descriptions = {
  FollowupMessage: 'Tens mensagens por ler no acompanhamento de uma consulta.',
  GuestRequest: 'Existe um pedido de consulta sem conta por analisar.',
  EventGuestRequest: 'Existe um pedido de inscrição por analisar.', EventConfirmed: 'A tua inscrição foi confirmada.', EventChanged: 'O horário ou local do evento foi alterado.',
  EventCancelled: 'O evento foi cancelado.', EventReminder24: 'O evento começa dentro de 24 horas.', EventReminder1: 'O evento começa dentro de uma hora.',
  Pack3Months: 'Consulta as sessões do teu pack.', PackExpiry: 'Faltam dois meses para a referência de um ano do teu pack. Combina a utilização das sessões com a terapeuta.',
  PackManager: 'O pack atingiu uma data de revisão. As sessões mantêm-se disponíveis até uma decisão expressa.',
  EventNewRegistration: 'Foi recebida uma nova inscrição.', EventParticipantCancelled: 'Um participante cancelou a inscrição. Revê a vaga e, se aplicável, a restituição.',
  SharedReport: 'Tens informação nova para consultar no acompanhamento.',
  AvailabilityDecision: 'Uma consulta foi cancelada. Decide se o horário fica livre ou bloqueado.',
  NegativeBalance: 'Existe um saldo negativo por correção. Consulta os pagamentos.',
  Request: 'Existe um pedido de consulta por validar.', Approved: 'A tua consulta foi confirmada.',
  Accepted: 'O cliente aceitou as condições de pagamento.', Wait8: 'Passaram oito horas desde a aceitação. O recebimento continua por confirmar.',
  Wait12: 'O recebimento continua por confirmar, doze horas após a aceitação.',
  Reminder26: 'Brevemente faltarão 24 horas para a consulta. Consulta os detalhes.',
  Reminder2: 'A consulta começa dentro de duas horas.', Expired: 'Um pedido expirou sem confirmação.',
  Closed: 'A consulta foi fechada. Podes consultar a informação partilhada.',
  Receipt: 'Foi registado dinheiro recebido em crédito.', VerifyPayment: 'Comunicação de pagamento do cliente. Verifica o recebimento.', PaymentCommunication: 'Comunicação de pagamento do cliente. Verifica o recebimento.'
}
const clientDescriptions = { Expired: 'O teu pedido não foi aprovado antes da hora de início e expirou. Para outra data, cria um novo pedido.', Closed: 'Consulta os detalhes e a informação disponível sobre a tua consulta.' }

export default function ConsultationAlerts({ client = false, onOpen, onFinance, onGuests, onEvent, onPack, onFollowup }) {
  const [notices, setNotices] = useState([])
  const [error, setError] = useState('')
  const [reading, setReading] = useState(null)
  const [uncertainRead, setUncertainRead] = useState(null)
  const pendingRead = useRef(new Map())
  async function markRead(notice) {
    if (reading) return
    if (uncertainRead && uncertainRead !== notice.id) return
    const command = pendingRead.current.get(notice.id) || { action: notice.kind === 'NegativeBalance' ? 'ReadBalanceNotice' : notice.guestRequestId || notice.packId || notice.eventId ? 'ReadDomainNotice' : 'ReadNotice', id: notice.id, ...(notice.guestRequestId || notice.packId || notice.eventId ? { choice: notice.guestRequestId ? 'Guest' : notice.packId ? 'Pack' : 'Event' } : {}), operationId: crypto.randomUUID() }
    pendingRead.current.set(notice.id, command); setReading(notice.id)
    try { await apiRequest('consultations/commands', command); pendingRead.current.delete(notice.id); setUncertainRead(null); setError('') }
    catch (failure) { setError(failure.message); if (failure.status && failure.status < 500) { pendingRead.current.delete(notice.id); setUncertainRead(null) } else setUncertainRead(notice.id) }
    finally { setReading(null) }
  }
  useEffect(() => {
    let active = true
    async function load() {
      try { const result = await apiRequest('consultations/notices'); if (active) { setNotices(result); setError('') } }
      catch { if (active) setError('Não foi possível atualizar os avisos de consultas.') }
    }
    const stop = observeResource('consultationNotices', load)
    return () => { active = false; stop() }
  }, [])
  function open(n) { return n.kind === 'NegativeBalance' ? onFinance() : n.kind === 'GuestRequest' ? onGuests() : n.eventId ? onEvent(n.eventId) : n.packId ? onPack(n.packId) : n.kind === 'FollowupMessage' || n.kind === 'Closed' || n.kind.startsWith('SharedReport:') ? (onFollowup || onOpen)(n.consultationId) : onOpen(n.consultationId) }
  if (client) return <div data-pending-command={reading || uncertainRead ? 'true' : undefined}>{error && <p role="alert" className="notice error">{error}</p>}{notices.length > 0 && <details className={styles.panel}><summary>Avisos de consultas ({notices.length})</summary>{notices.map(n => <article className={styles.notice} key={n.id}><div><h2>{({ Expired: 'Pedido expirado', Closed: 'Consulta fechada', FollowupMessage: 'Mensagem de acompanhamento', Approved: 'Consulta confirmada', NegativeBalance: 'Saldo por regularizar' })[n.kind.split(':')[0]] || 'Aviso de consulta'}</h2><p>{clientDescriptions[n.kind.split(':')[0]] || descriptions[n.kind.split(':')[0]] || 'Tens informação nova sobre a tua consulta.'}</p><p className={styles.date}>{agendaDate(n.dueAt)}</p><button type="button" className="text-button" onClick={() => open(n)}>Abrir na PaCT</button></div><button type="button" className="text-button" disabled={!!reading || !!uncertainRead && uncertainRead !== n.id} onClick={() => markRead(n)}>{uncertainRead === n.id ? 'Verificar leitura do aviso' : 'Marcar aviso como lido'}</button></article>)}</details>}</div>
  return <div aria-label="Avisos de consultas">{error && <p role="status">{error}</p>}{notices.map(n => <div className="notice review-alert" key={n.id}>
    <p>{descriptions[n.kind.split(':')[0]] || 'Existe informação nova sobre uma consulta.'}</p>
    <button className="text-button" onClick={() => n.kind === 'NegativeBalance' ? onFinance() : n.kind === 'GuestRequest' ? onGuests() : n.eventId ? onEvent(n.eventId) : n.packId ? onPack(n.packId) : n.kind === 'FollowupMessage' || n.kind === 'Closed' || n.kind.startsWith('SharedReport:') ? (onFollowup || onOpen)(n.consultationId) : onOpen(n.consultationId)}>{n.kind === 'NegativeBalance' ? 'Ver pagamentos e saldo' : n.kind === 'GuestRequest' || n.kind === 'EventGuestRequest' ? 'Analisar pedido' : n.eventId ? 'Ver evento' : n.packId ? 'Ver pack' : n.kind === 'FollowupMessage' ? 'Ver acompanhamento' : 'Ver consulta'}</button>
    {(n.guestRequestId || n.packId || n.eventId) && <button className="text-button" disabled={!!reading} onClick={() => markRead(n)}>Marcar como lido</button>}
  </div>)}</div>
}
