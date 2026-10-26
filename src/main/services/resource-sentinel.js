'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawnSync, spawn } = require('node:child_process');
const { procTable, descendants } = require('../tools/context_snapshot.js');

const TICK_MS = 5000;
const GAME_GONE_TICKS = 2;
const BUILD_ON_TICKS = 2;
const BUILD_GONE_TICKS = 3;
const BUILD_LOAD = 0.75;
const BUILD_SUMMARY_MS = 60000;
const LOW_BATTERY_BOOST = 30;
const BUILD_COMM = new Set(['cargo', 'rustc', 'cc1', 'cc1plus', 'cc1obj', 'ninja', 'make', 'gmake', 'mold', 'ld.lld', 'clang', 'clang++',
  'javac', 'gradle', 'go', 'docker-buildx', 'buildkitd', 'makepkg', 'nix-build', 'nix-daemon', 'hydra-queue-run', 'hydra-evaluator',
  'bazel', 'dotnet', 'tsc', 'esbuild', 'zig']);
const GAME_COMM = new Set(['gamescope', 'gamescope-wl', 'gamescopereaper']);
const HYPR_EFFECTS = ['animations:enabled', 'decoration:blur:enabled', 'decoration:shadow:enabled'];

let ctx = null;
let mode = null;
let goneTicks = 0;
let buildTicks = 0;
const appNames = new Map();

const stateFile = () => path.join(ctx.dataDir, 'resource-sentinel.json');

function saveState() {
  try {
    const status = mode && { kind: mode.kind, name: mode.name, since: mode.since, frozen: frozenNames() };
    fs.writeFileSync(stateFile(), JSON.stringify({ active: mode ? { ...mode, status } : null }, null, 2));
  } catch (err) {
    console.error('[svc:resource-sentinel] state:', err.message);
  }
}

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
};
const has = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, cmd)));

function sh(cmd, args, sync = false) {
  if (!has(cmd)) return sync ? { ok: false, stdout: '' } : Promise.resolve({ ok: false, stdout: '' });
  if (sync) {
    const r = spawnSync(cmd, args, { timeout: 3000, encoding: 'utf8' });
    return { ok: r.status === 0, stdout: r.stdout || '' };
  }
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
  });
}

const hypr = async (cmd) => {
  try { return await ctx.hyprQuery(cmd); } catch { return ''; }
};

const startOf = (pid) => {
  const stat = read(`/proc/${pid}/stat`);
  return stat ? Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]) : null;
};

const cmdline = (pid) => read(`/proc/${pid}/cmdline`).split('\0').filter(Boolean).join(' ');

function battery() {
  try {
    const bat = fs.readdirSync('/sys/class/power_supply').find((n) => read(`/sys/class/power_supply/${n}/type`).trim() === 'Battery'
      && read(`/sys/class/power_supply/${n}/scope`).trim() !== 'Device');
    if (!bat) return null;
    return { capacity: Number(read(`/sys/class/power_supply/${bat}/capacity`)), discharging: read(`/sys/class/power_supply/${bat}/status`).trim() === 'Discharging' };
  } catch { return null; }
}

function cpuTemp() {
  let max = null;
  try {
    for (const h of fs.readdirSync('/sys/class/hwmon')) {
      const dir = `/sys/class/hwmon/${h}`;
      if (!/^(k10temp|zenpower|coretemp|cpu_thermal)$/.test(read(`${dir}/name`).trim())) continue;
      for (const f of fs.readdirSync(dir).filter((x) => /^temp\d+_input$/.test(x))) {
        const t = Number(read(`${dir}/${f}`)) / 1000;
        if (Number.isFinite(t) && (max === null || t > max)) max = t;
      }
    }
  } catch {}
  return max;
}

function steamAppName(appId) {
  if (appNames.has(appId)) return appNames.get(appId);
  const roots = [path.join(os.homedir(), '.local/share/Steam'), path.join(os.homedir(), '.steam/steam')];
  for (const root of [...roots]) {
    for (const m of read(path.join(root, 'steamapps/libraryfolders.vdf')).matchAll(/"path"\s+"([^"]+)"/g)) roots.push(m[1]);
  }
  for (const root of new Set(roots)) {
    const name = (read(path.join(root, `steamapps/appmanifest_${appId}.acf`)).match(/"name"\s+"([^"]+)"/) || [])[1];
    if (name) { appNames.set(appId, name); return name; }
  }
  return null;
}

