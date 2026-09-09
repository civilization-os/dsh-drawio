import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_DRAWIO, editDrawio, inspectDrawio, normalizeDrawio } from '../src/xml.js'

test('adds nodes and edges and exposes a structured inspection', () => {
  const xml = editDrawio(EMPTY_DRAWIO, [
    { type: 'add_node', id: 'client', label: 'Client', x: 40, y: 80 },
    { type: 'add_node', id: 'api', label: 'API', x: 260, y: 80 },
    { type: 'add_edge', id: 'client-api', source: 'client', target: 'api', label: 'HTTPS' },
  ])
  const view = inspectDrawio(xml)
  assert.equal(view.pages[0].nodes.length, 2)
  assert.deepEqual(view.pages[0].edges[0], {
    id: 'client-api', label: 'HTTPS', source: 'client', target: 'api',
    style: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;',
  })
  assert.match(xml, /compressed="false"/)
})

test('updates a node and removes connected edges', () => {
  const initial = editDrawio(EMPTY_DRAWIO, [
    { type: 'add_node', id: 'a', label: 'Old' },
    { type: 'add_node', id: 'b', label: 'B' },
    { type: 'add_edge', id: 'edge', source: 'a', target: 'b' },
  ])
  const updated = editDrawio(initial, [{ type: 'update', id: 'a', label: 'New', x: 90 }])
  assert.equal(inspectDrawio(updated).pages[0].nodes.find(node => node.id === 'a').label, 'New')
  const removed = editDrawio(updated, [{ type: 'delete', id: 'a' }])
  assert.equal(inspectDrawio(removed).pages[0].edges.length, 0)
})

test('accepts a bare mxGraphModel and wraps it as uncompressed drawio', () => {
  const xml = normalizeDrawio('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>')
  assert.match(xml, /^<mxfile/)
  assert.equal(inspectDrawio(xml).pages.length, 1)
})

test('rejects malformed XML and duplicate ids', () => {
  assert.throws(() => normalizeDrawio('<mxfile>'), /Invalid Draw.io XML/)
  assert.throws(() => editDrawio(EMPTY_DRAWIO, [{ type: 'add_node', id: '1' }]), /already exists/)
})
