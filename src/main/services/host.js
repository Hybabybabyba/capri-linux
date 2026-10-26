'use strict';

const MAX_BACKOFF = 8;
const FIRST_TICK_MS = 5000;

function createHost(ctx) {
  const entries = [];
  let running = false;

  const schedule = (e, delay) => { e.timer = setTimeout(() => runTick(e), delay); };

  async function runTick(e) {
    if (!running) return;
    try {
      await e.svc.tick(ctx);
      e.backoff = 1;
    } catch (err) {
      e.backoff = Math.min(e.backoff * 2, MAX_BACKOFF);
      console.error(`[svc:${e.svc.name}] tick: ${err.message} (следующий через ×${e.backoff})`);
    }
    if (running) schedule(e, e.svc.every * e.backoff * (e.svc.steadyPace ? 1 : ctx.pace || 1));
  }

  return {
    add(svc) {
      entries.push({ svc, timer: null, backoff: 1 });
      return this;
    },
    start() {
      running = true;
      for (const e of entries) {
        try {
          Promise.resolve(e.svc.start?.(ctx)).catch((err) => console.error(`[svc:${e.svc.name}] start: ${err.message}`));
        } catch (err) {
          console.error(`[svc:${e.svc.name}] start: ${err.message}`);
          continue;
        }
        if (e.svc.tick && e.svc.every) schedule(e, FIRST_TICK_MS + Math.random() * 3000);
      }
    },
    stop() {
      running = false;
      for (const e of entries) {
        clearTimeout(e.timer);
        try { e.svc.stop?.(); } catch {}
      }
    },
  };
}

module.exports = { createHost };