async function detectGame(table) {
  const cfg = ctx.config.load();
  const classes = (cfg.gameClasses || []).map((c) => { try { return new RegExp(c, 'i'); } catch { return null; } }).filter(Boolean);
  let clients = [];
  try { clients = JSON.parse(await hypr('j/clients') || '[]'); } catch {}

  for (const p of table.values()) {
    if (p.comm !== 'reaper') continue;
    const m = cmdline(p.pid).match(/SteamLaunch.*AppId=(\d+)/);
    if (!m) continue;
    const win = clients.find((c) => c.class === `steam_app_${m[1]}`);
    return { name: steamAppName(m[1]) || win?.title || `Steam ${m[1]}`, pid: p.pid, monitor: win?.monitor };
  }
  const scope = [...table.values()].find((p) => GAME_COMM.has(p.comm));
  const win = clients.find((c) => /^steam_app_\d+$|^gamescope/i.test(c.class) || classes.some((re) => re.test(c.class))
    || (c.fullscreen && /\.exe$/i.test(c.class)));
  if (win) return { name: win.title || win.class, pid: win.pid, monitor: win.monitor };
  if (scope) return { name: 'gamescope', pid: scope.pid };
  return null;
}

function detectBuild(table) {
  const procs = [...table.values()].filter((p) => BUILD_COMM.has(p.comm));
  if (!procs.length) return null;
  const busy = os.loadavg()[0] >= os.cpus().length * BUILD_LOAD;
  return busy ? { name: [...new Set(procs.map((p) => p.comm))].slice(0, 3).join(', ') } : null;
}

async function quietNotifications() {
  if ((await sh('swaync-client', ['-D'])).stdout.trim() === 'false' && (await sh('swaync-client', ['-dn'])).ok) return { type: 'dnd', daemon: 'swaync' };
  const mako = await sh('makoctl', ['mode']);
  if (mako.ok && !mako.stdout.includes('do-not-disturb') && (await sh('makoctl', ['mode', '-a', 'do-not-disturb'])).ok) return { type: 'dnd', daemon: 'mako' };
  if ((await sh('dunstctl', ['is-paused'])).stdout.trim() === 'false' && (await sh('dunstctl', ['set-paused', 'true'])).ok) return { type: 'dnd', daemon: 'dunst' };
  return null;
}

async function boostPower() {
  const bat = battery();
  if (bat?.discharging && bat.capacity < LOW_BATTERY_BOOST) return null;
  const cur = (await sh('powerprofilesctl', ['get'])).stdout.trim();
  if (!cur || cur === 'performance' || !(await sh('powerprofilesctl', ['list'])).stdout.includes('performance')) return null;
  return (await sh('powerprofilesctl', ['set', 'performance'])).ok ? { type: 'power', profile: cur } : null;
}

async function hyprOptions(names, value) {
  const was = {};
  for (const name of names) {
    try {
      const opt = JSON.parse(await hypr(`j/getoption ${name}`) || '{}');
      if (Number.isInteger(opt.int) && opt.int !== value) was[name] = opt.int;
    } catch {}
  }
  if (!Object.keys(was).length) return null;
  await hypr(`[[BATCH]]${Object.keys(was).map((n) => `keyword ${n} ${value}`).join(';')}`);
  return { type: 'hypr', options: was };
}

const monitorSpec = (m, rate) => `${m.name},${m.width}x${m.height}@${rate},${m.x}x${m.y},${m.scale}${m.transform ? `,transform,${m.transform}` : ''},vrr,${m.vrr ? 1 : 0}`;

async function maxRefresh(monitorId) {
  let monitors = [];
  try { monitors = JSON.parse(await hypr('j/monitors') || '[]'); } catch { return null; }
  const m = monitors.find((x) => x.id === monitorId) || monitors.find((x) => x.focused);
  if (!m) return null;
  const rates = (m.availableModes || []).map((s) => s.match(/^(\d+)x(\d+)@([\d.]+)Hz$/))
    .filter((r) => r && Number(r[1]) === m.width && Number(r[2]) === m.height).map((r) => Number(r[3]));
  const best = Math.max(...rates);
  if (!Number.isFinite(best) || best <= m.refreshRate + 1) return null;
  await hypr(`keyword monitor ${monitorSpec(m, best.toFixed(2))}`);
  return { type: 'monitor', spec: monitorSpec(m, m.refreshRate.toFixed(2)), name: m.name, from: Math.round(m.refreshRate), to: Math.round(best) };
}

