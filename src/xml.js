import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import pako from 'pako'

const serializer = new XMLSerializer()

export const EMPTY_DRAWIO = '<mxfile host="DSH" compressed="false"><diagram id="page-1" name="Page-1"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'

export function inspectDrawio(source, includeXml = false) {
  const document = parseDrawio(source || EMPTY_DRAWIO)
  const pages = pageNodes(document).map((page, index) => {
    const model = modelForPage(page)
    const cells = Array.from(model.getElementsByTagName('mxCell'))
    return {
      index,
      id: page.getAttribute('id') || `page-${index + 1}`,
      name: page.getAttribute('name') || `Page-${index + 1}`,
      nodes: cells.filter(cell => cell.getAttribute('vertex') === '1').map(cell => cellSummary(cell)),
      edges: cells.filter(cell => cell.getAttribute('edge') === '1').map(cell => ({
        id: cell.getAttribute('id'),
        label: cell.getAttribute('value') || '',
        source: cell.getAttribute('source') || '',
        target: cell.getAttribute('target') || '',
        style: cell.getAttribute('style') || '',
      })),
    }
  })
  return { pages, ...(includeXml ? { xml: serializer.serializeToString(document) } : {}) }
}

export function editDrawio(source, operations, pageSelector) {
  const document = parseDrawio(source || EMPTY_DRAWIO)
  const pages = pageNodes(document)
  const page = selectPage(pages, pageSelector)
  const model = modelForPage(page)
  const root = model.getElementsByTagName('root')[0]
  if (!root) throw new Error('The selected page has no mxGraphModel/root element.')

  for (const operation of operations) applyOperation(document, root, operation)
  replacePageModel(document, page, model)
  document.documentElement.setAttribute('compressed', 'false')
  document.documentElement.setAttribute('modified', new Date().toISOString())
  return serializer.serializeToString(document)
}

export function normalizeDrawio(source) {
  const document = parseDrawio(source || EMPTY_DRAWIO)
  for (const page of pageNodes(document)) replacePageModel(document, page, modelForPage(page))
  document.documentElement.setAttribute('compressed', 'false')
  return serializer.serializeToString(document)
}

function applyOperation(document, root, operation) {
  if (!operation || typeof operation !== 'object') throw new Error('Every operation must be an object.')
  const type = operation.type
  if (type === 'add_node') {
    const id = required(operation.id, 'add_node.id')
    assertMissing(root, id)
    const cell = document.createElement('mxCell')
    cell.setAttribute('id', id)
    cell.setAttribute('value', stringValue(operation.label))
    cell.setAttribute('style', operation.style || 'rounded=1;whiteSpace=wrap;html=1;')
    cell.setAttribute('vertex', '1')
    cell.setAttribute('parent', operation.parent || '1')
    const geometry = document.createElement('mxGeometry')
    geometry.setAttribute('x', numberValue(operation.x, 0))
    geometry.setAttribute('y', numberValue(operation.y, 0))
    geometry.setAttribute('width', numberValue(operation.width, 120))
    geometry.setAttribute('height', numberValue(operation.height, 60))
    geometry.setAttribute('as', 'geometry')
    cell.appendChild(geometry)
    root.appendChild(cell)
    return
  }
  if (type === 'add_edge') {
    const id = required(operation.id, 'add_edge.id')
    const source = required(operation.source, 'add_edge.source')
    const target = required(operation.target, 'add_edge.target')
    assertMissing(root, id)
    assertCell(root, source)
    assertCell(root, target)
    const cell = document.createElement('mxCell')
    cell.setAttribute('id', id)
    cell.setAttribute('value', stringValue(operation.label))
    cell.setAttribute('style', operation.style || 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;')
    cell.setAttribute('edge', '1')
    cell.setAttribute('parent', operation.parent || '1')
    cell.setAttribute('source', source)
    cell.setAttribute('target', target)
    const geometry = document.createElement('mxGeometry')
    geometry.setAttribute('relative', '1')
    geometry.setAttribute('as', 'geometry')
    cell.appendChild(geometry)
    root.appendChild(cell)
    return
  }
  if (type === 'update') {
    const cell = assertCell(root, required(operation.id, 'update.id'))
    if (operation.label !== undefined) cell.setAttribute('value', stringValue(operation.label))
    if (operation.style !== undefined) cell.setAttribute('style', stringValue(operation.style))
    if (operation.parent !== undefined) cell.setAttribute('parent', stringValue(operation.parent))
    const geometryKeys = ['x', 'y', 'width', 'height']
    if (geometryKeys.some(key => operation[key] !== undefined)) {
      let geometry = Array.from(cell.childNodes).find(node => node.nodeType === 1 && node.nodeName === 'mxGeometry')
      if (!geometry) {
        geometry = document.createElement('mxGeometry')
        geometry.setAttribute('as', 'geometry')
        cell.appendChild(geometry)
      }
      for (const key of geometryKeys) if (operation[key] !== undefined) geometry.setAttribute(key, numberValue(operation[key], 0))
    }
    return
  }
  if (type === 'delete') {
    removeCells(root, required(operation.id, 'delete.id'))
    return
  }
  throw new Error(`Unsupported operation type: ${String(type)}`)
}

function removeCells(root, id) {
  assertCell(root, id)
  const remove = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const cell of cellsIn(root)) {
      const cellId = cell.getAttribute('id')
      if (!remove.has(cellId) && remove.has(cell.getAttribute('parent'))) {
        remove.add(cellId)
        changed = true
      }
    }
  }
  for (const cell of cellsIn(root)) {
    if (remove.has(cell.getAttribute('source')) || remove.has(cell.getAttribute('target'))) remove.add(cell.getAttribute('id'))
  }
  for (const cell of cellsIn(root)) if (remove.has(cell.getAttribute('id'))) cell.parentNode?.removeChild(cell)
}

