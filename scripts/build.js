import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const result = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
})

await mkdir('lib', { recursive: true })
await writeFile(
  'lib/client.js',
  'window.__ModuleLoader__.load({id:"@civilization/dsh-drawio",factory:(require)=>{\n' +
    'var module={exports:{}};var exports=module.exports;\n' +
    result.outputFiles[0].text +
    '\nreturn module.exports;}});\n',
)
