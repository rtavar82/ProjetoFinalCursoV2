import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { inspectDesignCss } from './design-rules.mjs'

const root = fileURLToPath(new URL('../src/', import.meta.url)), tokens = new Set(), issues = []
const designTokens = postcss.parse(fs.readFileSync(path.join(root, 'design-tokens.css'), 'utf8'))
designTokens.walkDecls(decl => tokens.add(decl.prop))
function luminance(value) {
  if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return NaN
  const hex = value.length === 4 ? [...value.slice(1)].map(c => c + c).join('') : value.slice(1)
  const channels = hex.match(/../g).map(pair => {
    const channel = parseInt(pair, 16) / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
function values(selector) {
  const result = {}
  designTokens.walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(decl => { result[decl.prop] = decl.value })
  })
  return result
}
for (const theme of ['sage', 'rose', 'lavender']) {
  const palette = values(`[data-visual-theme='${theme}']`)
  const surface = values('[data-visual-theme]')['--surface']
  const inverse = values(':root')['--surface-inverse-text']
  for (const [text, background] of [
    ['ink', palette['--theme-paper']], ['ink', surface], ['ink', palette['--theme-start']], ['ink', palette['--theme-end']],
    ['action', surface], ['action', palette['--theme-tint']],
  ]) {
    const a = luminance(palette['--theme-' + text]), b = luminance(background)
    if (!((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5)) issues.push(`Tema ${theme}: contraste insuficiente para ${text} sobre ${background}.`)
  }
  const a = luminance(inverse), b = luminance(palette['--theme-action'])
  if (!((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5)) issues.push(`Tema ${theme}: contraste insuficiente na ação principal.`)
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (file.endsWith('.css')) {
      try { issues.push(...inspectDesignCss(fs.readFileSync(file, 'utf8'), path.relative(root, file).replaceAll('\\', '/'), tokens)) }
      catch (failure) { issues.push(failure.message) }
    }
  }
}
walk(root)
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1 }
else console.log('Base visual: fontes, escala, tokens protegidos e contraste dos três temas verificados.')
