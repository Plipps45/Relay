import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { RelayApi } from './api-types'

function on<Args extends unknown[]>(channel: string, listener: (...args: Args) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]): void => listener(...(args as Args))
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: RelayApi = {
  platform: process.platform,
  state: {
    get: () => invoke('state:get'),
    updateSettings: (patch) => invoke('settings:update', patch),
    updateUi: (patch) => invoke('ui:update', patch),
    setSession: (workspaceId, session) => invoke('session:set', workspaceId, session)
  },
  dialog: {
    pickFolder: (title) => invoke('dialog:pickFolder', title)
  },
  projects: {
    add: (path) => invoke('projects:add', path),
    update: (id, patch) => invoke('projects:update', id, patch),
    remove: (id) => invoke('projects:remove', id),
    clone: (url, parentDir) => invoke('projects:clone', url, parentDir)
  },
  workspaces: {
    list: () => invoke('workspaces:list'),
    create: (request) => invoke('workspaces:create', request),
    remove: (request) => invoke('workspaces:remove', request),
    updateMeta: (path, patch) => invoke('workspaces:updateMeta', path, patch),
    suggestName: (projectId) => invoke('workspaces:suggestName', projectId)
  },
  git: {
    status: (cwd) => invoke('git:status', cwd),
    branches: (cwd) => invoke('git:branches', cwd),
    defaultBase: (cwd) => invoke('git:defaultBase', cwd),
    stage: (cwd, paths) => invoke('git:stage', cwd, paths),
    unstage: (cwd, paths) => invoke('git:unstage', cwd, paths),
    discard: (cwd, paths, untracked) => invoke('git:discard', cwd, paths, untracked),
    commit: (cwd, message, all) => invoke('git:commit', cwd, message, all),
    push: (cwd) => invoke('git:push', cwd),
    pull: (cwd) => invoke('git:pull', cwd),
    log: (cwd, limit) => invoke('git:log', cwd, limit),
    diffContents: (cwd, path, oldPath, mode) => invoke('git:diffContents', cwd, path, oldPath, mode)
  },
  fs: {
    readDir: (path) => invoke('fs:readDir', path),
    readFile: (path) => invoke('fs:readFile', path),
    writeFile: (path, content) => invoke('fs:writeFile', path, content),
    create: (path, directory) => invoke('fs:create', path, directory),
    rename: (from, to) => invoke('fs:rename', from, to),
    trash: (path) => invoke('fs:trash', path),
    listFiles: (root) => invoke('fs:listFiles', root),
    search: (root, query, options) => invoke('fs:search', root, query, options),
    exists: (path) => invoke('fs:exists', path),
    watch: (workspaceId, root) => ipcRenderer.send('fs:watch', workspaceId, root),
    unwatch: (workspaceId) => ipcRenderer.send('fs:unwatch', workspaceId),
    onChanged: (listener) => on('fs:changed', listener),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  pty: {
    spawn: (request) => invoke('pty:spawn', request),
    shellKind: () => invoke('pty:shellKind'),
    isAlive: (id) => invoke('pty:isAlive', id),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (listener) => on('pty:data', listener),
    onExit: (listener) => on('pty:exit', listener)
  },
  agents: {
    detect: (force) => invoke('agents:detect', force)
  },
  skills: {
    list: (projectId) => invoke('skills:list', projectId),
    setEnabled: (projectId, keys, enabled) => invoke('skills:setEnabled', projectId, keys, enabled),
    adapt: (projectId, key) => invoke('skills:adapt', projectId, key),
    remove: (projectId, key) => invoke('skills:remove', projectId, key),
    files: (dir) => invoke('skills:files', dir)
  },
  usage: {
    get: () => invoke('usage:get')
  },
  obsidian: {
    vaults: () => invoke('obsidian:vaults'),
    index: (root) => invoke('obsidian:index', root),
    search: (root, query, limit) => invoke('obsidian:search', root, query, limit),
    create: (root, path, content) => invoke('obsidian:create', root, path, content),
    template: (root, template) => invoke('obsidian:template', root, template)
  },
  shell: {
    openExternal: (url) => invoke('shell:openExternal', url),
    showItem: (path) => invoke('shell:showItem', path),
    openPath: (path) => invoke('shell:openPath', path),
    openInEditor: (path) => invoke('shell:openInEditor', path)
  },
  app: {
    notify: (payload) => invoke('app:notify', payload),
    saveImage: (base64Png) => invoke('app:saveImage', base64Png),
    onNotificationClick: (listener) => on('notification:click', listener),
    onFocusChange: (listener) => on('window:focus', listener),
    onBeforeClose: (listener) => on('app:beforeClose', listener),
    closeReady: () => ipcRenderer.send('app:closeReady'),
    setTitleBarOverlay: (color, symbolColor) => invoke('window:setOverlay', color, symbolColor)
  }
}

contextBridge.exposeInMainWorld('relay', api)
