#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { redact } = require('./lib/redact.js');

const TERMINAL_LINES = 30;
const CLIPBOARD_CHARS = 800;
const DIFF_CHARS = 2000;
const STATUS_LINES = 40;
const SHELLS = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'nu', 'xonsh']);
const TERMINALS = /^(kitty|foot|footclient|alacritty|wezterm|wezterm-gui|ghostty|konsole|gnome-terminal|xterm|urxvt|st|tilix|terminator|xfce4-terminal)$/i;

const has = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, cmd)));

function run(cmd, args, { cwd, timeout = 4000, env } = {}) {
  return new Promise((resolve) => {
    if (!has(cmd)) return resolve({ ok: false, stdout: '' });
    execFile(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', ...env } },
      (err, stdout) => resolve({ ok: !err, stdout: String(stdout || '') }));
  });
}

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
};

const tail = (text, n) => text.replace(/\s+$/, '').split('\n').slice(-n).join('\n');
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}\n…[обрезано, всего ${text.length} символов]` : text);

function procTable() {
  const table = new Map();
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const stat = read(`/proc/${name}/stat`);
    if (!stat) continue;
    const close = stat.lastIndexOf(')');
    const f = stat.slice(close + 2).split(' ');
    table.set(Number(name), { pid: Number(name), comm: stat.slice(stat.indexOf('(') + 1, close), ppid: Number(f[1]), start: Number(f[19]) });
  }
  return table;
}

function descendants(table, root) {
  const out = [];
  const queue = [root];
  while (queue.length) {
    const pid = queue.shift();
    for (const p of table.values()) {
      if (p.ppid === pid) { out.push(p); queue.push(p.pid); }
    }
  }
  return out;
}

const environOf = (pid) => Object.fromEntries(read(`/proc/${pid}/environ`).split('\0')
  .map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]).filter(([k]) => k));

const cmdlineOf = (pid) => read(`/proc/${pid}/cmdline`).split('\0').filter(Boolean).join(' ');

function cwdOf(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { return null; }
}

function ttyActivity(pid) {
  try { return fs.statSync(fs.readlinkSync(`/proc/${pid}/fd/0`)).mtimeMs; } catch { return 0; }
}

async function activeWindow() {
  const tool = process.env.CAPRI_WINDOW_TOOL || (process.env.HYPRLAND_INSTANCE_SIGNATURE ? 'hyprctl' : process.env.SWAYSOCK ? 'swaymsg' : 'xdotool');
  if (tool === 'hyprctl') {
    let win = JSON.parse((await run('hyprctl', ['activewindow', '-j'])).stdout || '{}');
    if ((!win.class || win.class === 'capri-desktop') && process.env.CAPRI_LAST_WINDOW) {
      const clients = JSON.parse((await run('hyprctl', ['clients', '-j'])).stdout || '[]');
      win = clients.find((c) => c.address === process.env.CAPRI_LAST_WINDOW) || win;
    }
    if (!win.class) return null;
    return { class: win.class, title: win.title, pid: win.pid, workspace: win.workspace?.name, geometry: [...win.at, ...win.size] };
  }
  if (tool === 'swaymsg') {
    const tree = JSON.parse((await run('swaymsg', ['-t', 'get_tree'])).stdout || '{}');
    const stack = [tree];
    while (stack.length) {
      const n = stack.pop();
      if (n.focused && n.pid) {
        return { class: n.app_id || n.window_properties?.class, title: n.name, pid: n.pid, geometry: [n.rect.x, n.rect.y, n.rect.width, n.rect.height] };
      }
      stack.push(...(n.nodes || []), ...(n.floating_nodes || []));
    }
    return null;
  }
  if (tool === 'xdotool' && has('xdotool')) {
    const [cls, title, pid] = await Promise.all(['getwindowclassname', 'getwindowname', 'getwindowpid']
      .map(async (c) => (await run('xdotool', ['getactivewindow', c])).stdout.trim()));
    return cls ? { class: cls, title, pid: Number(pid) || null } : null;
  }
  return null;
}

function findShell(table, winPid) {
  const below = descendants(table, winPid);
  const tmux = below.find((p) => p.comm.startsWith('tmux'));
  const shells = below.filter((p) => SHELLS.has(p.comm) && !SHELLS.has(table.get(p.ppid)?.comm));
  if (!shells.length) return { tmux: Boolean(tmux), shell: null };
  const shell = shells.sort((a, b) => ttyActivity(b.pid) - ttyActivity(a.pid))[0];
  const running = descendants(table, shell.pid).filter((p) => !SHELLS.has(p.comm)).map((p) => cmdlineOf(p.pid)).filter(Boolean);
  return { tmux: Boolean(tmux), shell, env: environOf(shell.pid), cwd: cwdOf(shell.pid), running: running.slice(0, 3) };
}

async function ocrWindow(geometry) {
  if (!geometry || !has('tesseract')) return '';
  const img = path.join(os.tmpdir(), `capri-snap-${process.pid}.png`);
  const [x, y, w, h] = geometry;
  const grabbed = process.env.WAYLAND_DISPLAY
    ? await run('grim', ['-g', `${x},${y} ${w}x${h}`, img])
    : await run('maim', ['-g', `${w}x${h}+${x}+${y}`, img]);
  if (!grabbed.ok) return '';
  const langs = /^rus$/m.test((await run('tesseract', ['--list-langs'])).stdout) ? 'rus+eng' : 'eng';
  const text = (await run('tesseract', [img, '-', '-l', langs], { timeout: 15000 })).stdout;
  fs.rm(img, () => {});
  return text;
}

async function terminalOutput(win, term) {
  if (term.tmux) {
    const out = await run('tmux', ['capture-pane', '-p', '-J', '-S', `-${TERMINAL_LINES * 2}`]);
    const cwd = (await run('tmux', ['display-message', '-p', '#{pane_current_path}'])).stdout.trim();
    if (out.ok) return { source: 'tmux', text: tail(out.stdout, TERMINAL_LINES), cwd: cwd || term.cwd };
  }
  const env = term.env || {};
  if (env.KITTY_LISTEN_ON && env.KITTY_WINDOW_ID) {
    const out = await run('kitty', ['@', '--to', env.KITTY_LISTEN_ON, 'get-text', '--match', `id:${env.KITTY_WINDOW_ID}`, '--extent', 'all']);
    if (out.ok && out.stdout.trim()) return { source: 'kitty', text: tail(out.stdout, TERMINAL_LINES) };
  }
  if (env.WEZTERM_PANE) {
    const out = await run('wezterm', ['cli', 'get-text', '--pane-id', env.WEZTERM_PANE]);
    if (out.ok && out.stdout.trim()) return { source: 'wezterm', text: tail(out.stdout, TERMINAL_LINES) };
  }
  let geo = win.geometry;
  if (geo && !TERMINALS.test(win.class || '')) {
    const h = Math.round(geo[3] * 0.45);
    geo = [geo[0], geo[1] + geo[3] - h, geo[2], h];
  }
  const text = await ocrWindow(geo);
  return text.trim() ? { source: 'ocr', text: tail(text, TERMINAL_LINES) } : null;
}

async function clipboard() {
  if (process.env.WAYLAND_DISPLAY) {
    const types = (await run('wl-paste', ['--list-types'])).stdout;
    if (!/text\/plain|UTF8_STRING|^TEXT$/m.test(types)) return null;
    return (await run('wl-paste', ['--no-newline'])).stdout || null;
  }
  return (await run('xclip', ['-selection', 'clipboard', '-o'])).stdout || null;
}

async function gitState(cwd) {
  if (!cwd) return null;
  const top = (await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'])).stdout.trim();
  if (!top) return null;
  const git = (...args) => run('git', ['-C', top, ...args]).then((r) => r.stdout);
  const gitDir = (await git('rev-parse', '--absolute-git-dir')).trim();
  const [status, last, stat, diff] = await Promise.all([
    git('status', '--porcelain=v1', '-b'),
    git('log', '-1', '--format=%h %s (%cr)'),
    git('diff', 'HEAD', '--stat', '--no-color'),
    git('diff', 'HEAD', '--no-color', '--no-ext-diff'),
  ]);
  const ops = [['MERGE_HEAD', 'merge'], ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase/am'], ['CHERRY_PICK_HEAD', 'cherry-pick'], ['BISECT_LOG', 'bisect']]
    .filter(([f]) => fs.existsSync(path.join(gitDir, f))).map(([, name]) => name);
  const lines = status.trimEnd().split('\n');
  return {
    root: top,
    branch: lines[0]?.replace(/^## /, '') || '?',
    status: lines.slice(1, STATUS_LINES + 1).join('\n'),
    conflicts: lines.filter((l) => /^(UU|AA|DD|AU|UA|DU|UD) /.test(l)).map((l) => l.slice(3)),
    inProgress: ops,
    lastCommit: last.trim(),
    diffStat: tail(stat, 25),
    diff: clip(diff, DIFF_CHARS),
  };
}

async function snapshot(opts = {}) {
  const win = await activeWindow();
  const table = procTable();
  const found = win?.pid ? findShell(table, win.pid) : null;
  const term = found && (found.shell || found.tmux || TERMINALS.test(win.class || '')) ? found : null;
  const output = term ? await terminalOutput(win, term) : null;
  const cwd = output?.cwd || term?.cwd || opts.recentCommands?.[0]?.cwd || null;
  const [clip_, git] = await Promise.all([opts.clipboard === false ? null : clipboard(), gitState(cwd)]);
  return {
    takenAt: new Date().toISOString(),
    window: win && { class: win.class, title: win.title, workspace: win.workspace },
    terminal: term && { shell: term.shell?.comm, cwd, running: term.running, source: output?.source || null, output: output?.text || null },
    clipboard: clip_,
    git,
    recentCommands: opts.recentCommands || [],
  };
}

function toText(s) {
  const out = [`[СНИМОК КОНТЕКСТА ${s.takenAt.slice(0, 19).replace('T', ' ')}]`];
  if (s.window) out.push(`Активное окно: ${s.window.class} — «${s.window.title}»${s.window.workspace ? ` (воркспейс ${s.window.workspace})` : ''}`);
  if (s.terminal) {
    out.push(`Терминал: ${s.terminal.shell || '?'} в ${s.terminal.cwd || '?'}${s.terminal.running?.length ? `; сейчас запущено: ${s.terminal.running.join('; ')}` : ''}`);
    if (s.terminal.output) {
      out.push(`Последние строки терминала (${s.terminal.source === 'ocr' ? 'распознаны с экрана, возможны опечатки OCR' : s.terminal.source}):\n${s.terminal.output}`);
    }
  }
  if (s.recentCommands.length) {
    out.push(`Недавние долгие команды:\n${s.recentCommands.map((c) => `- \`${c.cmd}\` в ${c.cwd} → код ${c.code}`).join('\n')}`);
  }
  if (s.git) {
    const g = s.git;
    out.push([
      `Git: ${g.root}, ветка ${g.branch}; последний коммит: ${g.lastCommit || '—'}`,
      g.inProgress.length ? `НЕЗАВЕРШЁННАЯ ОПЕРАЦИЯ: ${g.inProgress.join(', ')}` : '',
      g.conflicts.length ? `КОНФЛИКТЫ: ${g.conflicts.join(', ')}` : '',
      g.status ? `status:\n${g.status}` : 'status: чисто',
      g.diff ? `diff HEAD:\n${g.diff}` : '',
    ].filter(Boolean).join('\n'));
  }
  if (s.clipboard) out.push(`Буфер обмена:\n${clip(s.clipboard, CLIPBOARD_CHARS)}`);
  return redact(out.join('\n\n'));
}

module.exports = { snapshot, toText, activeWindow, gitState, findShell, procTable, descendants };

if (require.main === module) {
  snapshot().then((s) => {
    process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(s, null, 2)}\n` : `${toText(s)}\n`);
  }).catch((err) => {
    console.error(`context_snapshot: ${err.message}`);
    process.exit(1);
  });
}
