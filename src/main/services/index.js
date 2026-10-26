'use strict';

const { EventEmitter } = require('node:events');
const { createHost } = require('./host');
const ingress = require('./ingress');
const watchdog = require('./watchdog');
const archSentinel = require('./arch-sentinel');
const envAdapter = require('./env-adapter');
const resourceSentinel = require('./resource-sentinel');

const DEFAULT_COOLDOWN_MS = 15000;

function createServices({ config, groq, hyprQuery, deliver, dataDir }) {
  const bus = new EventEmitter();
  bus.setMaxListeners(50);
  const lastShown = new Map();
  let holding = false;
  const held = [];
  const holdNotices = (on) => {
    holding = Boolean(on);
    return holding ? [] : held.splice(0);
  };

  async function notice(n) {
    const now = Date.now();
    if (n.key) {
      if (now - (lastShown.get(n.key) || 0) < (n.cooldownMs ?? DEFAULT_COOLDOWN_MS)) return;
      lastShown.set(n.key, now);
    }
    if (holding) {
      held.push(n);
      return;
    }
    let quiet = false;
    try {
      const active = JSON.parse(await hyprQuery('j/activewindow'));
      quiet = Boolean(active?.fullscreen);
    } catch {}
    deliver(n, { quiet });
  }

  const ctx = { bus, config, groq, hyprQuery, notice, holdNotices, dataDir, env: null, pace: 1 };
  const host = createHost(ctx).add(envAdapter).add(ingress).add(watchdog).add(archSentinel).add(resourceSentinel);
  return { bus, start: () => host.start(), stop: () => host.stop() };
}

module.exports = { createServices, gpuSwitches: envAdapter.gpuSwitches };
