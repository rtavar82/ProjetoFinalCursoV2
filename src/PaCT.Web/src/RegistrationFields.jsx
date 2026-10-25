import PasswordField from './PasswordField'

const fields = [
  ['firstName', 'Primeiro nome', 'text', 'given-name', 100],
  ['lastName', 'Último nome', 'text', 'family-name', 100],
  ['locality', 'Localidade', 'text', 'address-level2', 150],
  ['displayName', 'Nome público', 'text', 'nickname', 201],
  ['email', 'Email', 'email', 'email', 256],
  ['password', 'Palavra-passe', 'password', 'new-password', 128],
  ['confirmPassword', 'Confirmar palavra-passe', 'password', 'new-password', 128],
]

export default function RegistrationFields({ includeEmail = true }) {
  return <><div className="fields-grid">{fields.filter(([name]) => includeEmail || name !== 'email').map(([name, label, type, autocomplete, length]) =>
    type === 'password' ? <PasswordField key={name} label={label} name={name} autoComplete={autocomplete} maxLength={length} minLength={12} required /> : <label key={name} className={['email', 'displayName', 'locality'].includes(name) ? 'full-width' : ''}>{label}<input name={name} type={type} autoComplete={autocomplete} maxLength={length} pattern={['firstName', 'lastName'].includes(name) ? '.*\\S.*' : undefined} required /></label>)}</div>
    <p className="field-help">Palavra-passe: 12–128 caracteres, com maiúscula, minúscula, algarismo e símbolo. O nome público pode ser visto por outros utilizadores; é separado dos nomes privados.</p></>
}
