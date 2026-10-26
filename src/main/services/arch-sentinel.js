'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const EVERY_MS = 3 * 60 * 60 * 1000;
const NEWS_URL = 'https://archlinux.org/feeds/news/';
const PACMAN_LOG = '/var/log/pacman.log';
const MODULES_DIR = '/usr/lib/modules';
const AFTER_PACMAN_MS = 30000;
const NEWS_FALLBACK_DAYS = 30;
const NOTICE_COOLDOWN_MS = 60 * 60 * 1000;

let ctx = null;
let state = { news: [], pacnew: [], kernel: '' };
let logWatcher = null;
let afterPacman = null;

const stateFile = () => path.join(ctx.dataDir, 'arch-sentinel.json');

function loadState() {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) };
  } catch {}
}

function saveState() {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[svc:arch-sentinel] state:', err.message);
  }
}

function run(cmd, args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout, stderr) => resolve({
        code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      }));
  });
}

const which = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, cmd)));

function parseUpdates(text) {
  return text.split('\n').map((l) => l.trim().match(/^(\S+)\s+(\S+)\s+->\s+(\S+)/))
    .filter(Boolean).map(([, name, from, to]) => ({ name, from, to }));
}

async function pendingUpdates() {
  const official = await run('checkupdates', ['--nocolor']);
  if (official.code !== 0 && official.code !== 2) {
    throw new Error(`checkupdates: ${official.stderr.trim() || `код ${official.code}`}`);
  }
  const pending = parseUpdates(official.stdout);
  for (const helper of ['paru', 'yay']) {
    if (!which(helper)) continue;
    const aur = await run(helper, ['-Qua']);
    pending.push(...parseUpdates(aur.stdout).map((u) => ({ ...u, aur: true })));
    break;
  }
  return pending;
}

function lastUpgrade() {
  let text;
  try { text = fs.readFileSync(PACMAN_LOG, 'utf8'); } catch { return null; }
  const at = text.lastIndexOf('] [PACMAN] starting full system upgrade');
  if (at < 0) return null;
  const stamp = text.slice(text.lastIndexOf('[', at) + 1, at);
  const date = new Date(stamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(date.getTime()) ? null : date;
}

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');

function parseNews(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const tag = (name) => decode((item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '');
    return {
      title: tag('title').trim(),
      link: tag('link').trim(),
      date: new Date(tag('pubDate')),
      text: tag('description').replace(/<[^>]+>/g, ' '),
    };
  });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mentioned(news, pending) {
  const text = `${news.title}\n${news.text}`.replace(/arch\s+linux/gi, ' ');
  return pending.filter(({ name }) => name.length >= 3
    && new RegExp(`(^|[^\\w.+-])${escapeRe(name)}($|[^\\w+-])`, 'i').test(text));
}

async function checkNews(pending) {
  if (!pending.length) return;
  const res = await fetch(NEWS_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`новости Arch: HTTP ${res.status}`);
  const since = lastUpgrade() || new Date(Date.now() - NEWS_FALLBACK_DAYS * 86400000);
  const hits = parseNews(await res.text())
    .filter((n) => n.date > since && !state.news.includes(n.link))
    .map((n) => ({ ...n, packages: mentioned(n, pending) }))
    .filter((n) => n.packages.length);
  if (!hits.length) return;

  state.news = [...hits.map((n) => n.link), ...state.news].slice(0, 50);
  saveState();
  const names = [...new Set(hits.flatMap((n) => n.packages.map((p) => p.name)))];
  ctx.notice({
    kind: 'alert',
    key: 'arch:news',
    cooldownMs: NOTICE_COOLDOWN_MS,
    title: 'Новости Arch перед обновлением',
    line: `Стой с -Syu: в новостях Arch есть про ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}.`,
    reply: hits.map((n) => `• ${n.title}\n  ${n.link}`).join('\n'),
    context: [
      `Ждут обновления (${pending.length}): ${pending.map((p) => `${p.name} ${p.from} -> ${p.to}${p.aur ? ' [AUR]' : ''}`).join(', ')}.`,
      'Новости archlinux.org после последнего -Syu, где упомянуты эти пакеты:',
      ...hits.map((n) => `- ${n.title} (${n.link}): ${n.text.replace(/\s+/g, ' ').trim().slice(0, 600)}`),
    ].join('\n'),
  });
}

async function checkPacnew() {
  const res = await run('pacdiff', ['-o'], 60000);
  if (res.code !== 0) return;
  const files = res.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/'));
  const fresh = files.filter((f) => !state.pacnew.includes(f));
  state.pacnew = files;
  saveState();
  if (!fresh.length) return;
  ctx.notice({
    kind: 'alert',
    key: 'arch:pacnew',
    title: 'Новые .pacnew',
    line: `После обновления остались ${fresh.length === 1 ? 'новый конфиг' : `новые конфиги (${fresh.length})`}: ${path.basename(fresh[0])}${fresh.length > 1 ? '…' : ''}. Слей их: sudo DIFFPROG='nvim -d' pacdiff`,
    reply: fresh.join('\n'),
    context: `pacdiff -o нашёл новые файлы после обновления:\n${fresh.join('\n')}`,
  });
}

function checkKernel() {
  const running = os.release();
  if (fs.existsSync(path.join(MODULES_DIR, running, 'vmlinuz'))) {
    if (state.kernel) { state.kernel = ''; saveState(); }
    return;
  }
  let installed = [];
  try {
    installed = fs.readdirSync(MODULES_DIR).filter((d) => fs.existsSync(path.join(MODULES_DIR, d, 'vmlinuz')));
  } catch { return; }
  if (!installed.length) return;
  const sig = installed.sort().join(' ');
  if (state.kernel === sig) return;
  state.kernel = sig;
  saveState();
  ctx.notice({
    kind: 'info',
    key: 'arch:kernel',
    title: 'Обновилось ядро',
    line: `Ядро обновлено (${installed.join(', ')}), а работает ещё ${running}. Перезагрузись, когда будет удобно.`,
    context: `Запущено ядро ${running}, его модулей больше нет в ${MODULES_DIR}; установлено: ${installed.join(', ')}. Пока не перезагрузиться, новые модули (USB, ФС, сеть) могут не подгружаться.`,
  });
}

async function localChecks() {
  checkKernel();
  await checkPacnew();
}

async function tick() {
  if (!ctx.config.load().archSentinel) return;
  await localChecks();
  await checkNews(await pendingUpdates());
}

function watchPacmanLog() {
  try {
    logWatcher = fs.watch(PACMAN_LOG, () => {
      clearTimeout(afterPacman);
      afterPacman = setTimeout(() => {
        if (ctx.config.load().archSentinel) localChecks().catch((e) => console.error('[svc:arch-sentinel]', e.message));
      }, AFTER_PACMAN_MS);
    });
    logWatcher.on('error', () => {});
  } catch (err) {
    console.error('[svc:arch-sentinel] pacman.log:', err.message);
  }
}

module.exports = {
  name: 'arch-sentinel',
  every: EVERY_MS,
  start(c) {
    ctx = c;
    loadState();
    watchPacmanLog();
  },
  tick,
  stop() {
    clearTimeout(afterPacman);
    logWatcher?.close();
  },
};
