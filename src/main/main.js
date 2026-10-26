'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const nodeNet = require('node:net');
const { spawn } = require('node:child_process');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, protocol, net, shell, globalShortcut, nativeImage, dialog,
  Notification, clipboard,
} = require('electron');

const config = require('./config');
const singleton = require('./singleton');
const groq = require('./groq-client');
const { createServices, gpuSwitches } = require('./services');
const contextSnapshot = require('./tools/context_snapshot.js');
const intentRouter = require('./tools/intent_router.js');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV = process.argv.includes('--dev');
const SOUND_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const EXEC_TIMEOUT_MS = 30000;
const EXEC_MAX_OUTPUT = 3000;
const POINTER_POLL_MS = 16;
const POINTER_POLL_SAVER_MS = 50;
const ZONE_MARGIN = 28;
const OVERLAY_TITLE = 'capri-overlay';

const DANGEROUS = [
  /\b(sudo|doas|pkexec|su)\b/,
  /\brm\s/, /\b(shred|wipefs|mkfs(\.\w+)?|fdisk|sfdisk|parted|dd)\b/,
  /\b(chmod|chown|chgrp)\s+(-\w*\s+)*-\w*R/,
  /\b(pacman|yay|paru)\s+-\w*[SRU]/,
  /\bsystemctl\s+(stop|disable|mask|kill|poweroff|reboot|halt|suspend|hibernate)\b/,
  /\b(shutdown|reboot|poweroff|halt)\b/,
  /\b(kill|pkill|killall)\b/,
  /\bhyprctl\s+dispatch\s+exit\b/,
  /\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/,
  /\bgit\s+(push\s+.*--force|reset\s+--hard|clean\s+-\w*f)/,
  />\s*\/(etc|usr|boot|dev|sys|proc)\//,
  /:\(\)\s*\{/,
  /\bcrontab\s+-r\b/,
  /\bgit\b[^\n|;&]*\s(apply|am)\b(?![^\n]*--check)/,
  /\bpatch\s+(-\S+\s+)*-p\d/,
];

process.on('uncaughtException', (e) => console.error('[capri] uncaught:', e));
process.on('unhandledRejection', (e) => console.error('[capri] unhandled:', e));

app.setName('capri-desktop');

const LEGACY_USER_DATA = app.getPath('userData');
app.setPath('userData', path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'capri-desktop'));

if (!app.requestSingleInstanceLock()) app.exit(0);

(function migrateUserData() {
  const legacy = LEGACY_USER_DATA;
  const dir = app.getPath('userData');
  if (path.resolve(legacy) === path.resolve(dir)) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['config.json', 'sounds']) {
      const from = path.join(legacy, name);
      const to = path.join(dir, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.cpSync(from, to, { recursive: true });
    }
  } catch (e) {
    console.error('[capri] userData migration:', e.message);
  }
}());

(function applyGpuSwitches() {
  const { disable, switches } = gpuSwitches();
  if (disable) app.disableHardwareAcceleration();
  switches.forEach((s) => app.commandLine.appendSwitch(s));
}());

