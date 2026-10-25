import { useState } from 'react'

// Calling codes checked against ITU National Numbering Plans: https://www.itu.int/oth/t0202
const countries = [
  { id: 'PT', name: 'Portugal', dialCode: '351' },
  { id: 'ES', name: 'Espanha', dialCode: '34' },
  { id: 'FR', name: 'França', dialCode: '33' },
  { id: 'DE', name: 'Alemanha', dialCode: '49' },
  { id: 'IT', name: 'Itália', dialCode: '39' },
  { id: 'BE', name: 'Bélgica', dialCode: '32' },
  { id: 'NL', name: 'Países Baixos', dialCode: '31' },
  { id: 'CH', name: 'Suíça', dialCode: '41' },
  { id: 'LU', name: 'Luxemburgo', dialCode: '352' },
  { id: 'PL', name: 'Polónia', dialCode: '48' },
  { id: 'BR', name: 'Brasil', dialCode: '55' },
  { id: 'US', name: 'Estados Unidos', dialCode: '1' },
  { id: 'CO', name: 'Colômbia', dialCode: '57' },
  { id: 'AR', name: 'Argentina', dialCode: '54' },
  { id: 'PE', name: 'Peru', dialCode: '51' },
  { id: 'AO', name: 'Angola', dialCode: '244' },
  { id: 'MZ', name: 'Moçambique', dialCode: '258' },
  { id: 'CV', name: 'Cabo Verde', dialCode: '238' },
  { id: 'GB', name: 'Reino Unido (Inglaterra)', dialCode: '44' },
  { id: 'IE', name: 'Irlanda', dialCode: '353' },
]

export default function PhoneFields({ data = {}, required = false, codeFirst = false }) {
  const initialCountry = countries.find(country => country.dialCode === data.dialCode)
  const [countryId, setCountryId] = useState(initialCountry?.id || (data.dialCode ? 'Other' : 'PT'))
  const [customDialCode, setCustomDialCode] = useState(data.dialCode && !initialCountry ? `+${data.dialCode}` : '')
  const [hasPhone, setHasPhone] = useState(Boolean(data.phone?.trim()))
  const selectedCountry = countries.find(country => country.id === countryId)

  return <>
    <label>País / indicativo<select aria-label="País / indicativo" value={countryId} onChange={event => setCountryId(event.target.value)}>
      {countries.map(country => <option key={country.id} value={country.id}>{codeFirst ? `+${country.dialCode} · ${country.name}` : `${country.name} (+${country.dialCode})`}</option>)}
      <option value="Other">Outro</option>
    </select></label>
    {selectedCountry
      ? <input name="dialCode" type="hidden" value={selectedCountry.dialCode} />
      : <label>Indicativo — outro país<input name="dialCode" type="tel" value={customDialCode} onChange={event => setCustomDialCode(event.target.value)} onBlur={() => { if (/^[0-9]{1,3}$/.test(customDialCode)) setCustomDialCode(`+${customDialCode}`) }} maxLength="4" pattern="\+?[0-9]{1,3}" title="Indicativo com 1 a 3 algarismos, por exemplo +61." placeholder="+…" required={required || hasPhone} inputMode="tel" autoComplete="tel-country-code" /></label>}
    <label>Telefone<input name="phone" type="tel" defaultValue={data.phone || ''} maxLength="40" pattern={required || hasPhone ? '.*[0-9].*' : undefined} title="Preenche o telefone com o teu número." required={required} onChange={event => setHasPhone(Boolean(event.target.value.trim()))} inputMode="tel" autoComplete="tel-national" /></label>
  </>
}
