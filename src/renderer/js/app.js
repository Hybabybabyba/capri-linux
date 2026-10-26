import { Capri } from './capri.js';
import { FxLayer, GRAB_FRAMES } from './fx.js';
import { Chip, Mask } from './chip.js';
import { Panel } from './panel.js';
import { Voice } from './voice.js';
import { Brain } from './brain.js';
import { LINES } from './lines.js';
import { pick, power } from './util.js';

const host = window.host;
const t = LINES.ru;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const CUTINS = ['grin', 'laugh', 'eyes', 'many', 'look'];

async function boot() {
  const [config, image, intro, ...cutins] = await Promise.all([
    host.getConfig(),
    loadImage('../../assets/capri/capri-full.png'),
    Promise.all(GRAB_FRAMES.map((name) => loadImage(`../../assets/capri/intro-${name}.webp`).catch(() => null)))
      .then((cels) => Promise.all(cels.map((cel) => cel && createImageBitmap(cel))))
      .then((cels) => (cels[0] ? Object.fromEntries(GRAB_FRAMES.map((name, i) => [name, cels[i]])) : null)),
    ...CUTINS.map((name) => loadImage(`../../assets/capri/cutin-${name}.png`)),
    document.fonts.load('600 16px "Chakra Petch"'),
    document.fonts.load('400 11px "JetBrains Mono"'),
  ]);

  const fx = new FxLayer(document.getElementById('fx'), {
    cutins: Object.fromEntries(CUTINS.map((name, i) => [name, cutins[i]])),
    intro,
  });
  fx.resize(innerWidth, innerHeight);
  const chip = new Chip(document.getElementById('chip'));
  chip.place(innerWidth, innerHeight);
  const mask = new Mask(document.getElementById('mask'));

  const voice = new Voice();
  voice.configure(config);
  host.listSounds().then((list) => list.length && voice.loadCustom(list));

  const panel = new Panel({
    panel: document.getElementById('panel'),
    ticker: document.getElementById('ticker'),
    labels: t,
  });

  const capri = new Capri({
    root: document.getElementById('capri'),
    canvas: document.getElementById('sprite'),
    image,
    fx,
    voice,
  });
  capri.wander = config.wander;
  capri.possessWindows = config.possess;
  capri.setScale(config.scale);

  const brain = new Brain({ capri, panel, voice, host });

  const hudForm = document.getElementById('hud');
  const hudInput = document.getElementById('hud-input');
  let hudOpen = false;

  const openHud = async () => {
    if (hudOpen) return;
    hudOpen = true;
    if (capri.stowed) { host.setConfig({ visible: true }); await capri.unstow(); }
    capri.wake();
    await host.openHud();
    hudForm.hidden = false;
    requestAnimationFrame(() => hudForm.classList.add('is-open'));
    hudInput.focus();
  };
  const fitHudInput = () => {
    hudInput.style.height = 'auto';
    hudInput.style.height = `${hudInput.scrollHeight}px`;
  };
  hudInput.addEventListener('input', fitHudInput);
  const closeHud = async ({ returnFocus = true } = {}) => {
    if (!hudOpen) return;
    hudOpen = false;
    hudForm.classList.remove('is-open');
    hudInput.blur();
    hudInput.value = '';
    fitHudInput();
    setTimeout(() => { if (!hudOpen) hudForm.hidden = true; }, 250);
    if (returnFocus) await host.closeHud();
  };

  hudForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = hudInput.value.trim();
    if (!text) return;
    brain.ask(text);
    closeHud();
  });
  hudInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      hudForm.requestSubmit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      host.escape();
      closeHud({ returnFocus: false });
    }
  });

   let interactive = false;
  let mouse = null;
  const setInteractive = (on) => {
    if (on === interactive) return;
    interactive = on;
    host.setInteractive(on);
  };

  const onChip = () => Boolean(chip.visible && mouse && chip.contains(mouse.x, mouse.y, 0));
  const refreshHit = () => {
    if (hudOpen) return setInteractive(true);
    if (capri.dragging) return setInteractive(true);
    if (!mouse) return setInteractive(false);
    const r = panel.rect();
    const onPanel = r && mouse.x >= r.left && mouse.x <= r.right && mouse.y >= r.top && mouse.y <= r.bottom;
    document.body.style.cursor = onChip() ? 'pointer' : '';
    return setInteractive(Boolean(onPanel || capri.hit(mouse.x, mouse.y) || onChip()));
  };
  let wakeTimer = 0;
  const comeOut = () => {
    if (capri.stowed) host.setConfig({ visible: true });
    capri.unstow();
  };
  const hoverChip = () => {
    chip.pointer = chip.visible && mouse && chip.contains(mouse.x, mouse.y) ? mouse : null;
    const near = mask.visible && mouse && mask.contains(mouse.x, mouse.y, 30);
    mask.pointer = near ? mouse : null;
    if (!near) {
      clearTimeout(wakeTimer);
      wakeTimer = 0;
    } else if (!wakeTimer) {
      wakeTimer = setTimeout(() => {
        wakeTimer = 0;
        if (capri.dormant) capri.wake();
      }, 400);
    }
  };
  window.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    refreshHit();
    hoverChip();
  });
  document.addEventListener('mouseleave', () => {
    mouse = null;
    refreshHit();
    hoverChip();
  });
  host.onPointer((c) => {
    if (interactive) return;
    mouse = c && c.inside ? { x: c.x, y: c.y } : null;
    refreshHit();
    hoverChip();
  });

  const box = (el) => {
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
  };
  let sentZones = '';
  const sendZones = () => {
    const zones = [];
    if (!capri.hidden && !capri.stowed) zones.push(box(capri.canvas));
    const r = panel.rect();
    if (r) zones.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
    if (chip.visible) zones.push(box(chip.canvas));
    if (hudOpen) zones.push(box(hudForm));
    const hold = hudOpen || capri.dragging;
    const list = zones.filter(Boolean);
    const key = JSON.stringify([hold, list.map((z) => [z.x >> 3, z.y >> 3, z.w >> 3, z.h >> 3])]);
    if (key === sentZones) return;
    sentZones = key;
    host.setZones(list, hold);
  };
  setInterval(sendZones, 33);
  window.addEventListener('click', (e) => {
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) comeOut();
  });

  capri.onMove = (head) => {
    panel.setAnchor({ ...head, lean: capri.pointing ? -capri.pointing.dir : 0 }, capri.view);
    refreshHit();
  };
  capri.onTeleport = (phase) => (phase === 'start' ? panel.suspend() : panel.resume());
  capri.chipAt = () => chip.center();
  capri.onStow = () => {
    chip.setMode(capri.mode);
    chip.show();
  };
  capri.onUnstow = () => chip.hide();
  capri.onDoze = (phase, face) => {
    if (phase === 'start') {
      mask.place(face.x, face.y, capri.scale * 1.1);
      mask.show();
    } else if (phase === 'waking') {
      mask.wake();
    } else {
      mask.hide();
    }
  };
  capri.onMode = (mode, prev) => chip.setMode(mode, prev);
  capri.onGaze = (when) => {
    const lines = when === 'end' ? t.uplink : t.gaze;
    if (!panel.visible && Math.random() < (when === 'end' ? 0.6 : 0.4)) panel.say({ kind: 'info', line: pick(lines), hold: 3800 });
  };
  capri.onClick = () => {
    if (panel.visible) { panel.hide(); return; }
    if (hudOpen) { closeHud(); return; }
    openHud();
  };
  panel.onChar = (kind) => voice.play('blip', { mood: kind });
  panel.onTalk = (talking) => talking && capri.perform('talk');

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (done, max = 15000) => {
    for (const t0 = Date.now(); !done() && Date.now() - t0 < max;) await wait(100);
  };
  const free = () => !capri.busy && !capri.act && capri.stance !== 'fall';
  brain.onShowcase = async () => {
    const s = t.showcase;
    const caption = (line) => panel.say({ kind: 'info', line, hold: 2200 });
    capri.nextMove = capri.nextGaze = performance.now() + 120000;
    if (capri.stowed) await capri.unstow();
    if (capri.dormant) capri.wake();
    await until(free);
    panel.hide();

    caption(s.minds);
    await wait(1000);
    await capri.perform('split');
    await wait(900);

    caption(s.zap);
    await wait(1000);
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    await wait(1800);

    panel.hide();
    if (capri.gaze({ big: true })) await until(() => !capri.sky);
    await wait(2500);

    caption(s.sleep);
    await wait(1400);
    panel.hide();
    capri.setMode('sleep');
    await wait(2500);
    await capri.doze();
    await wait(4500);
    capri.wake();
    await until(free);
    await wait(1200);

    caption(s.chip);
    await wait(1600);
    panel.hide();
    await capri.stow();
    await wait(3500);
    await capri.unstow();
    await wait(600);
    panel.say({ kind: 'info', line: s.end, hold: 5000 });
  };

  host.onResize(({ width, height }) => {
    fx.resize(width, height);
    chip.place(width, height);
    capri.setView(width, height);
  });
  capri.onMenu = () => host.openMenu();
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (chip.visible && chip.contains(e.clientX, e.clientY, 0)) host.openMenu();
  });

  window.addEventListener('resize', () => {
    fx.resize(innerWidth, innerHeight);
    chip.place(innerWidth, innerHeight);
    capri.setView(innerWidth, innerHeight);
  });

  const applyPower = (p) => { power.slow = p?.saver ? 2 : 1; };
  host.onPower?.(applyPower);
  host.power?.().then(applyPower);

  host.onConfig((cfg) => {
    voice.configure(cfg);
    capri.wander = cfg.wander;
    capri.possessWindows = cfg.possess;
    if (cfg.scale !== capri.scale) capri.setScale(cfg.scale);
  });

  host.onCommand(async (cmd) => {
    switch (cmd.name) {
      case 'teleport':
        capri.teleport(capri.spot('random'));
        break;
      case 'status':
        brain.status();
        break;
      case 'hud':
        openHud();
        break;
      case 'stow':
        if (cmd.on) { await closeHud({ returnFocus: false }); capri.stow(); } else capri.unstow();
        break;
      case 'satellite':
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        capri.wake();
        if (capri.stance === 'peek') await capri.unpeek();
        if (!capri.gaze({ big: true })) setTimeout(() => capri.gaze({ big: true }), 1500);
        break;
      case 'showcase':
        brain.onShowcase?.();
        break;
      case 'progress':
      case 'task':
        if (capri.stowed) {
          host.setConfig({ visible: true });
          await capri.unstow();
        }
        if (cmd.name === 'progress') brain.progress(cmd.line);
        else brain.ask(cmd.prompt, { label: cmd.label });
        break;
      case 'pose':
        capri.debug = cmd.params || null;
        if (cmd.still) capri.nextMove = capri.nextGaze = Infinity;
        if (cmd.hush) {
          panel.setTicker(null);
          panel.hide();
        }
        if (cmd.scale) capri.setScale(cmd.scale);
        if (cmd.stance) capri.setStance(cmd.stance, cmd);
        if (cmd.at) capri.pos = cmd.at;
        if (cmd.facing) capri.facing = cmd.facing;
        capri.drawFrame();
        break;
      case 'intro':
        panel.hide();
        await capri.intro(capri.spot('post'), cmd.still ? { still: true } : {});
        break;
      case 'freeze':
        capri.hidden = Boolean(cmd.on);
        break;
      case 'act':
        if (cmd.act === 'sit') {
          const seat = capri.pickSeat();
          if (seat) capri.sitOn(seat);
        } else if (typeof capri[cmd.act] === 'function') capri[cmd.act](...(cmd.args || []));
        else capri.perform(cmd.act, cmd.dir || 0);
        break;
      default:
        break;
    }
  });

  if (config.visible === false) capri.stowNow();
  else if (intro) await capri.intro(capri.spot('post'));
  else await capri.materialize(capri.spot('post'));
  const groqStatus = await host.groqStatus();
  if (!groqStatus.hasKey) {
    panel.say({ kind: 'error', line: t.noKey, hold: 10000 });
  } else {
    panel.say({ kind: 'info', line: pick(t.online), hold: 4000 });
  }
}

boot().catch((err) => {
  console.error('[capri] boot failed', err);
});
