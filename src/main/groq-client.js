'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');

const TIMEOUT_MS = 30000;
const MAX_HISTORY = 16;
const MAX_TOKENS = 900;

const HISTORY_CHARS = 9000;
const LAST_MSG_CHARS = 4500;
const RECENT_MSG_CHARS = 1500;
const OLD_MSG_CHARS = 400;

const TPM = Number(process.env.GROQ_TPM) || 8000;
const WINDOW_MS = 60000;
const INTERACTIVE_SHARE = 0.95;
const BACKGROUND_SHARE = 0.6;
const BACKGROUND_GAP_MS = 8000;
const MAX_BUDGET_WAIT_MS = { interactive: 45000, background: 120000 };
const RETRIES_429 = 3;
const MAX_RETRY_AFTER_S = 90;

const MODELS = process.env.GROQ_MODEL
  ? [process.env.GROQ_MODEL]
  : ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

const PROMPT_TEMPLATE = `Ты — Капри, агент на рабочем столе пользователя. Дерзкая, отвечаешь коротко, по-русски.
Среда: @@ENV@@
Действуешь сама через bash — блоком:
\`\`\`exec
команды
\`\`\`
Он выполнится (bash в ~, таймаут 30 с), вывод придёт сообщением [РЕЗУЛЬТАТ EXEC]. До 5 шагов; ответ без exec = итог, одна фраза.
- Просят сделать — сразу exec. Никаких «сделайте сами» и инструкций пользователю. Не знаешь как — разведай (sys_info, --help, web_action search).
- Успех — только после РЕЗУЛЬТАТА без ошибок; упало — исправь по STDERR (до 2 раз) или честно скажи, что не вышло.
- Надёжные шаги — в один блок через &&; отдельный шаг, когда следующее зависит от вывода.
- Опасное (sudo, rm, kill, пакеты, git apply) пользователь подтвердит в диалоге — пиши всё равно. Интерактивное — launch "@@TERM@@ -e команда". Встроенных инструментов нет, только exec.
Функции в каждом скрипте:
- focus telegram|discord|zen|firefox|browser|'регулярка класса' — фокус с проверкой; после него type_text "текст", key Return|Tab|Escape, combo ctrl v вводят только в это окно (ошибка «Фокус не на…» — не повторяй вслепую). send_message discord "текст".
- launch "программа"; open_url URL; screen_text ['класс'] — OCR; screenshot; буфер: @@CLIP@@
- Telegram — ТОЛЬКО tg_send @username "текст" | tg_send "Имя как в контактах (именительный, без транслита)" "текст" | tg_send - "текст" в открытый чат; код 4 — не отправлено, скажи.
- Discord: focus discord && combo ctrl k && type_text "имя" && sleep 0.8 && key Return && sleep 0.5 && type_text "текст" && key Return
- media_control play|pause|next|prev|volume N|volume_up|mute|status|sinks|sink N; sys_info; brightnessctl set 50%; notify-send "Капри" "текст"
- web_action search "запрос", потом web_action <url> — текст страницы; web_action <url> open; curl -s URL | jq
- пакеты: @@PKG@@
@@WM@@
Отладка: «что свалилось / почему упало» → context_snapshot (окно, терминал, git, буфер). Фикс кода — патчем: прочитай строки (sed -n, grep -n), затем git -C <репо> apply --check <<'EOF' (unified diff, пути от корня, 3 строки контекста), потом тот же патч без --check. Ссылка на issue/PR/видео/страницу/лог → intent_router '<текст>'. [СНИМОК КОНТЕКСТА] и [ВЫДЕЛЕННОЕ] в сообщении собраны хоткеем — работай с ними сразу.
Игры и сборки: режим включается сам; вручную game_mode on|off|status.`;

