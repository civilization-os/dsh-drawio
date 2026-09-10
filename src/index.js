import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { editDrawio, inspectDrawio, normalizeDrawio } from './xml.js'

export const name = 'dsh-drawio'
export const inject = ['tools', 'fs', 'sandbox', 'webServer']

const runtimeRoot = fileURLToPath(new URL('../vendor/drawio/', import.meta.url))
const MAX_DIAGRAM_BYTES = 10 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_DIAGRAM_BYTES + 64 * 1024
const output = {
  schema: { type: 'object', additionalProperties: true, properties: {} },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}
const pathParameter = { type: 'string', required: true, description: 'Path to a .drawio file, relative to the current DSH workspace or absolute within the allowed workspace.' }

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-drawio/runtime', handler: serveRuntime }))
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-drawio/api', handler: (req, res) => serveCanvasApi(ctx, req, res) }))
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

async function serveCanvasApi(ctx, req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.end()
    return
  }
  if (req.method !== 'POST') return respondJson(res, 405, { ok: false, error: { message: 'Method Not Allowed' } })
  try {
    const pathname = new URL(req.url || '/', 'http://dsh.internal').pathname
    const method = pathname.slice('/dsh-drawio/api/'.length)
    if (!['read', 'write'].includes(method)) return respondJson(res, 404, { ok: false, error: { message: 'Unknown Draw.io operation.' } })
    const payload = await readJsonBody(req)
    const target = await resolveCanvasTarget(ctx, payload.cwd, payload.path)
    const info = await ctx.fs.stat(target)
    if (!info || info.type !== 'file') throw new Error('Draw.io file was not found.')
    if (Number(info.size) > MAX_DIAGRAM_BYTES) throw new Error('Draw.io file is too large to open safely.')
    if (method === 'read') return respondJson(res, 200, { ok: true, value: { content: await ctx.fs.readText(target) } })
    if (typeof payload.content !== 'string' || Buffer.byteLength(payload.content) > MAX_DIAGRAM_BYTES) throw new Error('Draw.io content is too large to save safely.')
    const xml = normalizeDrawio(payload.content)
    const sandboxPolicy = { mode: 'workspace-write', workspaceRoot: payload.cwd }
    await ctx.fs.writeText(target, xml, { kind: 'replaceIfVersion', version: info.version }, undefined, sandboxPolicy)
    return respondJson(res, 200, { ok: true, value: { ok: true } })
  } catch (error) {
    return respondJson(res, 400, { ok: false, error: { message: String(error?.message || error).slice(0, 500) } })
  }
}

async function resolveCanvasTarget(ctx, cwd, path) {
  if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('A workspace is required.')
  assertDrawioPath(path)
  const [root, target] = await Promise.all([ctx.fs.resolve(cwd), ctx.fs.resolve(path, { cwd })])
  if (!ctx.fs.contains(root, target)) throw new Error('Draw.io file must stay inside the current workspace.')
  return target
}

async function readJsonBody(req) {
  const declared = Number(req.headers?.['content-length'])
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error('Request body is too large.')
  const chunks = []; let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new Error('Request body is too large.')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  const value = text ? JSON.parse(text) : {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Request body must be a JSON object.')
  return value
}

function respondJson(res, status, value) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
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
