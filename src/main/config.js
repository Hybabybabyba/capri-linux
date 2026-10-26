'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = {
  scale: 0.6,
  muted: false,
  volume: 0.7,
  displayId: null,
  wander: true,
  possess: true,
  visible: true,
  watchdog: true,
  diagnose: true,
  archSentinel: true,
  gameMode: true,
  gameFreeze: false,
  gameRefresh: true,
  buildBoost: true,
  freezeApps: ['zen', 'firefox', 'floorp', 'librewolf', 'chromium', 'chrome', 'brave', 'vivaldi-bin'],
  gameClasses: ['^dota2$', '^cs2$', '^factorio$', '^Minecraft', '^PathOfExile', '^hl2_linux$'],
  gameHooks: { start: '', stop: '' },
};

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(patch) {
  cache = { ...load(), ...patch };
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[capri] could not save config:', err.message);
  }
  return cache;
}

module.exports = { load, save, DEFAULTS };
