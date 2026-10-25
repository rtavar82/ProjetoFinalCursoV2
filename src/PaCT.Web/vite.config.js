import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))
function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry =>
    entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : [join(directory, entry.name)])
}
const hash = createHash('sha256')
for (const file of [...sourceFiles(join(projectRoot, 'src')), ...sourceFiles(join(projectRoot, 'public')), join(projectRoot, 'index.html'), join(projectRoot, 'package-lock.json')]) hash.update(readFileSync(file))
const version = hash.digest('hex').slice(0, 20)

const publicOffline = {
  name: 'pact-public-offline', enforce: 'post', apply: 'build',
  generateBundle(_, bundle) {
    const assets = Object.keys(bundle).filter(file => file.startsWith('assets/') && /\.(js|css|woff2|png|svg)$/.test(file)).map(file => '/' + file)
    const precache = ['/', '/favicon.svg', '/manifest.webmanifest', '/app-icon.svg', '/app-icon-192.png', '/app-icon-512.png', ...sourceFiles(join(projectRoot, 'public/presentation')).map(file => '/presentation/' + file.split(/[\\/]/).pop()), ...assets]
    const storage = readFileSync(join(projectRoot, 'src/publicStorage.js'), 'utf8').replaceAll('export ', '')
    const worker = readFileSync(join(projectRoot, 'src/service-worker.js'), 'utf8').replace('__BUILD_ID__', version).replace("['__PRECACHE__']", JSON.stringify(precache))
    this.emitFile({ type: 'asset', fileName: 'service-worker.js', source: storage + '\n' + worker })
  },
}
export default defineConfig({
  define: { 'import.meta.env.PACT_BUILD_ID': JSON.stringify(version) },
  plugins: [react(), publicOffline],
})