function cellSummary(cell) {
  const geometry = Array.from(cell.childNodes).find(node => node.nodeType === 1 && node.nodeName === 'mxGeometry')
  return {
    id: cell.getAttribute('id'),
    label: cell.getAttribute('value') || '',
    parent: cell.getAttribute('parent') || '',
    style: cell.getAttribute('style') || '',
    geometry: geometry ? {
      x: numericAttribute(geometry, 'x'),
      y: numericAttribute(geometry, 'y'),
      width: numericAttribute(geometry, 'width'),
      height: numericAttribute(geometry, 'height'),
    } : null,
  }
}

function parseDrawio(source) {
  const errors = []
  const parser = new DOMParser({ onError: (level, message) => { if (level !== 'warning') errors.push(message) } })
  let document
  try {
    document = parser.parseFromString(source, 'application/xml')
  } catch (error) {
    throw new Error(`Invalid Draw.io XML: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (errors.length || document.getElementsByTagName('parsererror').length) throw new Error(`Invalid Draw.io XML: ${errors[0] || 'parse error'}`)
  if (document.documentElement.nodeName === 'mxGraphModel') {
    const wrapper = parser.parseFromString(EMPTY_DRAWIO, 'application/xml')
    const diagram = wrapper.getElementsByTagName('diagram')[0]
    while (diagram.firstChild) diagram.removeChild(diagram.firstChild)
    diagram.appendChild(wrapper.importNode(document.documentElement, true))
    document = wrapper
  }
  if (document.documentElement.nodeName !== 'mxfile') throw new Error('Expected an mxfile or mxGraphModel root element.')
  if (!pageNodes(document).length) throw new Error('The Draw.io document contains no diagram page.')
  return document
}

function pageNodes(document) {
  return Array.from(document.documentElement.childNodes).filter(node => node.nodeType === 1 && node.nodeName === 'diagram')
}

function selectPage(pages, selector) {
  if (selector === undefined || selector === null || selector === '') return pages[0]
  if (typeof selector === 'number') {
    const page = pages[selector]
    if (!page) throw new Error(`Page index ${selector} does not exist.`)
    return page
  }
  const page = pages.find(candidate => candidate.getAttribute('id') === selector || candidate.getAttribute('name') === selector)
  if (!page) throw new Error(`Page ${selector} does not exist.`)
  return page
}

function modelForPage(page) {
  const element = Array.from(page.childNodes).find(node => node.nodeType === 1 && node.nodeName === 'mxGraphModel')
  if (element) return element
  const encoded = (page.textContent || '').trim()
  if (!encoded) throw new Error(`Page ${page.getAttribute('name') || ''} has no graph model.`)
  try {
    const decoded = decodeURIComponent(pako.inflateRaw(Buffer.from(encoded, 'base64'), { to: 'string' }))
    return parseModel(decoded)
  } catch (error) {
    throw new Error(`Unable to decompress page ${page.getAttribute('name') || ''}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseModel(xml) {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.documentElement.nodeName !== 'mxGraphModel') throw new Error('Decoded page is not an mxGraphModel.')
  return document.documentElement
}

function replacePageModel(document, page, model) {
  while (page.firstChild) page.removeChild(page.firstChild)
  page.appendChild(document.importNode(model, true))
}

function cellsIn(root) {
  return Array.from(root.getElementsByTagName('mxCell'))
}

function assertCell(root, id) {
  const cell = cellsIn(root).find(candidate => candidate.getAttribute('id') === id)
  if (!cell) throw new Error(`Cell ${id} does not exist.`)
  return cell
}

function assertMissing(root, id) {
  if (cellsIn(root).some(candidate => candidate.getAttribute('id') === id)) throw new Error(`Cell ${id} already exists.`)
}

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  return value
}

function stringValue(value) {
  return value === undefined || value === null ? '' : String(value)
}

function numberValue(value, fallback) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, received ${String(value)}.`)
  return String(number)
}

function numericAttribute(element, key) {
  const value = element.getAttribute(key)
  return value === '' ? null : Number(value)
}
