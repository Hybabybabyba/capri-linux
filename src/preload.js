'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('host', {
  onCommand: on('capri:command'),
  onConfig: on('capri:config'),
  onResize: on('overlay:resize'),
  onPower: on('capri:power'),
  power: () => ipcRenderer.invoke('env:power'),
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', Boolean(on)),
  setZones: (zones, hold) => ipcRenderer.send('overlay:zones', { zones, hold: Boolean(hold) }),
  onPointer: on('overlay:pointer'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  openMenu: () => ipcRenderer.send('menu:open'),

  openHud: () => ipcRenderer.invoke('hud:open'),
  closeHud: () => ipcRenderer.invoke('hud:close'),
  escape: () => ipcRenderer.send('overlay:escape'),

  groqStatus: () => ipcRenderer.invoke('groq:status'),
  askGroq: (messages) => ipcRenderer.invoke('groq:ask', messages),
  onAgentStep: on('agent:step'),
  onNotice: on('capri:notice'),
});