const WM_SECTIONS = {
  hyprctl: `Окна (Hyprland): hyprctl clients -j | jq -r '.[]|"\\(.class) ws=\\(.workspace.id): \\(.title)"'; hyprctl dispatch focuswindow|closewindow|togglefloating class:X; movetoworkspacesilent N,class:X; workspace N — только если просят; запуск на воркспейсе: hyprctl dispatch exec "[workspace N silent] программа"`,
  swaymsg: `Окна (Sway): swaymsg -t get_tree | jq -r '..|objects|select(.pid?)|"\\(.app_id // .window_properties.class): \\(.name)"'; swaymsg '[app_id="X"] focus|kill|floating toggle'; '[app_id="X"] move container to workspace N'`,
  xdotool: `Окна (X11): wmctrl -lx; xdotool search --class X windowactivate|windowclose|windowmove 100 100|windowsize 900 600; xdotool set_desktop N`,
  kdotool: `Окна (KDE Wayland): kdotool search --class X windowactivate|windowclose|windowmove|windowsize; kdotool getactivewindow getwindowclassname`,
  none: `Окна: управлять ими здесь нечем — запускай через launch, вводи только в окно в фокусе; попросят управлять окнами — скажи, что недоступно.`,
};

const PKG_COMMANDS = {
  pacman: 'pacman -Qs/-Ss имя (AUR: paru/yay)',
  apt: 'dpkg -l | grep имя, apt search имя',
  dnf: 'rpm -qa | grep имя, dnf search имя',
  zypper: 'rpm -qa | grep имя, zypper search имя',
};

const DEFAULT_ENV = {
  distro: { name: 'Arch Linux', pkg: 'pacman' },
  session: { wm: 'hyprland', display: 'wayland', windowTool: 'hyprctl', terminal: 'kitty' },
};
let environment = null;

function setEnvironment(profile) {
  environment = profile;
}

const WM_NAMES = { hyprland: 'Hyprland', sway: 'Sway', kde: 'KDE', gnome: 'GNOME', x11: 'X11', wayland: 'Wayland' };
const GPU_NAMES = { amd: 'AMD', nvidia: 'NVIDIA', intel: 'Intel' };

function envLine(p) {
  const { distro, session, gpu, power, audio } = p;
  const parts = [
    distro.name,
    session.wm === 'x11' ? 'X11' : `${WM_NAMES[session.wm] || session.wm}/${session.display === 'x11' ? 'X11' : 'Wayland'}`,
    session.terminal || 'терминала нет',
  ];
  if (gpu) parts.push(`GPU ${GPU_NAMES[gpu.vendor] || gpu.vendor}`);
  if (power) {
    parts.push(power.battery ? `Batt ${power.battery.capacity}% (${power.onAC ? 'сеть' : 'батарея'})` : 'от сети');
    if (power.saver) parts.push('ЭКОНОМИЯ: тяжёлое без просьбы не запускай');
  }
  if (audio && audio.server !== 'none') parts.push(`звук ${audio.server}`);
  return parts.join(' | ');
}

function buildSystemPrompt(p = environment || DEFAULT_ENV) {
  const { distro, session } = p;
  const x11 = session.display === 'x11';
  const vars = {
    ENV: envLine(p),
    TERM: session.terminal || 'xterm',
    WM: WM_SECTIONS[session.windowTool] || WM_SECTIONS.none,
    PKG: PKG_COMMANDS[distro.pkg] || 'пакетный менеджер не определён',
    CLIP: x11 ? 'xclip -selection clipboard [-o]' : 'wl-copy / wl-paste',
  };
  return PROMPT_TEMPLATE.replace(/@@(\w+)@@/g, (m, k) => vars[k] ?? m);
}

