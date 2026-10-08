import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

const DRAWIO_SUFFIX = /\.drawio$/i

/**
 * One Draw.io file named by a sidebar tab address.
 * @typedef {object} DrawioAddress
 * @property {'session' | 'absolute'} scope - which scope of the `dsh-resource://file/…` grammar named it.
 * @property {string} sessionId - the session that resolves the path; empty for an absolute address opened without a pane session.
 * @property {string} path - workspace-relative or absolute `/`-separated path, exactly as the address carried it.
 */

/**
 * Parse one sidebar tab address into the Draw.io file it names.
 *
 * The grammar is DSH's own (`dsh-resource://file/session/<sessionId>/<path>` and
 * `dsh-resource://file/absolute/<path>`), so parsing is delegated to the product
 * util rather than re-implemented here; only the Draw.io file filter and the
 * fallback session for a session-less absolute address are added on top. A
 * session-scoped path stays exactly as written — it may be workspace-relative
 * or absolute — because the host resolves and confines it.
 *
 * @param {string | undefined} address - the address the tab was claimed for.
 * @param {string} [fallbackSessionId] - the pane's session, used when the address carries none.
 * @returns {DrawioAddress | null} the parsed file, or `null` when the address names anything else.
 */
export function parseDrawioAddress(address, fallbackSessionId) {
  if (typeof address !== 'string') return null
  const trimmed = address.trim()
  if (trimmed === '') return null
  const parsed = parseFileAddress(trimmed)
  if (parsed === undefined) return null
  if (parsed.path.includes('\0')) return null
  if (!DRAWIO_SUFFIX.test(parsed.path)) return null
  if (parsed.scope === 'session') {
    return { scope: 'session', sessionId: parsed.sessionId, path: parsed.path }
  }
  return { scope: 'absolute', sessionId: fallbackSessionId || '', path: parsed.path }
}

/**
 * The workspace-relative form of an absolute path.
 *
 * An absolute address carries no session, so the canvas needs this answer
 * before it can read through the host: a path under the session workspace is
 * addressed relatively, and one outside it is not openable at all.
 *
 * @param {string | undefined} path - absolute path in either separator spelling.
 * @param {string | undefined} cwd - the session workspace root.
 * @returns {string | null} the workspace-relative path (empty for the root itself), or `null` when it is outside.
 */
export function relativeToWorkspace(path, cwd) {
  if (typeof path !== 'string' || typeof cwd !== 'string') return null
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root === '') return null
  const target = path.replace(/\\/g, '/')
  // A Windows drive or UNC root addresses the same file in either case.
  const foldCase = /^[A-Za-z]:/.test(root) || root.startsWith('//')
  const left = foldCase ? root.toLowerCase() : root
  const right = foldCase ? target.toLowerCase() : target
  if (right === left) return ''
  if (right.startsWith(`${left}/`)) return target.slice(root.length + 1)
  return null
}
