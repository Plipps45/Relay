import { join } from 'node:path'
import { BrowserWindow, Menu, app, ipcMain, nativeTheme, shell } from 'electron'
import { workspaceWatchers } from './files'
import { registerIpc } from './ipc'
import { ptyManager } from './pty'
import { store } from './store'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const dark = store().get().settings.theme === 'dark' || (store().get().settings.theme === 'system' && nativeTheme.shouldUseDarkColors)
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Relay',
    backgroundColor: dark ? '#0a0a0a' : '#ffffff',
    titleBarStyle: 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : { color: dark ? '#0a0a0a' : '#ffffff', symbolColor: dark ? '#a1a1a1' : '#525252', height: 38 },
    trafficLightPosition: { x: 14, y: 12 },
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('focus', () => mainWindow?.webContents.send('window:focus', true))
  mainWindow.on('blur', () => mainWindow?.webContents.send('window:focus', false))
  // Why: terminal scrollback lives in the renderer, so it gets one chance to persist before teardown.
  let readyToClose = false
  mainWindow.on('close', (event) => {
    if (readyToClose || !mainWindow) {
      return
    }
    event.preventDefault()
    const window = mainWindow
    const finish = (): void => {
      readyToClose = true
      store().flush()
      window.close()
    }
    const timeout = setTimeout(finish, 1500)
    ipcMain.once('app:closeReady', () => {
      clearTimeout(timeout)
      finish()
    })
    window.webContents.send('app:beforeClose')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Links clicked inside the app open in the system browser; the in-app browser tab uses <webview>.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.setName('Relay')
if (process.platform === 'win32') {
  app.setAppUserModelId('dev.relay.app')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    registerIpc(() => mainWindow)
    // Webviews in browser tabs get their own popups routed to the system browser.
    app.on('web-contents-created', (_event, contents) => {
      if (contents.getType() === 'webview') {
        contents.setWindowOpenHandler(({ url }) => {
          if (/^https?:\/\//i.test(url)) {
            void shell.openExternal(url)
          }
          return { action: 'deny' }
        })
      }
    })
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('before-quit', () => {
    store().flush()
    workspaceWatchers.closeAll()
    ptyManager.killAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
