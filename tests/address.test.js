import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDrawioAddress, relativeToWorkspace } from '../src/client/address.js'

test('parseDrawioAddress reads both scopes of the DSH file-address grammar', () => {
  // session scope, workspace-relative path
  assert.deepEqual(
    parseDrawioAddress('dsh-resource://file/session/sess-1/out/arch.drawio'),
    { scope: 'session', sessionId: 'sess-1', path: 'out/arch.drawio' },
  )

  // session scope, encoded separator inside one segment
  assert.deepEqual(
    parseDrawioAddress('dsh-resource://file/session/sess-1/docs%2Farchitecture.drawio'),
    { scope: 'session', sessionId: 'sess-1', path: 'docs/architecture.drawio' },
  )

  // session scope, unencoded deep directory
  assert.deepEqual(
    parseDrawioAddress('dsh-resource://file/session/sess-1/a/b/c/diagram.drawio'),
    { scope: 'session', sessionId: 'sess-1', path: 'a/b/c/diagram.drawio' },
  )

  // absolute scope: the leading slash and the scope survive, and the pane
  // session is the fallback that lets the canvas read the file at all.
  assert.deepEqual(
    parseDrawioAddress('dsh-resource://file/absolute/root/Drawio/out/arch.drawio', 'pane-session'),
    { scope: 'absolute', sessionId: 'pane-session', path: '/root/Drawio/out/arch.drawio' },
  )

  // absolute scope, Windows drive
  assert.deepEqual(
    parseDrawioAddress('dsh-resource://file/absolute/C:/proj/out/v2.drawio'),
    { scope: 'absolute', sessionId: '', path: 'C:/proj/out/v2.drawio' },
  )

  // absolute scope, UNC path keeps its empty first segment
  assert.deepEqual(
    parseDrawioAddress('dsh-resource://file/absolute//srv/share/x.drawio'),
    { scope: 'absolute', sessionId: '', path: '//srv/share/x.drawio' },
  )
})

test('parseDrawioAddress keeps a session-scoped absolute path absolute', () => {
  // `fileAddressFor` emits this shape whenever the workspace root is unknown,
  // so stripping the leading slash would silently address another file.
  assert.deepEqual(
    parseDrawioAddress('dsh-resource://file/session/s1//root/Drawio/out/arch.drawio'),
    { scope: 'session', sessionId: 's1', path: '/root/Drawio/out/arch.drawio' },
  )
})

test('parseDrawioAddress ignores query and fragment suffixes', () => {
  assert.deepEqual(
    parseDrawioAddress('dsh-resource://file/session/s1/out/arch.drawio?line=3#top'),
    { scope: 'session', sessionId: 's1', path: 'out/arch.drawio' },
  )
})

test('parseDrawioAddress rejects everything that is not a Draw.io file address', () => {
  assert.equal(parseDrawioAddress(undefined), null)
  assert.equal(parseDrawioAddress(''), null)
  assert.equal(parseDrawioAddress('   '), null)
  assert.equal(parseDrawioAddress('dsh-resource://file/session/sess-1/test.png'), null)
  // Forms outside the current grammar: no bare scope and no `file://` alias.
  assert.equal(parseDrawioAddress('dsh-resource://file/root.drawio', 'fallback-id'), null)
  assert.equal(parseDrawioAddress('file:///root/Drawio/arch.drawio'), null)
  assert.equal(parseDrawioAddress('sidebar://guide'), null)
})

test('relativeToWorkspace addresses a file under the workspace and refuses one outside it', () => {
  assert.equal(relativeToWorkspace('/root/Drawio/out/arch.drawio', '/root/Drawio'), 'out/arch.drawio')
  assert.equal(relativeToWorkspace('/root/Drawio/out/arch.drawio', '/root/Drawio/'), 'out/arch.drawio')
  assert.equal(relativeToWorkspace('/root/Drawio', '/root/Drawio'), '')
  assert.equal(relativeToWorkspace('/root/Drawio/out/arch.drawio', '/root/Other'), null)
  assert.equal(relativeToWorkspace('/root/DrawioOther/arch.drawio', '/root/Drawio'), null)
  assert.equal(relativeToWorkspace('/root/Drawio/arch.drawio', undefined), null)
  assert.equal(relativeToWorkspace(undefined, '/root/Drawio'), null)
})

test('relativeToWorkspace folds case for Windows and UNC roots only', () => {
  assert.equal(relativeToWorkspace('C:/Proj/Out/arch.drawio', 'c:/proj'), 'Out/arch.drawio')
  assert.equal(relativeToWorkspace('//Srv/Share/arch.drawio', '//srv/share'), 'arch.drawio')
  assert.equal(relativeToWorkspace('/Root/Drawio/arch.drawio', '/root/drawio'), null)
})