async function audioPids() {
  const out = (await sh('pactl', ['list', 'sink-inputs'])).stdout;
  return new Set([...out.matchAll(/application\.process\.id = "(\d+)"/g)].map((m) => Number(m[1])));
}

async function freezeApps(table, game) {
  const apps = new Set(ctx.config.load().freezeApps || []);
  const audio = await audioPids();
  const protectedPids = new Set([process.pid, process.ppid, ...(game?.pid ? [game.pid, ...descendants(table, game.pid).map((p) => p.pid)] : [])]);
  const procs = [];
  const roots = [...table.values()].filter((p) => apps.has(p.comm) && !apps.has(table.get(p.ppid)?.comm));
  for (const root of roots) {
    const tree = [root, ...descendants(table, root.pid)];
    if (tree.some((p) => audio.has(p.pid) || protectedPids.has(p.pid))) continue;
    for (const p of tree) {
      try {
        process.kill(p.pid, 'SIGSTOP');
        procs.push({ pid: p.pid, start: p.start, comm: p.comm, root: root.comm });
      } catch {}
    }
  }
  return procs.length ? { type: 'frozen', procs } : null;
}

function runHook(cmd, sync) {
  if (!cmd) return;
  if (sync) spawnSync('/bin/bash', ['-c', cmd], { timeout: 5000 });
  else spawn('/bin/bash', ['-c', cmd], { detached: true, stdio: 'ignore' }).unref();
}

function undoEntry(e, sync) {
  switch (e.type) {
    case 'dnd':
      if (e.daemon === 'swaync') sh('swaync-client', ['-df'], sync);
      else if (e.daemon === 'mako') sh('makoctl', ['mode', '-r', 'do-not-disturb'], sync);
      else sh('dunstctl', ['set-paused', 'false'], sync);
      break;
    case 'power':
      sh('powerprofilesctl', ['set', e.profile], sync);
      break;
    case 'hypr':
      sh('hyprctl', ['--batch', Object.entries(e.options).map(([n, v]) => `keyword ${n} ${v}`).join(';')], sync);
      break;
    case 'monitor':
      sh('hyprctl', ['keyword', 'monitor', e.spec], sync);
      break;
    case 'frozen':
      for (const p of e.procs) {
        if (startOf(p.pid) === p.start) { try { process.kill(p.pid, 'SIGCONT'); } catch {} }
      }
      break;
    case 'hook':
      runHook(e.cmd, sync);
      break;
    case 'hold':
      return ctx.holdNotices(false);
    default:
  }
  return null;
}

function frozenNames() {
  const f = mode?.undo.find((e) => e.type === 'frozen');
  return f ? [...new Set(f.procs.map((p) => p.root))] : [];
}

async function enter(kind, target, manual = false) {
  const cfg = ctx.config.load();
  const bat = battery();
  mode = {
    kind, name: target.name, since: Date.now(), manual, undo: [],
    stats: { battery0: bat?.capacity ?? null, peakLoad: os.loadavg()[0], maxTemp: cpuTemp() },
  };
  const step = async (fn) => {
    try {
      const e = await fn();
      if (e) { mode.undo.push(e); saveState(); }
    } catch (err) {
      console.error(`[svc:resource-sentinel] ${kind}:`, err.message);
    }
  };
  saveState();
  if (kind === 'game') {
    await step(() => { ctx.holdNotices(true); return { type: 'hold' }; });
    await step(quietNotifications);
    await step(boostPower);
    await step(() => hyprOptions(HYPR_EFFECTS, 0));
    if (cfg.gameRefresh) await step(() => maxRefresh(target.monitor));
    if (cfg.gameFreeze) {
      await step(() => hyprOptions(['misc:enable_anr_dialog'], 0));
      await step(() => freezeApps(procTable(), target));
    }
    if (cfg.gameHooks?.start) runHook(cfg.gameHooks.start, false);
    if (cfg.gameHooks?.stop) mode.undo.push({ type: 'hook', cmd: cfg.gameHooks.stop });
  } else {
    await step(boostPower);
  }
  saveState();
}

function duration(ms) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${Math.max(1, m)} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

