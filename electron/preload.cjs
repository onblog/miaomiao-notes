'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Only this surface is exposed to the renderer. Nothing else from Node or
 * Electron leaks through, so the UI cannot touch the filesystem directly.
 */
contextBridge.exposeInMainWorld('miaomiao', {
  platform: process.platform,

  vault: {
    info: () => ipcRenderer.invoke('vault:info'),
    open: () => ipcRenderer.invoke('vault:open'),
    choose: () => ipcRenderer.invoke('vault:choose'),
    switchTo: (path) => ipcRenderer.invoke('vault:switch', path),
  },

  notes: {
    tree: () => ipcRenderer.invoke('notes:tree'),
    list: () => ipcRenderer.invoke('notes:list'),
    read: (path) => ipcRenderer.invoke('notes:read', path),
    write: (path, content) => ipcRenderer.invoke('notes:write', path, content),
    create: (path, content) => ipcRenderer.invoke('notes:create', path, content),
    mkdir: (path) => ipcRenderer.invoke('notes:mkdir', path),
    rename: (from, to) => ipcRenderer.invoke('notes:rename', from, to),
    remove: (path) => ipcRenderer.invoke('notes:remove', path),
    search: (query) => ipcRenderer.invoke('notes:search', query),
    saveImage: (notePath, base64, ext) =>
      ipcRenderer.invoke('notes:save-image', notePath, base64, ext),
    reveal: (path) => ipcRenderer.invoke('notes:reveal', path),
    menu: (path) => ipcRenderer.invoke('notes:menu', path),
  },

  dialog: {
    confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
  },

  app: {
    version: () => ipcRenderer.invoke('app:version'),
    site: () => ipcRenderer.invoke('app:site'),
    checkUpdate: () => ipcRenderer.invoke('app:check-update'),
    openSite: () => ipcRenderer.invoke('app:open-site'),
    openProfile: () => ipcRenderer.invoke('app:open-profile'),
    openEmail: () => ipcRenderer.invoke('app:open-email'),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    reset: () => ipcRenderer.invoke('settings:reset'),
  },

  onMenuNewNote: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:new-note', listener);
    return () => ipcRenderer.removeListener('menu:new-note', listener);
  },

  onVaultChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('vault:changed', listener);
    return () => ipcRenderer.removeListener('vault:changed', listener);
  },

  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:open-settings', listener);
    return () => ipcRenderer.removeListener('menu:open-settings', listener);
  },

  onSettingsChanged: (callback) => {
    const listener = (_event, next) => callback(next);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
});
