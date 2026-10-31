const requestNotice = 'Enviar este pedido não confirma já a marcação: o horário precisa de ser validado pela terapeuta.'

export function individualRequestNotice(paymentMode, { visitor = false } = {}) {
  if (paymentMode === 'Prepayment') return 'Esta consulta prevê pagamento antecipado. Se o horário for validado, ' +
    (visitor ? 'a terapeuta combina contigo o pagamento e as condições para aceitar ou cancelar.' : 'recebes o pedido de pagamento e as condições para aceitar ou cancelar.') +
    ' Enviar este pedido não confirma já a marcação.'
  if (paymentMode === 'Contribution') return requestNotice + ' Escolhes a tua contribuição e pagas depois da consulta.'
  if (paymentMode === 'Free' || paymentMode === 'Gift') return requestNotice + ' Esta consulta não tem pagamento.'
  if (paymentMode === 'Postpayment') return requestNotice + ' O pagamento é feito depois da consulta.'
  return requestNotice + ' Após validação, recebes as condições aplicáveis à consulta.'
}
