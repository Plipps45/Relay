import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Bug, ExternalLink, MousePointerClick, RotateCw, Send, X } from 'lucide-react'
import { useStore } from '@/store/app-store'
import { agentTargets, sendToAgent } from '@/lib/agent-delivery'
import { PICKER_SCRIPT, formatPickedElement, type PickedElement } from '@/lib/design-mode'
import type { WebviewElement } from '../env'
import { Button, IconButton, Spinner, cn } from './ui'

function normalizeUrl(input: string): string {
  const value = input.trim()
  if (/^[a-z]+:\/\//i.test(value)) {
    return value
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(value) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(value)) {
    return `${/^(localhost|127\.)/i.test(value) ? 'http' : 'https'}://${value}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}

export function BrowserTab({ workspaceId, tabId, url }: { workspaceId: string; tabId: string; url: string }): ReactNode {
  const updateTab = useStore((s) => s.updateTab)
  const toast = useStore((s) => s.toast)
  const webviewRef = useRef<WebviewElement | null>(null)
  const [address, setAddress] = useState(url)
  const [loading, setLoading] = useState(false)
  const [nav, setNav] = useState({ back: false, forward: false })
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<{ element: PickedElement; screenshot: string | null; preview: string | null } | null>(null)
  const [note, setNote] = useState('')
  const [initialUrl] = useState(url)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) {
      return undefined
    }
    const sync = (): void => {
      const current = webview.getURL()
      setAddress(current)
      setNav({ back: webview.canGoBack(), forward: webview.canGoForward() })
      updateTab(workspaceId, tabId, { url: current })
    }
    const onTitle = (event: Event): void => {
      const title = (event as Event & { title: string }).title
      updateTab(workspaceId, tabId, { title: title || 'Browser' })
    }
    const onStart = (): void => setLoading(true)
    const onStop = (): void => {
      setLoading(false)
      sync()
    }
    webview.addEventListener('did-navigate', sync)
    webview.addEventListener('did-navigate-in-page', sync)
    webview.addEventListener('page-title-updated', onTitle)
    webview.addEventListener('did-start-loading', onStart)
    webview.addEventListener('did-stop-loading', onStop)
    return () => {
      webview.removeEventListener('did-navigate', sync)
      webview.removeEventListener('did-navigate-in-page', sync)
      webview.removeEventListener('page-title-updated', onTitle)
      webview.removeEventListener('did-start-loading', onStart)
      webview.removeEventListener('did-stop-loading', onStop)
    }
  }, [workspaceId, tabId, updateTab])

  const go = (value: string): void => {
    const target = normalizeUrl(value)
    setAddress(target)
    void webviewRef.current?.loadURL(target).catch(() => undefined)
  }

  const startPicking = async (): Promise<void> => {
    const webview = webviewRef.current
    if (!webview) {
      return
    }
    setPicking(true)
    setPicked(null)
    try {
      const element = await webview.executeJavaScript<PickedElement | null>(PICKER_SCRIPT, true)
      if (!element) {
        return
      }
      let screenshot: string | null = null
      let preview: string | null = null
      const rect = {
        x: Math.max(0, Math.floor(element.rect.x)),
        y: Math.max(0, Math.floor(element.rect.y)),
        width: Math.max(1, Math.ceil(element.rect.width)),
        height: Math.max(1, Math.ceil(element.rect.height))
      }
      try {
        const image = await webview.capturePage(rect)
        if (!image.isEmpty()) {
          preview = image.toDataURL()
          screenshot = await window.relay.app.saveImage(preview.replace(/^data:image\/png;base64,/, ''))
        }
      } catch {
        // The element can be offscreen; the HTML and styles still describe it.
      }
      setPicked({ element, screenshot, preview })
      setNote('')
    } catch (error) {
      toast('error', `Could not inspect this page: ${String(error)}`)
    } finally {
      setPicking(false)
    }
  }

  const targets = agentTargets(workspaceId)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <IconButton label="Back" disabled={!nav.back} onClick={() => webviewRef.current?.goBack()}>
          <ArrowLeft className="size-4" />
        </IconButton>
        <IconButton label="Forward" disabled={!nav.forward} onClick={() => webviewRef.current?.goForward()}>
          <ArrowRight className="size-4" />
        </IconButton>
        <IconButton label={loading ? 'Stop' : 'Reload'} onClick={() => (loading ? webviewRef.current?.stop() : webviewRef.current?.reload())}>
          {loading ? <X className="size-4" /> : <RotateCw className="size-3.5" />}
        </IconButton>
        <form
          className="mx-1 flex h-7 min-w-0 flex-1 items-center rounded-md border border-input bg-muted/40 px-2"
          onSubmit={(e) => {
            e.preventDefault()
            go(address)
          }}
        >
          {loading ? <Spinner className="mr-1.5 size-3" /> : null}
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => e.target.select()}
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
          />
        </form>
        <Button size="sm" variant={picking ? 'default' : 'outline'} onClick={() => void startPicking()} title="Design mode: click an element to send it to the agent">
          <MousePointerClick className="size-3.5" />
          {picking ? 'Click an element… (Esc)' : 'Design mode'}
        </Button>
        <IconButton label="Open DevTools" onClick={() => webviewRef.current?.openDevTools()}>
          <Bug className="size-3.5" />
        </IconButton>
        <IconButton label="Open in system browser" onClick={() => void window.relay.shell.openExternal(webviewRef.current?.getURL() ?? address)}>
          <ExternalLink className="size-3.5" />
        </IconButton>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <webview
          ref={(element) => {
            webviewRef.current = element as WebviewElement | null
          }}
          src={initialUrl}
          partition="persist:relay-browser"
          className="h-full w-full"
        />
        {picked ? (
          <div className="absolute right-3 bottom-3 z-10 flex w-[380px] flex-col gap-2 rounded-xl border border-border bg-popover p-3 shadow-floating">
            <div className="flex items-center gap-2">
              <MousePointerClick className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-2xs">{picked.element.selector}</span>
              <IconButton label="Discard" className="size-6" onClick={() => setPicked(null)}>
                <X className="size-3.5" />
              </IconButton>
            </div>
            {picked.preview ? (
              <img src={picked.preview} alt="Selected element" className="max-h-32 w-full rounded-md border border-border object-contain" />
            ) : null}
            <textarea
              autoFocus
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the change (e.g. make this button match the primary style)"
              className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus:border-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && targets.length) {
                  if (sendToAgent(workspaceId, formatPickedElement(picked.element, note, picked.screenshot))) {
                    setPicked(null)
                  }
                }
              }}
            />
            <div className="flex items-center gap-2">
              <span className={cn('flex-1 text-2xs text-muted-foreground', !targets.length && 'text-destructive')}>
                {targets.length ? `To ${targets[0].label}` : 'Start an agent in this workspace to send.'}
              </span>
              <Button
                size="sm"
                disabled={!targets.length}
                onClick={() => {
                  if (sendToAgent(workspaceId, formatPickedElement(picked.element, note, picked.screenshot))) {
                    setPicked(null)
                  }
                }}
              >
                <Send className="size-3.5" /> Send to agent
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