const EXEC_REPORT = /^\[РЕЗУЛЬТАТ EXEC/;

function squeeze(text, limit) {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  return `${text.slice(0, head)}\n…[сокращено ${text.length - limit} симв.]…\n${text.slice(text.length - (limit - head))}`;
}

function fitHistory(messages) {
  const list = messages.slice(-MAX_HISTORY);
  let task = -1;
  list.forEach((m, i) => { if (m.role === 'user' && !EXEC_REPORT.test(String(m.content ?? ''))) task = i; });
  const fitted = list.map((m, i) => {
    const fromEnd = list.length - 1 - i;
    const limit = fromEnd === 0 ? LAST_MSG_CHARS : (fromEnd <= 2 || i === task) ? RECENT_MSG_CHARS : OLD_MSG_CHARS;
    return { ...m, content: squeeze(String(m.content ?? ''), limit), pinned: i === task || fromEnd === 0 };
  });
  let total = fitted.reduce((n, m) => n + m.content.length, 0);
  for (let i = 0; i < fitted.length && total > HISTORY_CHARS;) {
    if (fitted[i].pinned) { i++; continue; }
    total -= fitted.splice(i, 1)[0].content.length;
  }
  while (fitted.length > 1 && fitted[0].role === 'assistant' && !fitted[0].pinned) fitted.shift();
  return fitted.map(({ pinned, ...m }) => m);
}

const KEY_ERROR = 'GROQ_API_KEY не найден или некорректно прочитан из окружения/конфига';

const sanitizeKey = (raw) => String(raw || '').replace(/[^a-zA-Z0-9_\-]/g, '').trim();
const isValidKey = (key) => key.startsWith('gsk_');

const RC_KEY_PATTERNS = [
  /^\s*(?:export\s+)?GROQ_API_KEY=(.*)$/,
  /^\s*set\s+(?:-[a-zA-Z]+\s+)*GROQ_API_KEY\s+(.*)$/,
  /^SETUVAR\s+(?:--export\s+)?GROQ_API_KEY:(.*)$/,
];

function rcFiles() {
  const home = os.homedir();
  const fish = path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'fish');
  let confd = [];
  try { confd = fs.readdirSync(path.join(fish, 'conf.d')).filter((f) => f.endsWith('.fish')).map((f) => path.join(fish, 'conf.d', f)); } catch {}
  return [path.join(home, '.zshrc'), path.join(home, '.bashrc'), path.join(fish, 'config.fish'), ...confd, path.join(fish, 'fish_variables')];
}

function keyFromRcFiles() {
  let found = '';
  for (const rc of rcFiles()) {
    let text;
    try { text = fs.readFileSync(rc, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      for (const re of RC_KEY_PATTERNS) {
        const m = line.match(re);
        if (m && isValidKey(sanitizeKey(m[1]))) found = sanitizeKey(m[1]);
      }
    }
  }
  return found;
}

function getApiKey() {
  const fromEnv = sanitizeKey(process.env.GROQ_API_KEY);
  if (isValidKey(fromEnv)) return fromEnv;
  const fromRc = keyFromRcFiles();
  if (fromRc) process.env.GROQ_API_KEY = fromRc;
  return fromRc;
}

const hasKey = () => Boolean(getApiKey());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const usage = new Map();
const blockedUntil = new Map();

function usedTokens(model) {
  const now = Date.now();
  const list = (usage.get(model) || []).filter((u) => now - u.at < WINDOW_MS);
  usage.set(model, list);
  return list.reduce((n, u) => n + u.tokens, 0);
}

function recordTokens(model, tokens) {
  if (!usage.has(model)) usage.set(model, []);
  usage.get(model).push({ at: Date.now(), tokens });
}

const estimateTokens = (body) => Math.ceil(JSON.stringify(body.messages).length / 3) + Math.min(body.max_completion_tokens, 400);

async function waitForBudget(model, estimate, background, onWait) {
  const limit = TPM * (background ? BACKGROUND_SHARE : INTERACTIVE_SHARE);
  const deadline = Date.now() + MAX_BUDGET_WAIT_MS[background ? 'background' : 'interactive'];
  const t0 = Date.now();
  let told = false;
  const blocked = (blockedUntil.get(model) || 0) - Date.now();
  if (blocked > 0) {
    onWait?.(Math.ceil(blocked / 1000));
    told = true;
    await sleep(blocked);
  }
  while (usedTokens(model) + estimate > limit && Date.now() < deadline) {
    const oldest = usage.get(model)[0];
    const ms = Math.max(500, Math.min(oldest ? oldest.at + WINDOW_MS - Date.now() + 200 : 1000, deadline - Date.now()));
    if (!told) {
      onWait?.(Math.ceil(ms / 1000));
      told = true;
    }
    await sleep(ms);
  }
  return Date.now() - t0;
}

let lastRequestAt = 0;
let backgroundChain = Promise.resolve();

function inBackgroundQueue(fn) {
  const run = backgroundChain.then(async () => {
    const gap = lastRequestAt + BACKGROUND_GAP_MS - Date.now();
    if (gap > 0) await sleep(gap);
    return fn();
  });
  backgroundChain = run.catch(() => {});
  return run;
}

function retryAfterFromMessage(msg) {
  const m = String(msg).match(/try again in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?/i);
  if (!m || !m.slice(1).some(Boolean)) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) + (Number(m[4] || 0) / 1000);
}

