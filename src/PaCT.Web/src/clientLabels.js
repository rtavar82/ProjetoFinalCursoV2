export function clientAccountStateLabel(state) {
  return ({ Active: 'Acesso ativo', ConfirmEmail: 'Email por confirmar', SetPassword: 'Palavra-passe por definir', Closed: 'Conta encerrada' })[state] || state
}
