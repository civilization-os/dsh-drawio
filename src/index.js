import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { editDrawio, inspectDrawio, normalizeDrawio } from './xml.js'

export const name = 'dsh-drawio'
export const inject = ['tools', 'fs', 'sandbox', 'webServer']

const runtimeRoot = fileURLToPath(new URL('../vendor/drawio/', import.meta.url))
const output = {
  schema: { type: 'object', additionalProperties: true, properties: {} },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}
const pathParameter = { type: 'string', required: true, description: 'Path to a .drawio file, relative to the current DSH workspace or absolute within the allowed workspace.' }

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-drawio/runtime', handler: serveRuntime }))
  register(ctx, defineTool({
    name: 'drawio_inspect',
    description: 'Read a Draw.io file as structured pages, nodes, edges and geometry. Use this before editing an existing diagram. Set include_xml only when raw XML details are required.',
    parameters: { path: pathParameter, include_xml: { type: 'boolean' } },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { text, target } = await readDiagram(ctx, args.path, exec)
      return { path: target.displayPath, ...inspectDrawio(text, args.include_xml === true) }
    },
  }))
  register(ctx, defineTool({
    name: 'drawio_edit',
    description: 'Apply a batch of semantic edits to an existing .drawio file. Supported operations are add_node, add_edge, update and delete. Cell ids must be stable and unique. Inspect the file first when modifying an existing diagram.',
    parameters: {
      path: pathParameter,
      page: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      operations: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['add_node', 'add_edge', 'update', 'delete'], required: true },
            id: { type: 'string', required: true }, label: { type: 'string' }, style: { type: 'string' }, parent: { type: 'string' },
            source: { type: 'string' }, target: { type: 'string' },
            x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
          },
        },
      },
    },
    output,
    async execute(args, exec) {
      const { text, target } = await readDiagram(ctx, args.path, exec)
      const xml = editDrawio(text, args.operations, args.page)
      const outcome = await writeDiagram(ctx, target, xml, args, exec)
      return { path: target.displayPath, operation: outcome.operation, operationsApplied: args.operations.length, ...inspectDrawio(xml, false) }
    },
  }))
  register(ctx, defineTool({
    name: 'drawio_write',
    description: 'Validate and write a complete Draw.io mxfile or mxGraphModel XML document. Prefer drawio_edit for targeted changes. The saved document is normalized to uncompressed XML for reliable AI edits and Git diffs.',
    parameters: { path: pathParameter, xml: { type: 'string', required: true } },
    output,
    async execute(args, exec) {
      assertDrawioPath(args.path)
      const policy = await ctx.sandbox.resolvePolicy('write', args, exec)
      const target = await ctx.fs.resolve(args.path, resolveOptions(exec, args.path, policy?.workspaceRoot))
      const xml = normalizeDrawio(args.xml)
      const outcome = await writeDiagram(ctx, target, xml, args, exec, policy)
      return { path: target.displayPath, operation: outcome.operation, ...inspectDrawio(xml, false) }
    },
  }))
}

function register(ctx, tool) {
  ctx.effect(() => ctx.tools.register(tool))
}

async function readDiagram(ctx, requestedPath, exec) {
  assertDrawioPath(requestedPath)
  const target = await ctx.fs.resolve(requestedPath, resolveOptions(exec, requestedPath))
  const info = await ctx.fs.stat(target, exec.signal)
  if (!info) throw new Error(`Draw.io file not found: ${target.displayPath}`)
  if (info.type !== 'file') throw new Error(`Not a regular file: ${target.displayPath}`)
  const text = await ctx.fs.readText(target, exec.signal)
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return { target, text }
}

async function writeDiagram(ctx, target, xml, args, exec, resolvedPolicy) {
  const policy = resolvedPolicy ?? await ctx.sandbox.resolvePolicy('write', args, exec)
  const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
  const outcome = await ctx.fs.writeText(target, xml, intent, exec.signal, policy)
  ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
  return outcome
}

function resolveOptions(exec, requestedPath, workspaceRoot) {
  const cwd = workspaceRoot ?? exec.agent?.session.header.cwd
  return { ...(cwd ? { cwd } : {}), signal: exec.signal }
}

function assertDrawioPath(value) {
  if (typeof value !== 'string' || !/\.drawio$/i.test(value)) throw new Error('path must end with .drawio')
}

async function serveRuntime(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const prefix = '/dsh-drawio/runtime'
    const requested = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^[/\\]+/, '') || 'index.html'
    const candidate = normalize(join(runtimeRoot, requested))
    const rel = relative(runtimeRoot, candidate)
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) return respond(res, 403, 'Forbidden')
    const info = await stat(candidate)
    if (!info.isFile()) return respond(res, 404, 'Not found')
    res.statusCode = 200
    res.setHeader('Content-Type', mimeType(candidate))
    res.setHeader('Content-Length', info.size)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'")
    if (req.method === 'HEAD') return res.end()
    createReadStream(candidate).on('error', () => respond(res, 500, 'Read failed')).pipe(res)
  } catch {
    respond(res, 404, 'Not found')
  }
}

function respond(res, status, message) {
  if (res.headersSent) return res.end()
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(message)
}

function mimeType(path) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2' })[extname(path).toLowerCase()] || 'application/octet-stream'
}
