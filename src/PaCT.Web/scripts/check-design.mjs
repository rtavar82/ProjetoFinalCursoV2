import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { inspectDesignCss } from './design-rules.mjs'

const root = fileURLToPath(new URL('../src/', import.meta.url)), tokens = new Set(), issues = []
postcss.parse(fs.readFileSync(path.join(root, 'design-tokens.css'), 'utf8')).walkDecls(decl => tokens.add(decl.prop))
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
else console.log('Base visual: fontes centralizadas, escala comum e ausência de sobreposições tipográficas locais verificadas.')