async function leave() {
  if (!mode) return;
  const ended = mode;
  const frozen = frozenNames();
  let held = [];
  for (const e of [...ended.undo].reverse()) held = undoEntry(e, false) || held;
  mode = null;
  goneTicks = 0;
  saveState();

  const ms = Date.now() - ended.since;
  if (ended.kind === 'build' && ms < BUILD_SUMMARY_MS) return;
  const bat = battery();
  const { stats } = ended;
  const monitor = ended.undo.find((e) => e.type === 'monitor');
  const facts = [
    stats.battery0 !== null && bat ? `батарея ${stats.battery0}→${bat.capacity}%` : '',
    `пик нагрузки ${stats.peakLoad.toFixed(1)} на ${os.cpus().length} потоков`,
    stats.maxTemp !== null ? `макс. t° CPU ${Math.round(stats.maxTemp)}°C` : '',
  ].filter(Boolean).join(', ');
  const restored = [
    frozen.length ? `разморозила ${frozen.join(', ')}` : '',
    monitor ? `вернула ${monitor.from} Гц` : '',
    ended.undo.some((e) => e.type === 'power') ? 'вернула профиль питания' : '',
  ].filter(Boolean).join(', ');
  const heldLines = held.map((n) => `${n.title || 'событие'}: ${n.line}`);
  ctx.notice({
    kind: 'info',
    key: `resource:${ended.kind}`,
    title: ended.kind === 'game' ? 'Игра окончена' : 'Сборка закончилась',
    face: 'smug',
    line: `${ended.name}: ${duration(ms)}. ${facts.charAt(0).toUpperCase()}${facts.slice(1)}.${restored ? ` Всё вернула: ${restored}.` : ''}${heldLines.length ? ` Пока тебя не было: ${heldLines.length} уведомл.` : ''}`,
    reply: heldLines.join('\n') || undefined,
    context: [
      `${ended.kind === 'game' ? 'Игровой режим' : 'Режим сборки'} «${ended.name}» длился ${duration(ms)}; ${facts}.`,
      restored ? `После него: ${restored}.` : '',
      ...held.map((n) => n.context || `${n.title}: ${n.line}`),
    ].filter(Boolean).join('\n'),
  });
}

function recover() {
  let saved;
  try { saved = JSON.parse(read(stateFile()) || '{}').active; } catch { return; }
  if (!saved?.undo?.length) return;
  console.warn(`[svc:resource-sentinel] откат после прошлого запуска: ${saved.undo.map((e) => e.type).join(', ')}`);
  for (const e of [...saved.undo].reverse()) if (e.type !== 'hold') undoEntry(e, true);
  fs.writeFileSync(stateFile(), JSON.stringify({ active: null }));
}

async function tick() {
  const cfg = ctx.config.load();
  const table = procTable();
  if (mode) {
    for (const [k, v] of [['peakLoad', os.loadavg()[0]], ['maxTemp', cpuTemp()]]) {
      if (v !== null && (mode.stats[k] === null || v > mode.stats[k])) mode.stats[k] = v;
    }
  }
  if (mode?.manual) return;

  const game = cfg.gameMode ? await detectGame(table) : null;
  if (mode?.kind === 'game') {
    goneTicks = game ? 0 : goneTicks + 1;
    if (!cfg.gameMode || goneTicks >= GAME_GONE_TICKS) await leave();
    return;
  }
  if (game) {
    if (mode) await leave();
    await enter('game', game);
    return;
  }

  const build = cfg.buildBoost ? detectBuild(table) : null;
  if (mode?.kind === 'build') {
    goneTicks = build ? 0 : goneTicks + 1;
    if (goneTicks >= BUILD_GONE_TICKS) await leave();
    return;
  }
  buildTicks = build ? buildTicks + 1 : 0;
  if (buildTicks >= BUILD_ON_TICKS) {
    buildTicks = 0;
    await enter('build', build);
  }
}

module.exports = {
  name: 'resource-sentinel',
  every: TICK_MS,
  steadyPace: true,
  start(c) {
    ctx = c;
    recover();
    ctx.bus.on('game.force', (ev) => {
      const on = ev.on === true || ev.on === 'true';
      if (on && !mode) enter('game', { name: 'ручной игровой режим' }, true).catch((e) => console.error('[svc:resource-sentinel]', e.message));
      else if (!on && mode) leave().catch((e) => console.error('[svc:resource-sentinel]', e.message));
    });
  },
  tick,
  stop() {
    if (!mode) return;
    for (const e of [...mode.undo].reverse()) undoEntry(e, true);
    mode = null;
    try { fs.writeFileSync(stateFile(), JSON.stringify({ active: null })); } catch {}
  },
};
