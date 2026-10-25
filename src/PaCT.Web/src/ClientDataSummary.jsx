const genders = { Female: 'Feminino', Male: 'Masculino' }
const relationships = { Married: 'Casada', Separated: 'Separada', Partnered: 'Comprometida', Unpartnered: 'Sem compromisso', Widowed: 'Viúva' }

export default function ClientDataSummary({ data, hasAccount, showEmpty = true }) {
  const fields = [
    ['Nome', [data.firstName, data.lastName].filter(Boolean).join(' ')], ['Nome público', data.displayName],
    ['Email', data.email], ['Telefone', data.phone && `+${data.dialCode} ${data.phone}`],
    ['Localidade', data.locality], ['Data de nascimento', data.birthDate && data.birthDate.split('-').reverse().join('/')],
    ['Género', genders[data.gender]], ['Número de filhos', data.childrenCount], ['Situação pessoal', relationships[data.relationshipStatus]],
    ['Morada', data.address], ['Código postal', data.postalCode],
    ...(hasAccount === undefined ? [] : [['Conta de acesso', hasAccount ? 'Com conta' : 'Ficha sem conta']]),
  ]
  return <dl className="client-data-summary">{fields.filter(([, value]) => showEmpty || (value !== '' && value != null)).map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value === '' || value == null ? 'Não indicado' : value}</dd></div>)}</dl>
}
