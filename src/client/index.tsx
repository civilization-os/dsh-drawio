import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {} from 'dsh-better-sidebar'
import type { FileViewerProps, SessionScope } from 'dsh-better-sidebar/client/service'

export const inject = ['betterSidebar']
const VIEWER_ID = 'dsh-drawio:canvas'

export function apply(ctx: Context): void {
  const betterSidebar = ctx.betterSidebar
  if (!betterSidebar) return
  ctx.effect(() => betterSidebar.registerFileViewer({
    id: VIEWER_ID,
    title: () => 'Draw.io 画板',
    icon: <CanvasIcon />,
    exts: ['drawio'],
    priority: 100,
    fetchStrategy: 'fsRead',
    component: DrawioCanvas,
  }))
}

function DrawioCanvas({ content, truncated, path, scope }: FileViewerProps): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const latestFile = useRef(content ?? '')
  const latestEditor = useRef(content ?? '')
  const saveTimer = useRef<number | undefined>(undefined)
  const saveGeneration = useRef(0)
  const [ready, setReady] = useState(false)
  const [saveState, setSaveState] = useState<'loading' | 'saved' | 'saving' | 'external' | 'error'>('loading')
  const [error, setError] = useState<string | null>(truncated ? '文件过大，DSH 只返回了截断内容，无法安全打开。' : null)
  const { dark, accent: accentColor } = useDshTheme()
  const src = useMemo(() => `/dsh-drawio/runtime/index.html?embed=1&proto=json&spin=1&offline=1&local=1&ui=min&libraries=1&configure=1&noExitBtn=1&saveAndExit=0&dark=${dark ? '1' : '0'}`, [dark])

  const post = useCallback((message: unknown) => {
    frame.current?.contentWindow?.postMessage(JSON.stringify(message), window.location.origin)
  }, [])

  const persist = useCallback(async (xml: string) => {
    const generation = ++saveGeneration.current
    setSaveState('saving')
    try {
      await fsWrite(scope, path, xml)
      if (generation !== saveGeneration.current) return
      latestFile.current = xml
      latestEditor.current = xml
      setSaveState('saved')
      setError(null)
    } catch (reason) {
      if (generation !== saveGeneration.current) return
      setSaveState('error')
      setError(messageOf(reason))
    }
  }, [scope.sessionId, scope.cwd, path])

  const scheduleSave = useCallback((xml: string, immediate = false) => {
    latestEditor.current = xml
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
    if (immediate) void persist(xml)
    else saveTimer.current = window.setTimeout(() => { void persist(latestEditor.current) }, 350)
  }, [persist])

  useEffect(() => {
    latestFile.current = content ?? ''
    latestEditor.current = content ?? ''
  }, [content, path])

  useEffect(() => {
    setReady(false)
    setSaveState('loading')
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return
      let message: { event?: string; xml?: string }
      try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data }
      catch { return }
      if (message.event === 'configure') {
        post({ action: 'configure', config: { compressXml: false, enableCssDarkMode: true, defaultLibraries: 'general;flowchart;basic;arrows2', enabledLibraries: ['general', 'flowchart', 'basic', 'arrows2'] } })
      } else if (message.event === 'init') {
        post({ action: 'load', xml: latestFile.current, autosave: 1, title: fileName(path), dark, noExitBtn: 1, saveAndExit: 0 })
        setReady(true)
        setSaveState('saved')
      } else if ((message.event === 'autosave' || message.event === 'save') && typeof message.xml === 'string') {
        scheduleSave(message.xml, message.event === 'save')
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [src, dark, path, post, scheduleSave])

  useEffect(() => {
    if (!ready || truncated) return
    let cancelled = false
    const poll = async () => {
      try {
        const xml = await fsRead(scope, path)
        if (cancelled || xml === latestFile.current || xml === latestEditor.current) return
        latestFile.current = xml
        latestEditor.current = xml
        post({ action: 'load', xml, autosave: 1, title: fileName(path), dark, noExitBtn: 1, saveAndExit: 0 })
        setSaveState('external')
        window.setTimeout(() => { if (!cancelled) setSaveState('saved') }, 1200)
      } catch (reason) {
        if (!cancelled) setError(messageOf(reason))
      }
    }
    const timer = window.setInterval(() => { void poll() }, 1600)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [ready, truncated, scope.sessionId, scope.cwd, path, dark, post])

  useEffect(() => () => {
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
    if (latestEditor.current !== latestFile.current) void fsWrite(scope, path, latestEditor.current, true)
  }, [scope.sessionId, scope.cwd, path])

  if (truncated) return <CenteredMessage title="无法打开画板" detail="文件内容已被截断，继续编辑可能损坏原文件。" />
  return (
    <div style={styles.root}>
      <iframe ref={frame} title={`${fileName(path)} Draw.io 画板`} src={src} style={styles.frame} />
      <div role="status" aria-live="polite" style={{ ...styles.status, ...(saveState === 'error' ? styles.statusError : {}) }}>
        <span style={{ ...styles.dot, background: accentColor }} />{statusText(saveState)}
      </div>
      {error ? <button type="button" title={error} onClick={() => setError(null)} style={styles.error}>保存失败 · 点击关闭</button> : null}
    </div>
  )
}

function useDshTheme(): { dark: boolean; accent: string } {
  const [theme, setTheme] = useState(readDshTheme)
  useEffect(() => {
    const refresh = () => {
      const next = readDshTheme()
      setTheme((current) => current.dark === next.dark && current.accent === next.accent ? current : next)
    }
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', refresh)
    window.addEventListener('storage', refresh)
    const timer = window.setInterval(refresh, 1000)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', refresh)
      window.removeEventListener('storage', refresh)
      window.clearInterval(timer)
    }
  }, [])
  return theme
}

