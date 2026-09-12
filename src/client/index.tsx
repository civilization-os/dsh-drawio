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

  const [menuOpen, setMenuOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<'png' | 'svg' | 'xmlpng'>('png')
  const [isTransparent, setIsTransparent] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const pendingExport = useRef<{ format: 'png' | 'svg' | 'xmlpng'; target: 'workspace' | 'download' | 'clipboard'; targetPath: string } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(current => current === msg ? null : current), 3200)
  }, [])

  const startExport = useCallback((target: 'workspace' | 'download' | 'clipboard') => {
    if (!ready || isExporting) return
    const ext = exportFormat === 'svg' ? '.svg' : exportFormat === 'xmlpng' ? '.drawio.png' : '.png'
    const base = path.replace(/\.drawio$/i, '')
    const targetPath = `${base}${ext}`

    pendingExport.current = {
      format: exportFormat,
      target,
      targetPath,
    }
    setIsExporting(true)
    setMenuOpen(false)
    post({
      action: 'export',
      format: exportFormat,
      scale: exportFormat === 'svg' ? 1 : 2,
      transparent: isTransparent,
      border: 10,
      spin: '正在渲染导出图片...',
    })
  }, [ready, isExporting, exportFormat, isTransparent, path, post])

  const handleExportResult = useCallback(async (pending: { format: 'png' | 'svg' | 'xmlpng'; target: 'workspace' | 'download' | 'clipboard'; targetPath: string }, data: string) => {
    try {
      if (pending.target === 'download') {
        const link = document.createElement('a')
        link.download = fileName(pending.targetPath)
        link.href = data
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        showToast(`已开始下载：${fileName(pending.targetPath)}`)
      } else if (pending.target === 'clipboard') {
        if (pending.format === 'svg') {
          const svgText = data.startsWith('data:image/svg+xml')
            ? decodeURIComponent(data.split(',')[1] || '')
            : data
          await navigator.clipboard.writeText(svgText)
          showToast('已复制 SVG 代码到剪贴板')
        } else {
          const res = await fetch(data)
          const blob = await res.blob()
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          showToast('已复制图片到剪贴板')
        }
      } else if (pending.target === 'workspace') {
        const result = await fsSaveImage(scope, pending.targetPath, data)
        showToast(`已保存到工作区：${fileName(result.path)} (${Math.round(result.bytes / 1024)} KB)`)
      }
    } catch (reason) {
      setError(`导出失败：${messageOf(reason)}`)
    }
  }, [scope, showToast])

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', handleOutsideClick)
    return () => window.removeEventListener('pointerdown', handleOutsideClick)
  }, [menuOpen])

  useEffect(() => {
    setReady(false)
    setSaveState('loading')
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return
      let message: { event?: string; xml?: string; format?: string; data?: string }
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
      } else if (message.event === 'export' && typeof message.data === 'string') {
        const pending = pendingExport.current
        pendingExport.current = null
        setIsExporting(false)
        if (pending) {
          void handleExportResult(pending, message.data)
        }
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [src, dark, path, post, scheduleSave, handleExportResult])

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

  const targetExt = exportFormat === 'svg' ? '.svg' : exportFormat === 'xmlpng' ? '.drawio.png' : '.png'
  const previewName = `${fileName(path).replace(/\.drawio$/i, '')}${targetExt}`

  return (
    <div style={styles.root}>
      <iframe ref={frame} title={`${fileName(path)} Draw.io 画板`} src={src} style={styles.frame} />

      {/* 右上角悬浮导出工具面板 */}
      <div ref={menuRef} style={styles.toolbar}>
        <button
          type="button"
          onClick={() => setMenuOpen(open => !open)}
          disabled={!ready || isExporting}
          style={{ ...styles.exportTrigger, ...(isExporting ? styles.triggerActive : {}) }}
          title="导出当前画板为图片"
        >
          <CameraIcon size={14} />
          <span>{isExporting ? '正在导出...' : '导出图片'}</span>
          <span style={styles.arrowIcon}>▾</span>
        </button>

        {menuOpen ? (
          <div style={styles.exportMenu}>
            <div style={styles.menuHeader}>
              <span style={styles.menuTitle}>导出画板图片</span>
              <span style={styles.menuSub}>{previewName}</span>
            </div>

            <div style={styles.formatRow}>
              {(['png', 'svg', 'xmlpng'] as const).map(fmt => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setExportFormat(fmt)}
                  style={{
                    ...styles.formatBtn,
                    ...(exportFormat === fmt ? { ...styles.formatBtnActive, borderColor: accentColor } : {}),
                  }}
                >
                  {fmt === 'png' ? 'PNG (超清)' : fmt === 'svg' ? 'SVG (矢量)' : 'XML-PNG'}
                </button>
              ))}
            </div>

            {exportFormat !== 'svg' ? (
              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={isTransparent}
                  onChange={e => setIsTransparent(e.target.checked)}
                  style={styles.checkbox}
                />
                <span>透明背景</span>
              </label>
            ) : null}

            <div style={styles.actionCol}>
              <button
                type="button"
                onClick={() => startExport('workspace')}
                style={{ ...styles.actionBtn, ...styles.actionBtnPrimary, background: accentColor }}
              >
                <SaveIcon size={13} />
                <span>保存到工作区 ({targetExt})</span>
              </button>

              <button
                type="button"
                onClick={() => startExport('clipboard')}
                style={styles.actionBtn}
              >
                <CopyIcon size={13} />
                <span>复制到剪贴板</span>
              </button>

              <button
                type="button"
                onClick={() => startExport('download')}
                style={styles.actionBtn}
              >
                <DownloadIcon size={13} />
                <span>下载图片文件</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Toast 提示 */}
      {toast ? (
        <div style={styles.toast}>
          <CheckIcon size={14} />
          <span>{toast}</span>
        </div>
      ) : null}

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

async function fsSaveImage(scope: SessionScope, path: string, data: string): Promise<{ path: string; bytes: number }> {
  return call<{ path: string; bytes: number }>('save-image', scope, { path, data })
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

function CameraIcon({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  return <svg className={className} aria-hidden viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h1.8a1.5 1.5 0 0 0 1.2-.6l.5-.7A1.5 1.5 0 0 1 10.2 3h1.6a1.5 1.5 0 0 1 1.2.7l.5.7a1.5 1.5 0 0 0 1.2.6h1.8A1.5 1.5 0 0 1 18 6.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 15.5v-9z"/><circle cx="10" cy="11" r="3.5"/></svg>
}

function SaveIcon({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  return <svg className={className} aria-hidden viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 17H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9.5l3.5 3.5V16a1 1 0 0 1-1 1z"/><path d="M13 17v-6H7v6"/><path d="M7 3v4h6"/></svg>
}

function CopyIcon({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  return <svg className={className} aria-hidden viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M4 13H3.5A1.5 1.5 0 0 1 2 11.5v-8A1.5 1.5 0 0 1 3.5 2h8A1.5 1.5 0 0 1 13 3.5V4"/></svg>
}

function DownloadIcon({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  return <svg className={className} aria-hidden viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5"/><path d="M3 14v2a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-2"/></svg>
}

function CheckIcon({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  return <svg className={className} aria-hidden viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>
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
  toolbar: { position: 'absolute', right: 12, top: 12, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  exportTrigger: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: `1px solid ${border}`, borderRadius: 6, color: fg, background: layer, boxShadow: 'var(--dsw-alias-shadow-sm, 0 2px 8px rgba(0,0,0,.12))', fontSize: 12, fontWeight: 500, cursor: 'pointer', backdropFilter: 'blur(8px)', transition: 'all 0.15s ease' },
  triggerActive: { opacity: 0.75, cursor: 'wait' },
  arrowIcon: { fontSize: 10, opacity: 0.6, marginLeft: 2 },
  exportMenu: { marginTop: 6, width: 220, padding: 12, border: `1px solid ${border}`, borderRadius: 8, background: layer, boxShadow: 'var(--dsw-alias-shadow-md, 0 6px 20px rgba(0,0,0,.18))', backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', gap: 10 },
  menuHeader: { display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 6, borderBottom: `1px solid ${border}` },
  menuTitle: { fontSize: 12, fontWeight: 600, color: fg },
  menuSub: { fontSize: 10, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  formatRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 },
  formatBtn: { padding: '4px 2px', border: `1px solid ${border}`, borderRadius: 4, background: 'transparent', color: muted, fontSize: 10.5, cursor: 'pointer', textAlign: 'center', transition: 'all 0.1s ease' },
  formatBtnActive: { color: fg, fontWeight: 600, background: 'var(--dsw-alias-fill-quaternary, rgba(127,127,127,0.12))' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: muted, cursor: 'pointer', userSelect: 'none' },
  checkbox: { cursor: 'pointer', margin: 0 },
  actionCol: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 },
  actionBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '6px 10px', border: `1px solid ${border}`, borderRadius: 5, background: 'transparent', color: fg, fontSize: 11.5, cursor: 'pointer', transition: 'all 0.12s ease' },
  actionBtnPrimary: { color: '#ffffff', border: 'none', fontWeight: 500 },
  toast: { position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', border: `1px solid ${border}`, borderRadius: 20, background: layer, color: fg, boxShadow: 'var(--dsw-alias-shadow-md, 0 4px 14px rgba(0,0,0,.16))', fontSize: 12, backdropFilter: 'blur(10px)', pointerEvents: 'none' },
  status: { position: 'absolute', right: 10, bottom: 9, zIndex: 2, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', border: `1px solid ${border}`, borderRadius: 999, color: muted, background: layer, boxShadow: 'var(--dsw-alias-shadow-sm, 0 2px 8px rgba(0,0,0,.12))', fontSize: 11, pointerEvents: 'none' },
  statusError: { color: 'var(--dsw-alias-danger, #d84f5f)' },
  dot: { width: 6, height: 6, borderRadius: 99, background: accent },
  error: { position: 'absolute', left: 10, bottom: 9, zIndex: 3, padding: '5px 9px', border: `1px solid ${border}`, borderRadius: 7, color: 'var(--dsw-alias-danger, #d84f5f)', background: layer, cursor: 'pointer', font: 'inherit', fontSize: 11 },
  center: { boxSizing: 'border-box', width: '100%', height: '100%', display: 'grid', placeContent: 'center', gap: 6, padding: 24, color: fg, background: layer, textAlign: 'center' },
  muted: { color: muted, fontSize: 12 },
}
