import { dayKey } from './agendaTime'

export function latestAdultBirthDate(now = new Date()) {
  const [year, month, day] = dayKey(now).split('-').map(Number)
  const targetYear = year - 18
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate()
  return `${targetYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

export function validatePasswordFields(data) {
  if (data.password !== data.confirmPassword) throw new Error('As palavras-passe não coincidem.')
  if (data.password.length < 12 || !/\p{Ll}/u.test(data.password) || !/\p{Lu}/u.test(data.password) || !/\p{Nd}/u.test(data.password) || !/[^\p{L}\p{Nd}\s]/u.test(data.password))
    throw new Error('Usa 12 a 128 caracteres, com maiúscula, minúscula, algarismo e símbolo.')
}