function request(model, messages, opts = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) return reject(new Error(KEY_ERROR));

    const body = {
      model,
      messages: [{ role: 'system', content: opts.system || buildSystemPrompt() }, ...fitHistory(messages)],
      temperature: 0.7,
      max_completion_tokens: opts.maxTokens || MAX_TOKENS,
    };
    if (model.startsWith('openai/gpt-oss')) {
      body.reasoning_effort = 'low';
      body.include_reasoning = false;
    }
    const payload = JSON.stringify(body);
    const estimate = estimateTokens(body);

    waitForBudget(model, estimate, opts.background, opts.onWait).then(() => {
      lastRequestAt = Date.now();
      const req = https.request({
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: TIMEOUT_MS,
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            return reject(new Error(`Parse error (HTTP ${res.statusCode}): ${raw.slice(0, 100)}`));
          }
          if (res.statusCode >= 400) {
            const err = new Error(data.error?.message || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            if (res.statusCode === 429) {
              const header = Number(res.headers['retry-after']);
              err.retryAfter = retryAfterFromMessage(err.message) ?? (Number.isFinite(header) ? header : null);
            }
            return reject(err);
          }
          const tokens = data.usage?.total_tokens ?? estimate;
          recordTokens(model, tokens);
          resolve(data.choices?.[0]?.message?.content || '');
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(payload);
      req.end();
    }, reject);
  });
}

const NO_TOOLS = /tool choice is none|called a tool|tool_use_failed/i;
const NO_TOOLS_NUDGE = { role: 'system', content: 'Не вызывай инструменты. Ответь текстом с блоком exec (для интернета — web_action search "запрос").' };

async function requestWithRetry(model, messages, opts) {
  let nudged = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(model, nudged ? [...messages, NO_TOOLS_NUDGE] : messages, opts);
    } catch (err) {
      if (NO_TOOLS.test(err.message) && !nudged) {
        console.error(`[groq] ${model} попыталась вызвать инструмент, повторяю`);
        nudged = true;
        continue;
      }
      if (err.status !== 429) throw err;
      const wait = err.retryAfter ?? 2 ** (attempt + 1);
      if (wait > MAX_RETRY_AFTER_S) {
        throw new Error(`лимит Groq исчерпан надолго (повтор через ${Math.ceil(wait / 60)} мин) — похоже, дневной`);
      }
      if (attempt >= RETRIES_429) throw new Error(`лимит Groq: ${RETRIES_429} раза подряд 429, попробуй через минуту`);
      console.error(`[groq] ${model}: 429, жду ${wait.toFixed(1)} с (попытка ${attempt + 1}/${RETRIES_429})`);
      blockedUntil.set(model, Date.now() + wait * 1000 + 250);
    }
  }
}

function ask(messages, opts = {}) {
  return opts.background ? inBackgroundQueue(() => askModels(messages, opts)) : askModels(messages, opts);
}

async function askModels(messages, opts) {
  const models = opts.background ? [...MODELS].reverse() : MODELS;
  let lastErr;
  for (const model of models) {
    const t0 = Date.now();
    try {
      const reply = await requestWithRetry(model, messages, opts);
      return reply;
    } catch (err) {
      lastErr = err;
      console.error(`[groq] ${model} ошибка за ${Date.now() - t0} мс: ${err.message}`);
      if (err.status === 429 || /лимит Groq/.test(err.message)) throw err;
      if (!/decommission|not found|does not exist|model_not_found|timeout/i.test(err.message)) throw err;
    }
  }
  throw lastErr;
}

module.exports = { ask, hasKey, setEnvironment, buildSystemPrompt };
