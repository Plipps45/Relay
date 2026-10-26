import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, type BrowserWindow } from 'electron'
import type { UpdateStatus } from '@shared/types'
import { isNewerVersion } from '@shared/version'
import { store } from './store'

const RELEASES_URL = 'https://api.github.com/repos/Plipps45/Relay/releases/latest'
const INSTALLER = /^Relay-Setup-.+\.exe$/i

type ReleaseAsset = { name: string; size: number; browser_download_url: string }

let status: UpdateStatus = { state: 'idle' }
let installerPath: string | null = null
let running: Promise<UpdateStatus> | null = null

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

function publish(getWindow: () => BrowserWindow | null, next: UpdateStatus): UpdateStatus {
  status = next
  getWindow()?.webContents.send('updater:status', status)
  return status
}

async function check(getWindow: () => BrowserWindow | null): Promise<UpdateStatus> {
  if (status.state === 'ready') {
    return status
  }
  publish(getWindow, { state: 'checking' })
  try {
    const response = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Relay' } })
    if (response.status === 404) {
      return publish(getWindow, { state: 'up-to-date' })
    }
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}`)
    }
    const release = (await response.json()) as { tag_name: string; assets: ReleaseAsset[] }
    const version = release.tag_name.replace(/^v/, '')
    if (!isNewerVersion(release.tag_name, app.getVersion())) {
      return publish(getWindow, { state: 'up-to-date' })
    }
    const asset = release.assets.find((a) => INSTALLER.test(a.name))
    if (!asset) {
      throw new Error(`Release ${release.tag_name} has no Windows installer`)
    }
    if (!app.isPackaged) {
      // Development builds have no installation to replace.
      return publish(getWindow, { state: 'available', version })
    }
    publish(getWindow, { state: 'downloading', version })
    const dir = join(app.getPath('temp'), 'relay-update')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, asset.name)
    if (!existsSync(target) || statSync(target).size !== asset.size) {
      const download = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Relay' } })
      if (!download.ok || !download.body) {
        throw new Error(`Download failed (${download.status})`)
      }
      const partial = `${target}.part`
      await pipeline(Readable.fromWeb(download.body as import('node:stream/web').ReadableStream), createWriteStream(partial))
      if (statSync(partial).size !== asset.size) {
        rmSync(partial, { force: true })
        throw new Error('Downloaded installer is incomplete')
      }
      rmSync(target, { force: true })
      renameSync(partial, target)
    }
    installerPath = target
    return publish(getWindow, { state: 'ready', version })
  } catch (error) {
    return publish(getWindow, { state: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

export function checkForUpdates(getWindow: () => BrowserWindow | null): Promise<UpdateStatus> {
  running ??= check(getWindow).finally(() => {
    running = null
  })
  return running
}

/** Checks once per calendar day, on the first launch of that day. */
export function checkForUpdatesDaily(getWindow: () => BrowserWindow | null): void {
  if (store().get().lastUpdateCheck === today()) {
    return
  }
  store().update((s) => {
    s.lastUpdateCheck = today()
  })
  void checkForUpdates(getWindow)
}

export function updateStatus(): UpdateStatus {
  return status
}

/** Runs the downloaded NSIS installer silently over the current install; it relaunches Relay when done. */
export function installUpdate(): void {
  if (status.state !== 'ready' || !installerPath) {
    return
  }
  spawn(installerPath, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
  app.quit()
}
