import type { Context } from '@deepseek-ai/cordis'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const inject = ['slots', 'sidebarRightTabs']
const TAB_ID = '@civilization/dsh-drawio'
const TAB_KIND = 'drawio'

interface SessionScope { sessionId: string; cwd?: string }
interface FileViewerProps { content?: string; truncated?: boolean; path: string; scope: SessionScope }
interface OfficialContext extends Context { slots: any; sidebarRightTabs: any }

export function apply(ctx: Context): void {
  const official = ctx as OfficialContext
  ctx.effect(() => official.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    patterns: ['*.drawio'],
    priority: 'extension',
    title: (address: string) => fileName(parseDrawioAddress(address)?.path ?? 'Draw.io'),
  }), 'dsh-drawio: official tab definition')
  ctx.effect(() => official.slots.inject('sidebar.right.pane.tab', () => official.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
  }, OfficialDrawioTabBody)), 'dsh-drawio: official tab body')
  ctx.effect(() => official.slots.inject('sidebar.right.pane.tab.title', () => official.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: TAB_ID,
  }, OfficialDrawioTabTitle)), 'dsh-drawio: official tab title')
}

function OfficialDrawioTabTitle({ useTabInfo }: any): JSX.Element {
  const { tab } = useTabInfo()
  return <><CanvasIcon size={15} /><span>{tab.title}</span></>
}

