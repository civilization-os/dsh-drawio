import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { apply } from '../src/index.js'

function createMockContext() {
  const handlers = new Map()
  const writtenFiles = []
  const ctx = {
    webServer: {
      register({ path, handler }) {
        handlers.set(path, handler)
      },
    },
    tools: {
      register() {},
    },
    fs: {
      async resolve(targetPath, opts) {
        const cwd = opts?.cwd ?? 'D:/workspace'
        if (targetPath.startsWith('/') || /^[a-zA-Z]:/.test(targetPath)) {
          return { displayPath: targetPath, raw: targetPath }
        }
        const combined = `${cwd.replace(/[\\/]+$/, '')}/${targetPath.replace(/^[\\/]+/, '')}`
        return { displayPath: combined, raw: combined }
      },
      contains(root, target) {
        return target.raw.startsWith(root.raw)
      },
      async stat(target) {
        return { type: 'file', size: 100, version: '1' }
      },
      async writeFile(target, buffer, options, signal, policy) {
        writtenFiles.push({ target: target.displayPath, buffer, policy })
        return { version: '2' }
      },
      async writeText(target, text) {
        writtenFiles.push({ target: target.displayPath, text })
        return { version: '2' }
      },
      async readText() {
        return '<mxfile><diagram>test</diagram></mxfile>'
      },
    },
    effect(fn) { fn() },
    emit() {},
  }
  apply(ctx)
  return { handlers, writtenFiles }
}

function mockRequest(method, url, payload) {
  const json = JSON.stringify(payload)
  const req = Readable.from([Buffer.from(json)])
  req.method = method
  req.url = url
  req.headers = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(json)),
  }
  return req
}

function mockResponse() {
  let statusCode = 200
  const headers = {}
  const chunks = []
  return {
    get statusCode() { return statusCode },
    set statusCode(code) { statusCode = code },
    setHeader(name, val) { headers[name.toLowerCase()] = val },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk))
    },
    get body() {
      const buf = Buffer.concat(chunks)
      try { return JSON.parse(buf.toString('utf8')) } catch { return buf.toString('utf8') }
    },
  }
}

test('save-image endpoint decodes base64 data and writes image safely to workspace', async () => {
  const { handlers, writtenFiles } = createMockContext()
  const apiHandler = handlers.get('/dsh-drawio/api')
  assert.ok(apiHandler, 'API handler should be registered')

  const sampleBase64 = Buffer.from('fake-png-binary-data').toString('base64')
  const req = mockRequest('POST', '/dsh-drawio/api/save-image', {
    cwd: 'D:/workspace',
    path: 'sub/architecture.png',
    data: `data:image/png;base64,${sampleBase64}`,
  })
  const res = mockResponse()
  await apiHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(writtenFiles.length, 1)
  assert.equal(writtenFiles[0].target, 'D:/workspace/sub/architecture.png')
  assert.equal(writtenFiles[0].buffer.toString(), 'fake-png-binary-data')
})

test('save-image rejects invalid image extensions and path traversal', async () => {
  const { handlers } = createMockContext()
  const apiHandler = handlers.get('/dsh-drawio/api')

  // 非图片后缀拒绝
  const reqBadExt = mockRequest('POST', '/dsh-drawio/api/save-image', {
    cwd: 'D:/workspace',
    path: 'sub/architecture.exe',
    data: 'data:image/png;base64,Zm9v',
  })
  const resBadExt = mockResponse()
  await apiHandler(reqBadExt, resBadExt)
  assert.equal(resBadExt.statusCode, 400)
  assert.match(resBadExt.body.error.message, /path must end with \.png or \.svg/)

  // 路径穿越越出 workspace
  const reqEscape = mockRequest('POST', '/dsh-drawio/api/save-image', {
    cwd: 'D:/workspace',
    path: 'C:/Windows/system32/evil.png',
    data: 'data:image/png;base64,Zm9v',
  })
  const resEscape = mockResponse()
  await apiHandler(reqEscape, resEscape)
  assert.equal(resEscape.statusCode, 400)
  assert.match(resEscape.body.error.message, /File must stay inside the current workspace/)
})
