/// <reference types="vite/client" />
import type { DetailedHTMLProps, HTMLAttributes } from 'react'
import type { RelayApi } from '../../preload/api-types'

declare global {
  interface Window {
    relay: RelayApi
  }
}

/** Subset of Electron's <webview> element API the browser tab uses. */
export interface WebviewElement extends HTMLElement {
  src: string
  loadURL: (url: string) => Promise<void>
  getURL: () => string
  getTitle: () => string
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  reload: () => void
  stop: () => void
  isLoading: () => boolean
  openDevTools: () => void
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
  capturePage: (rect?: { x: number; y: number; width: number; height: number }) => Promise<{ toDataURL: () => string; isEmpty: () => boolean }>
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        allowpopups?: string
        webpreferences?: string
      }
    }
  }
}

export {}
