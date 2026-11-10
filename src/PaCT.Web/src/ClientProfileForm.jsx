import CalendarInput from './CalendarInput'
import AdaptiveSelect from './AdaptiveSelect'
import { Fragment, useId, useRef, useState } from 'react'
import ActionButton from './ActionButton'
import PhoneFields from './PhoneFields'

const defaultOrder = ['firstName', 'lastName', 'locality', 'email', 'phone', 'birthDate', 'gender', 'childrenCount', 'relationshipStatus', 'address', 'postalCode', 'displayName']
const personalOrder = ['firstName', 'displayName', 'lastName', 'email', 'phone', 'birthDate', 'gender', 'childrenCount', 'relationshipStatus', 'address', 'postalCode', 'locality']

export default function ClientProfileForm({ client, manual = false, registration = false, personal = false, busy, onSave }) {
  const data = client?.data || {}
  const [contactError, setContactError] = useState(false)
  const contactErrorId = useId()
  const contactErrorRef = useRef(null)
  const publicNameHelpId = useId()
  const requirePersonalDetails = personal || registration
  function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    for (const key of Object.keys(values)) if (values[key] === '') values[key] = null
    values.childrenCount = values.childrenCount === null ? null : Number(values.childrenCount)
    if (client?.hasAccount) values.email = data.email
    if (!client?.hasAccount && !registration) values.displayName = null
    if (registration ? !values.phone?.trim() : !values.email?.trim() && !values.phone?.trim()) {
      setContactError(true)
      requestAnimationFrame(() => contactErrorRef.current?.focus())
      return
    }
    setContactError(false)
    onSave(registration ? values : { data: values, version: client?.version || 0 })
  }
  const phoneFields = <PhoneFields data={data} required={registration} />
  const fields = {
    firstName: <label>{personal ? 'Primeiro nome' : 'Nome'}<input name="firstName" defaultValue={data.firstName || ''} maxLength="100" autoComplete="given-name" pattern={'.*\\S.*'} title="Preenche o nome, não apenas espaços." required /></label>,
    lastName: <label>Apelido<input name="lastName" defaultValue={data.lastName || ''} maxLength="100" autoComplete="family-name" pattern={'.*\\S.*'} title="Preenche o apelido, não apenas espaços." required /></label>,
    locality: <label>Localidade{personal ? ' — obrigatória' : !manual && !registration && ' — para completar a ficha'}<input name="locality" defaultValue={data.locality || ''} maxLength="150" autoComplete="address-level2" pattern={'.*\\S.*'} title="Preenche a localidade, não apenas espaços." required={manual || requirePersonalDetails} /></label>,
    email: <label>Email<input name="email" type="email" defaultValue={data.email || ''} maxLength="256" readOnly={client?.hasAccount} autoComplete="email" required={registration} /></label>,
    phone: personal ? <div className="fields-grid full-width">{phoneFields}</div> : phoneFields,
    birthDate: <label>Data de nascimento — {requirePersonalDetails ? 'obrigatória' : 'opcional'}<CalendarInput name="birthDate" type="date" defaultValue={data.birthDate || ''} autoComplete="bday" required={requirePersonalDetails} /></label>,
    gender: <label>Género{personal ? ' — obrigatório' : !registration && ' — para completar a ficha'}<AdaptiveSelect name="gender" defaultValue={data.gender || ''} required={requirePersonalDetails}><option value="">{requirePersonalDetails ? 'Seleciona o género' : 'Não indicado'}</option><option value="Female">Feminino</option><option value="Male">Masculino</option></AdaptiveSelect></label>,
    childrenCount: <label>Número de filhos — opcional<input name="childrenCount" type="number" min="0" max="65535" step="1" defaultValue={data.childrenCount ?? ''} /></label>,
    relationshipStatus: <label>Estado civil — opcional<AdaptiveSelect name="relationshipStatus" defaultValue={data.relationshipStatus || ''}>
      <option value="">Não indicado</option><option value="Married">Casada</option><option value="Separated">Separada</option><option value="Partnered">Comprometida</option><option value="Unpartnered">Sem compromisso</option><option value="Widowed">Viúva</option>
    </AdaptiveSelect></label>,
    address: <label className="full-width">Morada — opcional<input name="address" defaultValue={data.address || ''} maxLength="1000" autoComplete="street-address" /></label>,
    postalCode: <label>Código postal — opcional<input name="postalCode" defaultValue={data.postalCode || ''} maxLength="30" autoComplete="postal-code" /></label>,
    displayName: (client?.hasAccount || registration) && <div>
      <label>{personal ? 'Nome nas Partilhas — opcional' : registration ? 'Nome público — opcional' : 'Nome público'}
        <input name="displayName" defaultValue={data.displayName || ''} maxLength="201" autoComplete="nickname" aria-describedby={personal ? publicNameHelpId : undefined} />
      </label>
      {personal && <p className="field-help" id={publicNameHelpId}>Escolhe o nome que queres mostrar nas Partilhas. Se deixares este campo vazio, aparece «Conta PaCT».</p>}
    </div>,
  }

  return <form onSubmit={submit} className="client-form" data-protect-draft aria-describedby={contactError ? contactErrorId : undefined} onChange={event => {
    if (contactError && ['email', 'phone'].includes(event.target.name)) {
      const values = new FormData(event.currentTarget)
      if (registration ? values.get('phone')?.trim() : values.get('email')?.trim() || values.get('phone')?.trim()) setContactError(false)
    }
  }}>
    <div className="fields-grid">
      {(personal ? personalOrder : defaultOrder).map(name => <Fragment key={name}>{fields[name]}</Fragment>)}
    </div>
    {client?.hasAccount && <p className="field-help">O email é o contacto de entrada. A sua alteração exige um procedimento de confirmação próprio, não uma substituição nesta ficha.</p>}
    {contactError && <div className="notice error" id={contactErrorId} role="alert" ref={contactErrorRef} tabIndex="-1">{registration ? 'Preenche o telefone.' : 'Indica pelo menos um contacto: email ou telefone.'}</div>}
    <ActionButton type="submit" disabled={busy}>{busy ? 'A guardar…' : registration ? 'Receber email de confirmação' : manual ? 'Criar ficha sem conta' : 'Guardar dados'}</ActionButton>
  </form>
}