function readDshTheme(): { dark: boolean; accent: string } {
  return {
    dark: detectDark(),
    accent: localStorage.getItem('dsh-dream-skin:accent') || accent,
  }
}

function detectDark(): boolean {
  const preferred = localStorage.getItem('dsh-dream-skin:builtin-last')
  if (preferred === 'dark') return true
  if (preferred === 'light') return false
  const value = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-container-bg').trim()
  const numbers = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (numbers?.length === 3) return (numbers[0] * .299 + numbers[1] * .587 + numbers[2] * .114) < 128
  return document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches
}

async function fsRead(scope: SessionScope, path: string): Promise<string> {
  const value = await call<{ kind: string; content?: string; truncated?: boolean }>('fs.read', scope, { path })
  if (value.kind !== 'text' || value.truncated) throw new Error('Draw.io 文件不是完整的 UTF-8 文本。')
  return value.content ?? ''
}

async function fsWrite(scope: SessionScope, path: string, content: string, keepalive = false): Promise<void> {
  await call('fs.write', scope, { path, content }, keepalive)
}

async function call<T = { ok: true }>(method: string, scope: SessionScope, extra: Record<string, unknown>, keepalive = false): Promise<T> {
  const response = await fetch(`/sidebar/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: scope.sessionId, ...(scope.cwd ? { cwd: scope.cwd } : {}), ...extra }), keepalive })
  const envelope = await response.json().catch(() => null) as { ok?: boolean; value?: T; error?: { message?: string } } | null
  if (!response.ok || envelope?.ok !== true || envelope.value === undefined) throw new Error(envelope?.error?.message ?? `HTTP ${response.status}`)
  return envelope.value
}

function CanvasIcon(): JSX.Element {
  return <svg aria-hidden viewBox="0 0 20 20" width="16" height="16" fill="none"><rect x="2.5" y="2.5" width="15" height="15" rx="2.5" stroke="currentColor"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/><circle cx="13" cy="13" r="1.5" fill="currentColor"/><path d="M8.4 7.8l3.2 4.4M8.2 6.2h3.6M6.2 8.2v3.6" stroke="currentColor" strokeLinecap="round"/></svg>
}

function CenteredMessage({ title, detail }: { title: string; detail: string }): JSX.Element {
  return <div style={styles.center}><strong>{title}</strong><span style={styles.muted}>{detail}</span></div>
}

const fileName = (path: string): string => path.replace(/\\/g, '/').split('/').pop() || path
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason)
const statusText = (state: string): string => state === 'loading' ? '正在载入' : state === 'saving' ? '正在保存' : state === 'external' ? '已同步 AI 修改' : state === 'error' ? '保存失败' : '已保存'
const fg = 'var(--dsw-alias-label-primary, currentColor)'
const muted = 'var(--dsw-alias-label-secondary, rgba(127,127,127,.9))'
const layer = 'var(--dsw-alias-container-bg, Canvas)'
const border = 'var(--dsw-alias-border-l3, rgba(127,127,127,.24))'
const accent = 'var(--dsw-alias-brand-primary, #ed67ad)'
const styles: Record<string, React.CSSProperties> = {
  root: { position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', color: fg, background: layer },
  frame: { display: 'block', width: '100%', height: '100%', border: 0, background: layer },
  status: { position: 'absolute', right: 10, bottom: 9, zIndex: 2, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', border: `1px solid ${border}`, borderRadius: 999, color: muted, background: layer, boxShadow: 'var(--dsw-alias-shadow-sm, 0 2px 8px rgba(0,0,0,.12))', fontSize: 11, pointerEvents: 'none' },
  statusError: { color: 'var(--dsw-alias-danger, #d84f5f)' },
  dot: { width: 6, height: 6, borderRadius: 99, background: accent },
  error: { position: 'absolute', left: 10, bottom: 9, zIndex: 3, padding: '5px 9px', border: `1px solid ${border}`, borderRadius: 7, color: 'var(--dsw-alias-danger, #d84f5f)', background: layer, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  center: { boxSizing: 'border-box', width: '100%', height: '100%', display: 'grid', placeContent: 'center', gap: 6, padding: 24, color: fg, background: layer, textAlign: 'center' },
  muted: { color: muted, fontSize: 12 },
}