function OfficialDrawioTabBody({ sessionId, useSessions, useTabInfo }: any): JSX.Element {
  const { tab } = useTabInfo()
  const cwd = useSessions((sessions: any) => sessions?.byId?.[sessionId]?.cwd) as string | undefined
  const resource = useMemo(() => parseDrawioAddress(tab.navigation.address), [tab.navigation.address])
  const [file, setFile] = useState<{ key: string; content: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = `${sessionId}\0${cwd ?? ''}\0${resource?.path ?? ''}`

  useEffect(() => {
    if (!resource || resource.sessionId !== sessionId || !cwd) return
    const controller = new AbortController()
    setError(null)
    void fsRead({ sessionId, cwd }, resource.path, controller.signal)
      .then(content => { if (!controller.signal.aborted) setFile({ key, content }) })
      .catch(reason => { if (!controller.signal.aborted) setError(messageOf(reason)) })
    return () => controller.abort()
  }, [key, resource?.sessionId, resource?.path, sessionId, cwd])

  if (!resource || resource.sessionId !== sessionId) return <CenteredMessage title="无法打开画板" detail="文件地址不是当前会话中的 Draw.io 文件。" />
  if (!cwd) return <CenteredMessage title="无法打开画板" detail="当前会话没有可用的工作区。" />
  if (error) return <CenteredMessage title="画板载入失败" detail={error} />
  if (file?.key !== key) return <CenteredMessage title="正在载入画板" detail={fileName(resource.path)} />
  return <DrawioCanvas content={file.content} path={resource.path} scope={{ sessionId, cwd }} />
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
  const lastUserActivity = useRef(0)
  const isInteracting = useRef(false)
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
    lastUserActivity.current = Date.now()
    latestEditor.current = xml
    if (saveTimer.current !== undefined) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = undefined
    }
    if (immediate) {
      void persist(xml)
    } else {
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = undefined
        void persist(latestEditor.current)
      }, 350)
    }
  }, [persist])

  useEffect(() => {
    latestFile.current = content ?? ''
    latestEditor.current = content ?? ''
  }, [content, path])

  const markActivity = useCallback(() => {
    lastUserActivity.current = Date.now()
  }, [])

  useEffect(() => {
    const attached = new WeakSet<Document>()
    const handleFrameAttach = () => {
      try {
        const doc = frame.current?.contentDocument
        if (!doc || attached.has(doc)) return
        attached.add(doc)
        const onDown = () => {
          isInteracting.current = true
          lastUserActivity.current = Date.now()
        }
        const onUp = () => {
          isInteracting.current = false
          lastUserActivity.current = Date.now()
        }
        const onKey = () => {
          lastUserActivity.current = Date.now()
        }
        // 仅在用户按住拖拽、松手或输入时感知，单纯鼠标移动(hover)不打断
        doc.addEventListener('pointerdown', onDown, true)
        doc.addEventListener('pointerup', onUp, true)
        doc.addEventListener('keydown', onKey, true)
      } catch {}
    }
    const timer = window.setInterval(handleFrameAttach, 800)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setReady(false)
    setSaveState('loading')
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return
      let message: { event?: string; xml?: string }
      try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data }
      catch { return }
      if (message.event === 'configure') {
        post({ action: 'configure', config: { compressXml: false, enableCssDarkMode: true, defaultLibraries: 'general;uml;er;bpmn;flowchart;basic;arrows2', enabledLibraries: null } })
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
      // 1. 用户按住鼠标拖拽中，绝不读取
      if (isInteracting.current) return
      // 2. 刚松手或打字后 1.5 秒内（操作缓冲），暂停轮询
      if (Date.now() - lastUserActivity.current < 1500) return
      // 3. 本地正在防抖保存中，不从磁盘读取
      if (saveTimer.current !== undefined) return
      // 4. 浏览器标签页切后台时静默
      if (typeof document !== 'undefined' && document.hidden) return

      try {
        const xml = await fsRead(scope, path)
        // 5. 响应返回后二次防护：若这期间用户按下了鼠标或开始拖动，果断丢弃本次结果
        if (cancelled || isInteracting.current || Date.now() - lastUserActivity.current < 1200) return
        if (xml === latestFile.current || xml === latestEditor.current) return

        latestFile.current = xml
        latestEditor.current = xml
        post({ action: 'load', xml, autosave: 1, title: fileName(path), dark, noExitBtn: 1, saveAndExit: 0 })
        setSaveState('external')
        window.setTimeout(() => { if (!cancelled) setSaveState('saved') }, 1200)
      } catch (reason) {
        if (!cancelled) setError(messageOf(reason))
      }
    }
    // 空闲时每 2.5 秒正常读取一次
    const timer = window.setInterval(() => { void poll() }, 2500)
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

async function fsRead(scope: SessionScope, path: string, signal?: AbortSignal): Promise<string> {
  const value = await call<{ content: string }>('read', scope, { path }, false, signal)
  return value.content
}

async function fsWrite(scope: SessionScope, path: string, content: string, keepalive = false): Promise<void> {
  await call('write', scope, { path, content }, keepalive)
}

async function call<T = { ok: true }>(method: string, scope: SessionScope, extra: Record<string, unknown>, keepalive = false, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/dsh-drawio/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: scope.sessionId, ...(scope.cwd ? { cwd: scope.cwd } : {}), ...extra }), keepalive, signal })
  const envelope = await response.json().catch(() => null) as { ok?: boolean; value?: T; error?: { message?: string } } | null
  if (!response.ok || envelope?.ok !== true || envelope.value === undefined) throw new Error(envelope?.error?.message ?? `HTTP ${response.status}`)
  return envelope.value
}

function CanvasIcon({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  return <svg className={className} aria-hidden viewBox="0 0 20 20" width={size} height={size} fill="none"><rect x="2.5" y="2.5" width="15" height="15" rx="2.5" stroke="currentColor"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/><circle cx="13" cy="13" r="1.5" fill="currentColor"/><path d="M8.4 7.8l3.2 4.4M8.2 6.2h3.6M6.2 8.2v3.6" stroke="currentColor" strokeLinecap="round"/></svg>
}

function CenteredMessage({ title, detail }: { title: string; detail: string }): JSX.Element {
  return <div style={styles.center}><strong>{title}</strong><span style={styles.muted}>{detail}</span></div>
}

const fileName = (path: string): string => path.replace(/\\/g, '/').split('/').pop() || path
function parseDrawioAddress(address: string): { sessionId: string; path: string } | null {
  const prefix = 'dsh-resource://file/session/'
  if (!address.startsWith(prefix)) return null
  try {
    const parts = address.slice(prefix.length).split('/').map(decodeURIComponent)
    const sessionId = parts.shift() ?? ''
    const path = parts.join('/')
    if (!sessionId || !path || !/\.drawio$/i.test(path) || parts.some(part => part.includes('/') || part.includes('\\') || part.includes('\0'))) return null
    return { sessionId, path }
  } catch { return null }
}
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
