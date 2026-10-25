export function validatePasswordFields(data) {
  if (data.password !== data.confirmPassword) throw new Error('As palavras-passe não coincidem.')
  if (data.password.length < 12 || !/\p{Ll}/u.test(data.password) || !/\p{Lu}/u.test(data.password) || !/\p{Nd}/u.test(data.password) || !/[^\p{L}\p{Nd}\s]/u.test(data.password))
    throw new Error('Usa 12 a 128 caracteres, com maiúscula, minúscula, algarismo e símbolo.')
}
