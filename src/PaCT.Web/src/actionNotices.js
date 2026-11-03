export const FLOATING_NOTICE = 'pact:floating-notice'

export function dismissSuccess() {
  window.dispatchEvent(new CustomEvent(FLOATING_NOTICE, { detail: { dismissSuccess: true } }))
}

export function showSuccess(message, key) {
  if (message) window.dispatchEvent(new CustomEvent(FLOATING_NOTICE, { detail: { message, kind: 'success', key } }))
}

export function showWarning(message, key) {
  if (message) window.dispatchEvent(new CustomEvent(FLOATING_NOTICE, { detail: { message, kind: 'warning', key } }))
}

const messages = {
  Request: 'Pedido enviado. Aguarda a confirmação da terapeuta.',
  Approve: 'Marcação aprovada.', LinkGuestRequest: 'Pedido aprovado e marcação confirmada.',
  Reject: 'Pedido recusado.', RejectGuestRequest: 'Pedido recusado.',
  Manual: 'Marcação manual confirmada.', PublishAvailability: 'Horários publicados.',
  Accept: 'Condições aceites.', AcceptParticipationConditions: 'Condições da inscrição aceites.',
  DeclarePayment: 'Pagamento comunicado à terapeuta. Aguarda a confirmação do recebimento.',
  Receipt: 'Recebimento registado em crédito.', Refund: 'Devolução registada.',
  Settle: 'Liquidação registada.', UseAuthorizedCredit: 'Crédito aplicado ao pagamento da consulta.',
  Adjustment: 'Correção financeira registada.', ReverseAdjustment: 'Anulação da correção financeira registada.',
  ReverseReceipt: 'Anulação do recebimento registada.', ReverseRefund: 'Anulação da devolução registada.',
  MoveToOldDebts: 'Consulta enviada para Dívidas antigas. A dívida mantém-se.',
  Release: 'Horário disponibilizado.', Keep: 'Horário mantido bloqueado.',
  Archive: 'Registo enviado para o histórico.', ArchiveGuestRequest: 'Pedido enviado para o histórico.', ArchiveParticipation: 'Inscrição enviada para o histórico.',
  SendMessage: 'Mensagem enviada.', BlockConversation: 'Conversa encerrada.', UnblockConversation: 'Conversa reaberta.',
  ReadMessages: 'Mensagens marcadas como vistas.', ReadNotice: 'Aviso marcado como visto.', ReadDomainNotice: 'Aviso marcado como visto.', ReadMessageNotice: 'Mensagens marcadas como vistas.', ReadBalanceNotice: 'Aviso marcado como visto.',
  JoinEvent: 'Inscrição confirmada.', LinkEventGuest: 'Pedido de inscrição aprovado.', RejectEventGuest: 'Pedido de inscrição recusado.',
  CancelParticipation: 'Inscrição cancelada.', CancelEvent: 'Evento cancelado.', SaveEvent: 'Evento guardado.', PerformEvent: 'Realização do evento registada.',
  CloseParticipation: 'Participação fechada.',
  SettleParticipation: 'Liquidação da participação registada.', UseParticipationCredit: 'Crédito aplicado ao pagamento da participação.',
  DeclareParticipationPayment: 'Pagamento comunicado à terapeuta. Aguarda a confirmação do recebimento.',
  RegisterParticipation: 'Entrada registada. Confirma agora a presença e o fecho individual.',
  ConfirmParticipation: 'Inscrição confirmada.', ReleaseEventBlock: 'Horário do evento disponibilizado.',
  PurchasePack: 'Compra de pack registada.', SettlePack: 'Pagamento do pack liquidado.', AuthorizePackUse: 'Utilização do pack autorizada.',
  SetPackValidity: 'Data de revisão do pack guardada.', ExtendPack: 'Revisão do pack guardada.', WithdrawPackSessions: 'Retirada de sessões registada.', ReversePackUse: 'Sessão de pack reposta.',
}

export function announceOperation(command, result, { client = false } = {}) {
  let message = messages[command.action]
  if (command.action === 'Receipt' && ['Contribuição recebida e consulta paga.', 'Contribuição recebida e participação paga.'].includes(result.message)) message = result.message
  if (command.action === 'Reject' || command.action === 'RejectGuestRequest') message = client ? 'Desistência do pedido confirmada.' : 'Pedido recusado.'
  if (command.action === 'Cancel') message = 'Marcação cancelada.'
  if (command.action === 'Close') message = command.choice === 'Performed' ? 'Consulta realizada e fecho registado.' : command.choice === 'NoShow' ? 'Falta à consulta registada.' : 'Cancelamento registado.'
  if (command.action === 'JoinEvent' && command.choice === 'Waiting') message = 'Inscrição colocada em espera.'
  if (command.action === 'CloseParticipation') message = command.choice === 'NoShow' ? 'Falta à participação registada.' : command.choice === 'Withdrawn' ? 'Desistência durante o retiro registada.' : 'Participação realizada e fecho registado.'
  // Other domain commands already return their specific confirmed result (packs, corrections, returns).
  if (!message && result.message !== 'Operação concluída.') message = result.message
  showSuccess(message || 'Alteração guardada.', command.operationId)
}
