import AdaptiveSelect from './AdaptiveSelect'
import { useId, useRef, useState } from 'react'
import PhoneFields from './PhoneFields'

export default function ClientProfileForm({ client, manual = false, registration = false, requireBirthDate = false, busy, onSave }) {
  const data = client?.data || {}
  const [contactError, setContactError] = useState(false)
  const contactErrorId = useId()
  const contactErrorRef = useRef(null)
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
  return <form onSubmit={submit} className="client-form" data-protect-draft aria-describedby={contactError ? contactErrorId : undefined} onChange={event => {
    if (contactError && ['email', 'phone'].includes(event.target.name)) {
      const values = new FormData(event.currentTarget)
      if (registration ? values.get('phone')?.trim() : values.get('email')?.trim() || values.get('phone')?.trim()) setContactError(false)
    }
  }}>
    <div className="fields-grid">
      <label>Nome<input name="firstName" defaultValue={data.firstName || ''} maxLength="100" autoComplete="given-name" pattern={'.*\\S.*'} title="Preenche o nome, não apenas espaços." required /></label>
      <label>Apelido<input name="lastName" defaultValue={data.lastName || ''} maxLength="100" autoComplete="family-name" pattern={'.*\\S.*'} title="Preenche o apelido, não apenas espaços." required /></label>
      <label>Localidade{!manual && !registration && ' — para completar a ficha'}<input name="locality" defaultValue={data.locality || ''} maxLength="150" autoComplete="address-level2" pattern={'.*\\S.*'} title="Preenche a localidade, não apenas espaços." required={manual || registration} /></label>
      <label>Email<input name="email" type="email" defaultValue={data.email || ''} maxLength="256" readOnly={client?.hasAccount} autoComplete="email" required={registration} /></label>
      <PhoneFields data={data} required={registration} />
      <label>Data de nascimento — {requireBirthDate || registration ? 'obrigatória' : 'opcional'}<input name="birthDate" type="date" defaultValue={data.birthDate || ''} autoComplete="bday" required={requireBirthDate || registration} /></label>
      <label>Género{!registration && ' — para completar a ficha'}<AdaptiveSelect name="gender" defaultValue={data.gender || ''} required={registration}><option value="">{registration ? 'Seleciona o género' : 'Não indicado'}</option><option value="Female">Feminino</option><option value="Male">Masculino</option></AdaptiveSelect></label>
      <label>Número de filhos — opcional<input name="childrenCount" type="number" min="0" max="65535" step="1" defaultValue={data.childrenCount ?? ''} /></label>
      <label>Estado civil — opcional<AdaptiveSelect name="relationshipStatus" defaultValue={data.relationshipStatus || ''}>
        <option value="">Não indicado</option><option value="Married">Casada</option><option value="Separated">Separada</option><option value="Partnered">Comprometida</option><option value="Unpartnered">Sem compromisso</option><option value="Widowed">Viúva</option>
      </AdaptiveSelect></label>
      <label className="full-width">Morada — opcional<input name="address" defaultValue={data.address || ''} maxLength="1000" autoComplete="street-address" /></label>
      <label>Código postal — opcional<input name="postalCode" defaultValue={data.postalCode || ''} maxLength="30" autoComplete="postal-code" /></label>
      {(client?.hasAccount || registration) && <label>Nome público{registration && ' — opcional'}<input name="displayName" defaultValue={data.displayName || ''} maxLength="201" autoComplete="nickname" /></label>}
    </div>
    {client?.hasAccount && <p className="field-help">O email é o contacto de entrada. A sua alteração exige um procedimento de confirmação próprio, não uma substituição nesta ficha.</p>}
    {contactError && <div className="notice error" id={contactErrorId} role="alert" ref={contactErrorRef} tabIndex="-1">{registration ? 'Preenche o telefone.' : 'Indica pelo menos um contacto: email ou telefone.'}</div>}
    <button disabled={busy}>{busy ? 'A guardar…' : registration ? 'Receber email de confirmação' : manual ? 'Criar ficha sem conta' : 'Guardar dados'}</button>
  </form>
}
