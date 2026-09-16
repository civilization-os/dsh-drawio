import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_DRAWIO, editDrawio, inspectDrawio, normalizeDrawio, patchStyle, stripHtml } from '../src/xml.js'

test('adds nodes and edges and exposes a structured inspection', () => {
  const xml = editDrawio(EMPTY_DRAWIO, [
    { type: 'add_node', id: 'client', label: '<div><b>Client</b></div>', x: 40, y: 80 },
    { type: 'add_node', id: 'api', label: 'API', x: 260, y: 80 },
    { type: 'add_edge', id: 'client-api', source: 'client', target: 'api', label: 'HTTPS' },
  ])
  const view = inspectDrawio(xml)
  assert.equal(view.pages[0].nodes.length, 2)
  assert.equal(view.pages[0].nodes[0].plainText, 'Client')
  assert.deepEqual(view.pages[0].edges[0], {
    id: 'client-api', label: 'HTTPS', plainText: 'HTTPS', source: 'client', target: 'api',
    style: 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;',
  })
  assert.match(xml, /compressed="false"/)
})

test('updates a node with stylePatch and removes connected edges on delete', () => {
  const initial = editDrawio(EMPTY_DRAWIO, [
    { type: 'add_node', id: 'a', label: 'Old', style: 'rounded=1;fillColor=#ffffff;strokeColor=#000000;' },
    { type: 'add_node', id: 'b', label: 'B' },
    { type: 'add_edge', id: 'edge', source: 'a', target: 'b' },
  ])
  const updated = editDrawio(initial, [
    { type: 'update', id: 'a', label: 'New', x: 90, stylePatch: { fillColor: '#dae8fc' } },
  ])
  const nodeA = inspectDrawio(updated).pages[0].nodes.find(node => node.id === 'a')
  assert.equal(nodeA.label, 'New')
  assert.match(nodeA.style, /rounded=1/)
  assert.match(nodeA.style, /fillColor=#dae8fc/)
  assert.match(nodeA.style, /strokeColor=#000000/)

  const removed = editDrawio(updated, [{ type: 'delete', id: 'a' }])
  assert.equal(inspectDrawio(removed).pages[0].edges.length, 0)
})

test('manages multiple pages: add_page, rename_page, and delete_page', () => {
  const docWithPages = editDrawio(EMPTY_DRAWIO, [
    { type: 'add_page', id: 'page-deploy', name: '部署架构' },
    { type: 'rename_page', page: 0, name: '应用架构' },
  ])
  const view = inspectDrawio(docWithPages)
  assert.equal(view.pages.length, 2)
  assert.equal(view.pages[0].name, '应用架构')
  assert.equal(view.pages[1].name, '部署架构')
  assert.equal(view.pages[1].id, 'page-deploy')

  // 在新增的页面上添加节点
  const editedPage2 = editDrawio(docWithPages, [
    { type: 'add_node', id: 'k8s', label: 'K8s Cluster' },
  ], '部署架构')
  const view2 = inspectDrawio(editedPage2)
  assert.equal(view2.pages[1].nodes.length, 1)
  assert.equal(view2.pages[1].nodes[0].id, 'k8s')

  // 删除一个页面
  const deletedDoc = editDrawio(editedPage2, [
    { type: 'delete_page', page: 'page-deploy' },
  ])
  assert.equal(inspectDrawio(deletedDoc).pages.length, 1)
  assert.equal(inspectDrawio(deletedDoc).pages[0].name, '应用架构')
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

