export async function validateJpegPng(file, maximumMegabytes = 4) {
  if (!['image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > maximumMegabytes * 1024 * 1024)
    throw new Error(`Usa JPEG ou PNG, até ${maximumMegabytes} MB por fotografia.`)
  const image = await createImageBitmap(file).catch(() => { throw new Error('Não foi possível abrir esta fotografia.') })
  const valid = image.width <= 8000 && image.height <= 8000 && image.width * image.height <= 24000000
  image.close()
  if (!valid) throw new Error('Cada fotografia pode ter até 8000 píxeis por lado e 24 megapíxeis.')
}
