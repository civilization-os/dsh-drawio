/**
 * SVG export payload handling shared by the host route and the canvas client.
 *
 * The bundled Draw.io runtime hands an export back in one of two carrier
 * forms: the common `data:image/svg+xml;base64,<base64>` data URL, or a
 * `data:image/svg+xml,<percent-encoded>` / raw-markup payload. Both are
 * normalized to markup here so a caller never guesses which one it received.
 * The module stays browser-safe: it decodes with `atob`/`TextDecoder`, never
 * with Node's `Buffer`.
 */

/**
 * Decode one base64 payload without depending on Node globals.
 * @param {string} value - base64 text, whitespace tolerated.
 * @returns {string} the decoded text.
 */
function base64ToText(value) {
  const clean = value.replace(/\s+/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

/**
 * Normalize one export payload to SVG markup.
 * @param {unknown} data - raw markup, or a `data:` URL carrying it.
 * @returns {string | null} the markup, or `null` when the payload names another media type or cannot be decoded.
 */
export function svgMarkupOf(data) {
  if (typeof data !== 'string') return null
  const value = data.trim()
  if (value === '') return null
  if (!value.startsWith('data:')) return value
  const comma = value.indexOf(',')
  if (comma < 0) return null
  const header = value.slice('data:'.length, comma).toLowerCase()
  if (!header.startsWith('image/svg+xml')) return null
  const body = value.slice(comma + 1)
  if (header.includes(';base64')) {
    try {
      return base64ToText(body)
    } catch {
      return null
    }
  }
  try {
    return decodeURIComponent(body)
  } catch {
    return body
  }
}

/**
 * Whether one payload is SVG markup the workspace may store as text.
 * @param {unknown} value - candidate markup.
 * @returns {boolean} whether a root `<svg>` element is present.
 */
export function isSvgMarkup(value) {
  return typeof value === 'string' && /<svg[\s>]/i.test(value)
}
