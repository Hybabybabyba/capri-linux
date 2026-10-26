'use strict';

const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { redact: scrub } = require('../tools/lib/redact');

const ALWAYS_MS = 120000;
const TAIL_CHARS = 3000;
const DIAG_TAIL_CHARS = 1200;
const INTERACTIVE = /^(n?vim?|vi|nano|micro|hx|helix|emacs|less|more|man|bat|ssh|mosh|tmux|zellij|screen|htop|btop|top|nvtop|watch|journalctl|tail|ranger|lf|yazi|nnn|mc|fzf|lazygit|tig|python3?|node|ipython|iex|irb|ghci|psql|mysql|sqlite3|cat|git\s+(log|diff|show))\b/;
const QUIET_CODES = new Set([130, 143, 146, 148]);

const DIAG_PROMPT = 'Команда упала. По хвосту вывода одной фразой по-русски: причина и что сделать. Без кода; причины не видно — так и скажи.';

const LOCAL_CAUSES = [
  [/command not found|: not found$/m, 127, 'команды нет — опечатка или пакет не установлен (pacman -F <имя> подскажет пакет).'],
  [/Permission denied \(publickey\)|authentication failed|401 Unauthorized|403 Forbidden/i, null, 'отказ в доступе — проверь SSH-ключ или токен.'],
  [/Permission denied|EACCES|Operation not permitted/, 126, 'нет прав — проверь владельца и chmod, или нужен sudo.'],
  [/No space left on device|ENOSPC/, null, 'кончилось место — df -h, почисти ~/.cache и paccache -r.'],
  [/unable to lock database|db\.lck/, null, 'база pacman заблокирована — другой pacman ещё идёт, иначе удали /var/lib/pacman/db.lck.'],
  [/exists in filesystem/, null, 'конфликт файлов pacman — чей файл, покажет pacman -Qo <файл>.'],
  [/Could not resolve host|Temporary failure in name resolution|Network is unreachable|ENOTFOUND|ECONNREFUSED|Connection refused|timed out/i, null, 'сеть — хост недоступен или не резолвится.'],
  [/Address already in use|EADDRINUSE/, null, 'порт занят — ss -ltnp покажет, кем; останови старый процесс.'],
  [/ModuleNotFoundError|No module named|Cannot find module|cannot find package/, null, 'нет зависимости — поставь модуль (pip/npm install) или проверь окружение.'],
  [/out of memory|Cannot allocate memory|ENOMEM|^Killed$/m, 137, 'не хватило памяти, процесс убит — меньше -j или больше swap.'],
  [/Segmentation fault|SIGSEGV/, 139, 'segfault — подробности в coredumpctl info.'],
  [/Aborted|SIGABRT/, 134, 'аварийный abort — подробности в coredumpctl info.'],
  [/CONFLICT \(|would be overwritten by (merge|checkout)/, null, 'git — конфликт или незакоммиченные изменения мешают.'],
];

function localDiagnosis(code, tail) {
  const hit = LOCAL_CAUSES.find(([re, c]) => (tail && re.test(tail)) || (!tail && c === code));
  return hit ? hit[2] : '';
}

function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} мин ${s % 60} с` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

const shortCmd = (cmd) => (cmd.length > 60 ? `${cmd.slice(0, 59)}…` : cmd);

function parentPid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  } catch {
    return 0;
  }
}

async function shellFocused(ctx, pid) {
  let active;
  try {
    active = JSON.parse(await ctx.hyprQuery('j/activewindow'));
  } catch {
    return false;
  }
  if (!active?.pid) return false;
  for (let p = pid, hops = 0; p > 1 && hops < 32; p = parentPid(p), hops++) {
    if (p === active.pid) return true;
  }
  return false;
}

function kittyTail(ev) {
  return new Promise((resolve) => {
    const listen = String(ev.kitty_listen || '');
    const win = String(ev.kitty_window || '');
    if (!listen.startsWith('unix:') || !/^\d+$/.test(win)) return resolve('');
    execFile('kitty', ['@', '--to', listen, 'get-text', '--match', `id:${win}`, '--extent', 'last_cmd_output'],
      { timeout: 2000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : stdout.trimEnd().slice(-TAIL_CHARS)));
  });
}

async function diagnose(ctx, ev, tail) {
  if (!tail || !ctx.config.load().diagnose || !ctx.groq.hasKey()) return '';
  const content = scrub(`$ ${ev.cmd}\nкод ${ev.code}\n${tail.slice(-DIAG_TAIL_CHARS)}`);
  try {
    const reply = await ctx.groq.ask([{ role: 'user', content }], { system: DIAG_PROMPT, maxTokens: 150, background: true });
    return String(reply || '').trim();
  } catch (err) {
    console.error('[svc:watchdog] diagnose:', err.message);
    return '';
  }
}

async function onCommandDone(ctx, ev) {
  if (!ctx.config.load().watchdog) return;
  const cmd = String(ev.cmd || '').trim();
  const code = Number(ev.code);
  const ms = Number(ev.ms);
  if (!cmd || !Number.isFinite(code) || !Number.isFinite(ms)) return;
  if (INTERACTIVE.test(cmd.replace(/^(sudo|doas|time|env\s+\S+=\S+)\s+/, '')) || QUIET_CODES.has(code)) return;

  if (ms < ALWAYS_MS && await shellFocused(ctx, Number(ev.pid))) return;

  const key = `cmd:${ev.pid}:${cmd}`;
  if (code === 0) {
    ctx.notice({
      kind: 'done',
      key,
      title: 'Команда завершилась',
      line: `${shortCmd(cmd)} — готово за ${duration(ms)}.`,
      context: `Команда \`${cmd}\` в ${ev.cwd || '?'} успешно завершилась за ${duration(ms)}.`,
    });
    return;
  }

  const tail = await kittyTail(ev);
  const diagnosis = localDiagnosis(code, tail) || await diagnose(ctx, ev, tail);
  const lastLine = tail.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
  ctx.notice({
    kind: 'error',
    key,
    title: 'Команда упала',
    line: `${shortCmd(cmd)} упала с кодом ${code} через ${duration(ms)}.`,
    quote: lastLine,
    reply: diagnosis,
    context: [
      `Команда \`${cmd}\` в ${ev.cwd || '?'} упала с кодом ${code} через ${duration(ms)}.`,
      tail ? `Хвост вывода:\n${scrub(tail)}` : '',
      diagnosis ? `Мой разбор: ${diagnosis}` : '',
    ].filter(Boolean).join('\n'),
  });
}

module.exports = {
  name: 'watchdog',
  start(ctx) {
    ctx.bus.on('cmd.done', (ev) => onCommandDone(ctx, ev).catch((e) => console.error('[svc:watchdog]', e.message)));
  },
};