protocol.registerSchemesAsPrivileged([
  { scheme: 'capri', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let overlay = null;
let tray = null;
let trayMenu = null;
let overlayInteractive = false;
let services = null;
let envProfile = null;
let pointerPollMs = POINTER_POLL_MS;

const userSoundsDir = () => path.join(app.getPath('userData'), 'sounds');

function serveProtocol() {
  protocol.handle('capri', (request) => {
    const url = new URL(request.url);
    const base = url.host === 'usersounds' ? userSoundsDir() : ROOT;
    const target = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function targetDisplay() {
  const { displayId } = config.load();
  return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

function fitOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  const { bounds } = targetDisplay();
  if (overlay.webContents && !overlay.webContents.isDestroyed()) {
    overlay.webContents.send('overlay:resize', { width: bounds.width, height: bounds.height });
  }
}

function createOverlay() {
  const { bounds } = targetDisplay();

  overlay = new BrowserWindow({
    title: OVERLAY_TITLE,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadURL(process.env.CAPRI_BLANK
    ? 'data:text/html,<body style="margin:0;background:transparent"></body>'
    : 'capri://app/src/renderer/index.html');
  overlay.once('ready-to-show', () => {
    overlay.show();
    fitOverlay();
    const clickThrough = () => {
      if (overlay && !overlay.isDestroyed() && !overlayInteractive) {
        overlay.setIgnoreMouseEvents(true, { forward: true });
      }
    };
    clickThrough();
    pushPower();
    setTimeout(clickThrough, 300);
    setTimeout(clickThrough, 1500);
  });

  overlay.on('page-title-updated', (e) => e.preventDefault());
  overlay.on('closed', () => { overlay = null; hypr.address = null; });

  overlay.webContents.on('render-process-gone', (_e, details) => {
    console.error('[capri] renderer gone:', details.reason);
  });

  if (DEV) {
    overlay.webContents.on('console-message', (e) => {
      const { level, message, lineNumber, sourceId } = e;
      console.log(`[renderer:${level}] ${message} (${String(sourceId).split('/').pop()}:${lineNumber})`);
    });
    if (process.env.CAPRI_DEVTOOLS) overlay.webContents.openDevTools({ mode: 'detach' });
  }
}

function send(channel, payload) {
  if (!overlay || overlay.isDestroyed()) return;
  if (overlay.webContents && !overlay.webContents.isDestroyed()) {
    overlay.webContents.send(channel, payload);
  }
}

function sendCommand(name, payload = {}) {
  send('capri:command', { name, ...payload });
}

function toggleVisible(force) {
  const visible = typeof force === 'boolean' ? force : !config.load().visible;
  config.save({ visible });
  sendCommand('stow', { on: !visible });
  rebuildTray();
}

function updateConfig(patch) {
  config.save(patch);
  const cfg = config.load();
  send('capri:config', cfg);
  rebuildTray();
  return cfg;
}

const T = {
  online: `Капри — на связи`,
  teleport: 'Телепортация', satellite: 'Посмотреть на спутник', demo: 'Показать демо',
  show: 'Вернуть её', hide: 'Убрать её',
  size: 'Размер', small: 'Маленький', medium: 'Средний', large: 'Большой', xlarge: 'Огромный', huge: 'Гигантский',
  sound: 'Звук', mute: 'Без звука', soundsDir: 'Открыть папку своих звуков',
  screen: 'Экран', wander: 'Бродить, когда без дела', possess: 'Захватывать мои окна',
  startup: 'Запускать при входе в систему',
  autonomy: 'Фоновые функции', watchdog: 'Следить за долгими командами', diagnose: 'Разбирать падения через Groq',
  archSentinel: 'Следить за обновлениями Arch',
  zshHook: 'Скопировать строку для ~/.zshrc',
  groqOk: 'Groq API: ключ найден', groqMissing: 'Groq API: GROQ_API_KEY не задан',
  snapshot: 'Разобрать, что свалилось (Super+Shift+X)', route: 'Разобрать выделенное (Super+Shift+R)',
  gameMode: 'Эко-режим игрока', gameFreeze: '— замораживать браузеры в игре', gameRefresh: '— максимальная частота экрана в игре',
  buildBoost: 'Буст тяжёлых сборок',
  quit: 'Выход',
};

function loginItemOptions() {
  return app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
}

function rebuildTray() {
  const cfg = config.load();
  const displays = screen.getAllDisplays();
  const current = targetDisplay().id;
  const hasKey = groq.hasKey();

  const menu = Menu.buildFromTemplate([
    { label: T.online, enabled: false },
    { label: hasKey ? T.groqOk : T.groqMissing, enabled: false },
    { type: 'separator' },
    { label: T.teleport, click: () => sendCommand('teleport') },
    { label: T.satellite, click: () => sendCommand('satellite') },
    { label: T.demo, click: () => sendCommand('showcase') },
    { label: T.snapshot, click: () => analyzeSnapshot() },
    { label: T.route, click: () => routeSelection() },
    { label: cfg.visible ? T.hide : T.show, accelerator: 'Ctrl+Alt+C', click: () => toggleVisible() },
    { type: 'separator' },
    {
      label: T.size,
      submenu: [[T.small, 0.45], [T.medium, 0.6], [T.large, 0.8], [T.xlarge, 1.2], [T.huge, 1.5]].map(([label, scale]) => ({
        label, type: 'radio', checked: Math.abs(cfg.scale - scale) < 0.01, click: () => updateConfig({ scale }),
      })),
    },
    {
      label: T.sound,
      submenu: [
        { label: T.mute, type: 'checkbox', checked: cfg.muted, click: (item) => updateConfig({ muted: item.checked }) },
        { type: 'separator' },
        {
          label: T.soundsDir,
          click: () => {
            fs.mkdirSync(userSoundsDir(), { recursive: true });
            shell.openPath(userSoundsDir());
          },
        },
      ],
    },
    {
      label: T.screen,
      enabled: displays.length > 1,
      submenu: displays.map((d, i) => ({
        label: `${i + 1} — ${d.size.width}×${d.size.height}`,
        type: 'radio',
        checked: d.id === current,
        click: () => { config.save({ displayId: d.id }); fitOverlay(); rebuildTray(); },
      })),
    },
    { label: T.wander, type: 'checkbox', checked: cfg.wander, click: (item) => updateConfig({ wander: item.checked }) },
    { label: T.possess, type: 'checkbox', checked: cfg.possess, click: (item) => updateConfig({ possess: item.checked }) },
    {
      label: T.autonomy,
      submenu: [
        { label: T.watchdog, type: 'checkbox', checked: cfg.watchdog, click: (item) => updateConfig({ watchdog: item.checked }) },
        { label: T.diagnose, type: 'checkbox', checked: cfg.diagnose, click: (item) => updateConfig({ diagnose: item.checked }) },
        { label: T.archSentinel, type: 'checkbox', checked: cfg.archSentinel, click: (item) => updateConfig({ archSentinel: item.checked }) },
        { type: 'separator' },
        { label: T.gameMode, type: 'checkbox', checked: cfg.gameMode, click: (item) => updateConfig({ gameMode: item.checked }) },
        { label: T.gameFreeze, type: 'checkbox', checked: cfg.gameFreeze, enabled: cfg.gameMode, click: (item) => updateConfig({ gameFreeze: item.checked }) },
        { label: T.gameRefresh, type: 'checkbox', checked: cfg.gameRefresh, enabled: cfg.gameMode, click: (item) => updateConfig({ gameRefresh: item.checked }) },
        { label: T.buildBoost, type: 'checkbox', checked: cfg.buildBoost, click: (item) => updateConfig({ buildBoost: item.checked }) },
        { type: 'separator' },
        { label: T.zshHook, click: () => clipboard.writeText(`source "${zshHookPath()}"`) },
      ],
    },
    {
      label: T.startup,
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => app.setLoginItemSettings({ ...loginItemOptions(), openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: T.quit, click: () => app.quit() },
  ]);
  trayMenu = menu;
  tray?.setContextMenu(menu);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icons', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Capri');

  tray.on('click', () => {
    if (!overlay || overlay.isDestroyed()) {
      createOverlay();
      return;
    }
    toggleVisible();
    sendCommand('status');
  });

  rebuildTray();
}

const ZSH_HOOK = path.join(__dirname, 'hooks', 'capri.zsh').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function zshHookPath() {
  if (!app.isPackaged) return ZSH_HOOK;
  const copy = path.join(app.getPath('userData'), 'capri.zsh');
  try { fs.copyFileSync(ZSH_HOOK, copy); } catch (e) { console.error('[capri] zsh hook:', e.message); }
  return copy;
}

function deliverNotice(n, { quiet = false } = {}) {
  const onScreen = config.load().visible && overlay && !overlay.isDestroyed();
  if (onScreen && !quiet) {
    send('capri:notice', n);
    return;
  }
  if (Notification.isSupported()) {
    new Notification({
      title: `Капри: ${n.title || 'событие'}`,
      body: [n.line, n.reply].filter(Boolean).join('\n'),
      urgency: n.kind === 'error' ? 'critical' : 'normal',
    }).show();
  }
  send('capri:notice', { ...n, silent: true });
}

function applyEnvironment(profile) {
  envProfile = profile;
  groq.setEnvironment(profile);
  pointerPollMs = profile.power.saver ? POINTER_POLL_SAVER_MS : POINTER_POLL_MS;
  pushPower();
}

function pushPower() {
  if (envProfile) send('capri:power', { saver: envProfile.power.saver });
}

function shellEnv() {
  const base = { CAPRI_NODE: process.execPath, CAPRI_DATA: app.getPath('userData'), CAPRI_LAST_WINDOW: hypr.lastForeign || '' };
  if (!envProfile) return base;
  const { session, audio } = envProfile;
  return { ...base, CAPRI_WM: session.wm, CAPRI_DISPLAY: session.display, CAPRI_WINDOW_TOOL: session.windowTool, CAPRI_VOLUME_TOOL: audio.volumeTool };
}

const SNAPSHOT_KEEP = 20;
const recentCommands = [];
const SNAPSHOT_TASK = 'Разберись, что тут сломалось. Сначала причина одной фразой, потом почини: команда в exec или патч к репозиторию — git -C <корень> apply --check, затем тот же git apply (пользователь увидит дифф и подтвердит). Не хватает данных — дочитай файлы (sed -n, grep -n). Если ничего не сломано — так и скажи.';
const INTENT_NAMES = { github: 'GitHub', gitlab: 'GitLab', media: 'Медиа', url: 'Страница', file: 'Файл' };

function saveSnapshot(snap) {
  const dir = path.join(app.getPath('userData'), 'snapshots');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${snap.takenAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(snap, null, 2));
    fs.readdirSync(dir).sort().slice(0, -SNAPSHOT_KEEP).forEach((f) => fs.rmSync(path.join(dir, f)));
  } catch (e) {
    console.error('[capri] snapshot save:', e.message);
  }
}

async function analyzeSnapshot() {
  sendCommand('progress', { line: 'Снимаю контекст: окно, терминал, git, буфер…' });
  try {
    const snap = await contextSnapshot.snapshot({ recentCommands: recentCommands.slice(-5).reverse() });
    saveSnapshot(snap);
    const where = snap.terminal?.cwd?.replace(app.getPath('home'), '~') || snap.window?.class || 'экран';
    sendCommand('task', { label: `снимок: ${where}`, prompt: `${contextSnapshot.toText(snap)}\n\n${SNAPSHOT_TASK}` });
  } catch (err) {
    deliverNotice({ kind: 'error', title: 'Снимок', line: `Не вышло снять контекст: ${err.message}` });
  }
}

async function routeSelection() {
  const sel = await intentRouter.selection();
  if (!sel.text.trim()) {
    deliverNotice({ kind: 'info', title: 'Разбор', line: 'Выдели текст, ссылку или путь — и жми снова.' });
    return;
  }
  sendCommand('progress', { line: `Разбираю ${sel.from}…` });
  try {
    const r = await intentRouter.route(sel.text, sel.from);
    if (r.mode === 'agent') {
      sendCommand('task', { label: r.label, prompt: r.prompt });
      return;
    }
    const reply = String(await groq.ask([{ role: 'user', content: r.prompt }], { system: r.system, maxTokens: 450 }) || '').trim();
    deliverNotice({
      kind: 'info',
      title: INTENT_NAMES[r.intent] || 'Разбор',
      line: `${INTENT_NAMES[r.intent] || 'Разбор'}: ${r.label}`,
      reply,
      context: `${r.prompt.slice(0, 4000)}\n\nМоя выжимка: ${reply}`,
    });
  } catch (err) {
    deliverNotice({ kind: 'error', title: 'Разбор', line: `Не разобрала: ${err.message}` });
  }
}

const TOOLS_DIR = path.join(__dirname, 'tools').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const EXEC_LOG_MAX = 1024 * 1024;
const execLogFile = () => path.join(app.getPath('userData'), 'exec.log');

function logExec(command, res) {
  const file = execLogFile();
  const entry = [
    `=== ${new Date().toISOString()}  code=${res.code ?? '-'}  ${res.ms} мс${res.error && !res.ok ? `  (${res.error})` : ''}`,
    command,
    res.stdout ? `--- stdout\n${res.stdout.trimEnd()}` : '',
    res.stderr ? `--- stderr\n${res.stderr.trimEnd()}` : '',
  ].filter(Boolean).join('\n') + '\n\n';
  fs.stat(file, (err, st) => {
    if (!err && st.size > EXEC_LOG_MAX) fs.renameSync(file, `${file}.1`);
    fs.appendFile(file, entry, () => {});
  });
}

const SHELL_HELPERS = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'shell-helpers.sh'), 'utf8');
  } catch (e) {
    console.error('[capri] shell-helpers.sh:', e.message);
    return '';
  }
})();

function clipOutput(text) {
  return text.length > EXEC_MAX_OUTPUT ? text.slice(0, EXEC_MAX_OUTPUT) + `\n…[обрезано, всего ${text.length} символов]` : text;
}

function runShellCommand(command) {
  return new Promise((resolve) => {
    if (typeof command !== 'string' || !command.trim()) {
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: 'empty command' });
      return;
    }
    const t0 = Date.now();
    const child = spawn('/bin/bash', ['-c', `${SHELL_HELPERS}\n${command}`], {
      cwd: app.getPath('home'),
      env: { ...process.env, ...shellEnv(), PATH: `${TOOLS_DIR}${path.delimiter}${process.env.PATH || ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (!done && stdout.length < EXEC_MAX_OUTPUT * 2) stdout += d; });
    child.stderr.on('data', (d) => { if (!done && stderr.length < EXEC_MAX_OUTPUT * 2) stderr += d; });

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      const res = { ...result, stdout: clipOutput(stdout), stderr: clipOutput(stderr), ms: Date.now() - t0 };
      logExec(command, res);
      resolve(res);
    };
    const killer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      finish({ ok: false, code: null, error: `timeout ${EXEC_TIMEOUT_MS / 1000} s` });
    }, EXEC_TIMEOUT_MS);

    child.on('error', (err) => finish({ ok: false, code: null, error: err.message }));
    child.on('exit', (code, signal) => {
      const settle = () => finish(code === 0
        ? { ok: true, code: 0 }
        : { ok: false, code, error: signal ? `killed by ${signal}` : `exit ${code}` });
      child.once('close', settle);
      setTimeout(settle, 80);
    });
  });
}

function isDangerous(command) {
  return DANGEROUS.some((re) => re.test(command));
}

async function confirmAndRun(command) {
  const text = typeof command === 'string' ? command : '';
  if (isDangerous(text)) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Выполнить', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
      title: 'Capri: подтверждение',
      message: 'Капри хочет выполнить потенциально опасную команду:',
      detail: text.slice(0, 4000),
    });
    if (response !== 0) {
      return { ok: false, code: null, stdout: '', stderr: '', error: 'cancelled by user' };
    }
  }
  return runShellCommand(text);
}

const AGENT_MAX_STEPS = 5;
const EXEC_RE = /```exec\s*\n?([\s\S]*?)```/g;

function execReport(command, res) {
  const status = res.ok ? '' : `\nКОД: ${res.code ?? 'нет'} (${res.error || 'ошибка'})`;
  return `Результат выполнения команды \`${command}\`:${status}\nSTDOUT: ${res.stdout?.trim() || '(пусто)'}\nSTDERR: ${res.stderr?.trim() || '(пусто)'}`;
}

async function runAgent(sender, messages) {
  const step = (payload) => { if (!sender.isDestroyed()) sender.send('agent:step', payload); };
  const history = Array.isArray(messages) ? [...messages] : [];
  const added = [];

  const push = (msg) => { history.push(msg); added.push(msg); };

  try {
    for (let i = 1; i <= AGENT_MAX_STEPS; i++) {
      const reply = String(await groq.ask(history, { onWait: (seconds) => step({ type: 'wait', seconds }) }) || '');
      push({ role: 'assistant', content: reply });

      const commands = [...reply.matchAll(EXEC_RE)].map((m) => m[1].trim()).filter(Boolean);
      const spoken = reply.replace(EXEC_RE, '').trim();
      if (!commands.length) return { ok: true, reply: spoken, messages: added };

      if (i === AGENT_MAX_STEPS) {
        const note = `(остановилась после ${AGENT_MAX_STEPS} шагов, задача могла не завершиться)`;
        return { ok: true, reply: [spoken, note].filter(Boolean).join('\n'), messages: added, truncated: true };
      }

      if (spoken) step({ type: 'say', text: spoken });
      const reports = [];
      for (const command of commands) {
        step({ type: 'exec', command });
        const res = await confirmAndRun(command);
        step({ type: 'result', command, res });
        reports.push(execReport(command, res));
      }
      push({
        role: 'user',
        content: `[РЕЗУЛЬТАТ EXEC — вывод системы, а не сообщение пользователя. Шаг ${i}/${AGENT_MAX_STEPS}. Если задача не решена — следующий exec, иначе короткий итог без exec.]\n${reports.join('\n\n')}`,
      });
    }
  } catch (err) {
    return { ok: false, error: err.message, messages: added };
  }
  return { ok: false, error: 'agent loop exhausted', messages: added };
}

function hyprSocket(name) {
  const { XDG_RUNTIME_DIR, HYPRLAND_INSTANCE_SIGNATURE } = process.env;
  if (!XDG_RUNTIME_DIR || !HYPRLAND_INSTANCE_SIGNATURE) return null;
  return `${XDG_RUNTIME_DIR}/hypr/${HYPRLAND_INSTANCE_SIGNATURE}/${name}`;
}

function hyprQuery(cmd) {
  return new Promise((resolve, reject) => {
    const file = hyprSocket('.socket.sock');
    if (!file) return reject(new Error('no hypr socket'));
    const sock = nodeNet.createConnection(file);
    let out = '';
    sock.setTimeout(400, () => { sock.destroy(); reject(new Error('timeout')); });
    sock.on('connect', () => sock.write(cmd));
    sock.on('data', (d) => { out += d; });
    sock.on('close', () => resolve(out));
    sock.on('error', reject);
  });
}

const hexAddress = (a) => (a && !a.startsWith('0x') ? `0x${a}` : a);

const hypr = {
  address: null,
  lastForeign: null,
  passive: true,
  zones: [],
  hold: false,
  hud: false,
  cursor: null,
  chain: Promise.resolve(),
};

function hyprSerial(fn) {
  hypr.chain = hypr.chain.then(fn).catch((e) => console.error('[capri] hyprctl:', e.message));
  return hypr.chain;
}

async function hyprWindow() {
  if (hypr.address) return hypr.address;
  const clients = JSON.parse(await hyprQuery('j/clients'));
  const own = clients.find((c) => c.pid === process.pid && c.title === OVERLAY_TITLE);
  hypr.address = own ? own.address : null;
  return hypr.address;
}

async function applyPassive(passive) {
  if (passive === hypr.passive) return;
  const addr = await hyprWindow();
  if (!addr) return;
  await hyprQuery(`dispatch setprop address:${addr} no_focus ${passive ? 1 : 0}`);
  hypr.passive = passive;
  if (!passive && hypr.cursor) {
    const now = JSON.parse(await hyprQuery('j/cursorpos'));
    if (now.x === hypr.cursor.gx && now.y === hypr.cursor.gy) {
      await hyprQuery(`dispatch movecursor ${now.x} ${now.y}`);
    }
  }
}

function wantPassive() {
  if (hypr.hold || hypr.hud) return false;
  const c = hypr.cursor;
  if (!c || !c.inside) return true;
  return !hypr.zones.some((z) => c.x >= z.x - ZONE_MARGIN && c.x <= z.x + z.w + ZONE_MARGIN
    && c.y >= z.y - ZONE_MARGIN && c.y <= z.y + z.h + ZONE_MARGIN);
}

function syncPassive() {
  const passive = wantPassive();
  if (passive !== hypr.passive) hyprSerial(() => applyPassive(passive));
}

let pointerTimer = null;
async function pointerLoop() {
  if (!hyprSocket('.socket.sock')) return;
  try {
    if (overlay && !overlay.isDestroyed()) {
      const p = JSON.parse(await hyprQuery('j/cursorpos'));
      const b = targetDisplay().bounds;
      const x = p.x - b.x;
      const y = p.y - b.y;
      const prev = hypr.cursor;
      hypr.cursor = { x, y, gx: p.x, gy: p.y, inside: x >= 0 && y >= 0 && x < b.width && y < b.height };
      if (!prev || prev.x !== x || prev.y !== y) {
        syncPassive();
        send('overlay:pointer', { x, y, inside: hypr.cursor.inside });
      }
    }
  } catch {}
  pointerTimer = setTimeout(pointerLoop, pointerPollMs);
}

function watchHyprEvents() {
  const file = hyprSocket('.socket2.sock');
  if (!file) return;
  const sock = nodeNet.createConnection(file);
  let buf = '';
  sock.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('activewindowv2>>')) continue;
      const addr = hexAddress(line.slice('activewindowv2>>'.length).trim());
      if (addr && addr !== hypr.address && addr !== '0x' && addr !== ',') hypr.lastForeign = addr;
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => setTimeout(watchHyprEvents, 2000));
}

function hudFocus() {
  return hyprSerial(async () => {
    hypr.hud = true;
    const addr = await hyprWindow();
    if (!addr) return;
    try {
      const active = JSON.parse(await hyprQuery('j/activewindow'));
      if (active && active.address && active.address !== addr) hypr.lastForeign = active.address;
    } catch {}
    await applyPassive(false);
    await hyprQuery(`dispatch focuswindow address:${addr}`);
  });
}

function hudRelease() {
  return hyprSerial(async () => {
    hypr.hud = false;
    if (hypr.lastForeign) await hyprQuery(`dispatch focuswindow address:${hypr.lastForeign}`);
    await applyPassive(wantPassive());
  });
}

function registerIpc() {
  ipcMain.on('overlay:zones', (_e, payload) => {
    if (process.env.CAPRI_NOINTERACT) return;
    const zones = Array.isArray(payload?.zones) ? payload.zones : [];
    hypr.zones = zones
      .filter((z) => z && [z.x, z.y, z.w, z.h].every(Number.isFinite))
      .slice(0, 16);
    hypr.hold = Boolean(payload?.hold);
    syncPassive();
  });
  ipcMain.on('overlay:interactive', (_e, on) => {
    if (process.env.CAPRI_NOINTERACT) return;
    if (!overlay || overlay.isDestroyed()) return;
    overlayInteractive = Boolean(on);
    overlay.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('menu:open', () => {
    if (!trayMenu) rebuildTray();
    trayMenu.popup({ window: overlay });
  });
  ipcMain.handle('config:get', () => config.load());
  ipcMain.handle('env:power', () => ({ saver: Boolean(envProfile?.power.saver) }));
  ipcMain.handle('config:set', (_e, patch) => updateConfig(patch));
  ipcMain.handle('sounds:list', () => {
    try {
      return fs.readdirSync(userSoundsDir())
        .filter((f) => SOUND_EXT.test(f))
        .map((f) => ({ name: f.replace(SOUND_EXT, '').toLowerCase(), url: `capri://usersounds/${encodeURIComponent(f)}` }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('hud:open', async () => {
    if (!overlay || overlay.isDestroyed()) return false;
    overlay.setFocusable(true);
    await hudFocus();
    overlay.focus();
    return true;
  });
  ipcMain.handle('hud:close', async () => {
    if (!overlay || overlay.isDestroyed()) return false;
    overlay.blur();
    overlay.setFocusable(false);
    await hudRelease();
    return true;
  });
  ipcMain.on('overlay:escape', () => {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.blur();
    overlay.setFocusable(false);
    hudRelease();
    toggleVisible(false);
  });

  ipcMain.handle('groq:status', () => ({ hasKey: groq.hasKey() }));
  ipcMain.handle('groq:ask', (e, messages) => runAgent(e.sender, messages));
}

function handleArgs(argv) {
  if (argv.includes('--snapshot')) analyzeSnapshot();
  else if (argv.includes('--route')) routeSelection();
  else sendCommand(argv.includes('--hud') ? 'hud' : 'status');
}

async function main() {
  app.on('second-instance', (_e, argv) => handleArgs(argv));
  if (!(await singleton.claim(handleArgs))) {
    app.exit(0);
    return;
  }

  app.whenReady().then(() => {
    serveProtocol();
    registerIpc();
    createOverlay();
    services = createServices({ config, groq, hyprQuery, deliver: deliverNotice, dataDir: app.getPath('userData') });
    services.bus.on('env.profile', applyEnvironment);
    services.bus.on('env.power', applyEnvironment);
    services.bus.on('cmd.done', (ev) => {
      recentCommands.push({ cmd: String(ev.cmd || ''), code: ev.code, ms: ev.ms, cwd: ev.cwd, at: Date.now() });
      recentCommands.splice(0, recentCommands.length - 10);
    });
    services.start();
    watchHyprEvents();
    pointerLoop();
    if (!process.env.CAPRI_NO_TRAY) createTray();
    if (!process.env.CAPRI_NO_SHORTCUT) {
      try {
        globalShortcut.register('Control+Alt+C', () => toggleVisible());
      } catch (e) {
        console.error('[capri] globalShortcut failed:', e.message);
      }
    }
    screen.on('display-metrics-changed', fitOverlay);
    screen.on('display-added', () => { fitOverlay(); rebuildTray(); });
    screen.on('display-removed', () => { fitOverlay(); rebuildTray(); });
  });

  app.on('will-quit', () => {
    clearTimeout(pointerTimer);
    services?.stop();
    globalShortcut.unregisterAll();
  });
  app.on('window-all-closed', (e) => e.preventDefault());
}

main();
