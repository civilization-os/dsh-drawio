import test from 'node:test'
import assert from 'node:assert/strict'

function parseDrawioAddress(address, fallbackSessionId) {
  if (!address || typeof address !== 'string') return null
  try {
    let clean = address.trim()
    let parsedSessionId = ''

    if (clean.startsWith('dsh-resource://file/session/')) {
      const rest = clean.slice('dsh-resource://file/session/'.length)
      const slashIdx = rest.indexOf('/')
      if (slashIdx >= 0) {
        parsedSessionId = decodeURIComponent(rest.slice(0, slashIdx))
        clean = rest.slice(slashIdx + 1)
      } else {
        clean = rest
      }
    } else if (clean.startsWith('dsh-resource://file/')) {
      clean = clean.slice('dsh-resource://file/'.length)
    } else if (clean.startsWith('file:///')) {
      clean = clean.slice('file:///'.length)
    }

    let decodedPath = clean
    try {
      decodedPath = decodeURIComponent(clean)
    } catch {}

    decodedPath = decodedPath.replace(/\\/g, '/').replace(/^\/+/, '')

    if (!/\.drawio$/i.test(decodedPath)) return null
    if (decodedPath.includes('\0')) return null

    return {
      sessionId: parsedSessionId || fallbackSessionId || '',
      path: decodedPath,
    }
  } catch {
    return null
  }
}

test('parseDrawioAddress parses encoded and unencoded subdirectories correctly', () => {
  // 原先导致报错的用例：包含编码子目录 docs%2Farch.drawio
  const res1 = parseDrawioAddress('dsh-resource://file/session/sess-1/docs%2Farchitecture.drawio')
  assert.ok(res1)
  assert.equal(res1.sessionId, 'sess-1')
  assert.equal(res1.path, 'docs/architecture.drawio')

  // 未编码的深层目录
  const res2 = parseDrawioAddress('dsh-resource://file/session/sess-1/a/b/c/diagram.drawio')
  assert.ok(res2)
  assert.equal(res2.sessionId, 'sess-1')
  assert.equal(res2.path, 'a/b/c/diagram.drawio')

  // 无 session 前缀的地址
  const res3 = parseDrawioAddress('dsh-resource://file/root.drawio', 'fallback-id')
  assert.ok(res3)
  assert.equal(res3.sessionId, 'fallback-id')
  assert.equal(res3.path, 'root.drawio')

  // 非 drawio 文件应拒绝
  assert.equal(parseDrawioAddress('dsh-resource://file/session/sess-1/test.png'), null)
})
