#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { redact } = require('./lib/redact.js');
const { activeWindow, findShell, procTable, gitState } = require('./context_snapshot.js');

const MATERIAL_CHARS = 4000;
const MEDIA_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|soundcloud\.com|rutube\.ru|vk\.com\/video|dailymotion\.com|bilibili\.com)$/i;
const MEDIA_EXT = /\.(mp4|mkv|webm|mov|mp3|m4a|ogg|opus|flac|wav)(\?|$)/i;
const ERROR_RE = /Traceback \(most recent call last\)|panicked at|^error(\[E\d+\])?:|\berror:|Exception\b|Segmentation fault|core dumped|SIGSEGV|SIGABRT|npm ERR!|fatal:|undefined reference|cannot find|No such file or directory|FAILED|Uncaught|TypeError|ReferenceError|stack trace|at \S+ \(.*:\d+:\d+\)/m;
const CHANGE_RE = /^(сделай|добавь|исправь|почини|переименуй|удали|замени|перепиши|вынеси|отрефактори|реализуй|допиши|поменяй|add|fix|rename|remove|delete|replace|refactor|implement|make|change|update|extract)(?=\s|$)/i;
const CODE_RE = /[{};]\s*$|^\s*(def|class|function|const|let|var|import|from|fn|pub|impl|struct|#include|package|func|return|if\s*\(|for\s*\()/m;

const has = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, cmd)));

function run(cmd, args, { timeout = 20000, cwd } = {}) {
  return new Promise((resolve) => {
    if (!has(cmd)) return resolve({ ok: false, stdout: '', missing: true });
    execFile(cmd, args, { timeout, cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

const clip = (text, max = MATERIAL_CHARS) => (text.length > max ? `${text.slice(0, max)}\n…[обрезано]` : text);
const expandHome = (p) => p.replace(/^~(?=\/|$)/, os.homedir());

async function selection() {
  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  for (const primary of [true, false]) {
    const res = wayland
      ? await run('wl-paste', ['--no-newline', ...(primary ? ['--primary'] : []), '--type', 'text'], { timeout: 2000 })
      : await run('xclip', ['-o', '-selection', primary ? 'primary' : 'clipboard'], { timeout: 2000 });
    if (res.ok && res.stdout.trim()) return { text: res.stdout, from: primary ? 'выделение' : 'буфер обмена' };
  }
  return { text: '', from: null };
}

function classify(raw) {
  const text = raw.trim();
  const single = !text.includes('\n');
  if (single && /^https?:\/\/\S+$/.test(text)) {
    const url = new URL(text);
    let m = url.href.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
    if (m) return { intent: 'github', owner: m[1], repo: m[2], kind: m[3], number: Number(m[4]), url: text };
    m = url.href.match(/^https?:\/\/([^/]+)\/(.+?)\/-\/(issues|merge_requests)\/(\d+)/);
    if (m && /gitlab/i.test(m[1] + text)) return { intent: 'gitlab', host: m[1], project: m[2], kind: m[3], number: Number(m[4]), url: text };
    if (MEDIA_HOSTS.test(url.hostname) || MEDIA_HOSTS.test(url.hostname + url.pathname) || MEDIA_EXT.test(url.pathname)) return { intent: 'media', url: text };
    return { intent: 'url', url: text };
  }
  if (single && /^(~|\/|\.{1,2}\/)\S*$/.test(text)) {
    const file = path.resolve(expandHome(text));
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return { intent: 'file', file };
  }
  if (ERROR_RE.test(text)) return { intent: 'error', text };
  if (CODE_RE.test(text) && text.split('\n').length > 1) return { intent: 'code', text };
  if (CHANGE_RE.test(text)) return { intent: 'change', text };
  return { intent: 'text', text };
}

function githubToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return Promise.resolve(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  return run('gh', ['auth', 'token'], { timeout: 3000 }).then((r) => (r.ok ? r.stdout.trim() : ''));
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'capri-desktop', Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname}: HTTP ${res.status}`);
  return res.json();
}

async function gatherGithub(t) {
  const token = await githubToken();
  const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const api = `https://api.github.com/repos/${t.owner}/${t.repo}`;
  const issue = await getJson(`${api}/issues/${t.number}`, headers);
  const [comments, pr] = await Promise.all([
    issue.comments ? getJson(`${api}/issues/${t.number}/comments?per_page=100`, headers).catch(() => []) : [],
    issue.pull_request ? getJson(`${api}/pulls/${t.number}`, headers).catch(() => null) : null,
  ]);
  const lines = [
    `${issue.pull_request ? 'Pull request' : 'Issue'} ${t.owner}/${t.repo}#${t.number}: ${issue.title}`,
    `Состояние: ${issue.state}${issue.state_reason ? ` (${issue.state_reason})` : ''}; автор: ${issue.user?.login}; создан ${issue.created_at?.slice(0, 10)}, обновлён ${issue.updated_at?.slice(0, 10)}`,
    issue.labels?.length ? `Метки: ${issue.labels.map((l) => l.name).join(', ')}` : '',
    pr ? `PR: ${pr.merged ? `влит ${pr.merged_at?.slice(0, 10)}` : pr.draft ? 'черновик' : 'не влит'}; ${pr.head?.label} → ${pr.base?.label}; файлов ${pr.changed_files}, +${pr.additions}/−${pr.deletions}; mergeable: ${pr.mergeable_state ?? '?'}` : '',
    `\nОписание:\n${clip(issue.body || '(пусто)', 3000)}`,
    comments.length ? `\nПоследние комментарии (${comments.length} всего):\n${comments.slice(-6).map((c) => `— ${c.user?.login} (${c.created_at?.slice(0, 10)}): ${clip(c.body || '', 600)}`).join('\n')}` : '',
  ];
  return { label: `${t.owner}/${t.repo}#${t.number}`, material: lines.filter(Boolean).join('\n') };
}

async function gatherGitlab(t) {
  const api = `https://${t.host}/api/v4/projects/${encodeURIComponent(t.project)}/${t.kind}/${t.number}`;
  const headers = process.env.GITLAB_TOKEN ? { 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN } : {};
  const [item, notes] = await Promise.all([getJson(api, headers), getJson(`${api}/notes?per_page=50&sort=asc`, headers).catch(() => [])]);
  const human = notes.filter((n) => !n.system);
  const lines = [
    `${t.kind === 'merge_requests' ? 'Merge request' : 'Issue'} ${t.project}!${t.number}: ${item.title}`,
    `Состояние: ${item.state}${item.merge_status ? `, merge: ${item.merge_status}` : ''}; автор: ${item.author?.username}; обновлён ${item.updated_at?.slice(0, 10)}`,
    item.labels?.length ? `Метки: ${item.labels.join(', ')}` : '',
    `\nОписание:\n${clip(item.description || '(пусто)', 3000)}`,
    human.length ? `\nПоследние комментарии:\n${human.slice(-6).map((n) => `— ${n.author?.username}: ${clip(n.body || '', 600)}`).join('\n')}` : '',
  ];
  return { label: `${t.project}!${t.number}`, material: lines.filter(Boolean).join('\n') };
}

function vttToText(vtt) {
  const seen = new Set();
  return vtt.split('\n')
    .filter((l) => l && !/^(WEBVTT|Kind:|Language:|NOTE)|-->/.test(l) && !/^\d+$/.test(l))
    .map((l) => l.replace(/<[^>]+>/g, '').trim())
    .filter((l) => l && !seen.has(l) && seen.add(l))
    .join(' ');
}

async function gatherMedia(t) {
  if (!has('yt-dlp')) return { label: t.url, material: `Ссылка на медиа: ${t.url}\n(yt-dlp не установлен — разобрать содержимое нечем)` };
  const meta = await run('yt-dlp', ['-J', '--no-playlist', '--skip-download', t.url], { timeout: 45000 });
  let info = {};
  try { info = JSON.parse(meta.stdout); } catch {}
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-subs-'));
  await run('yt-dlp', ['--skip-download', '--no-playlist', '--write-subs', '--write-auto-subs', '--sub-langs', 'ru.*,en.*,ru,en',
    '--sub-format', 'vtt', '-o', path.join(dir, 'subs.%(ext)s'), t.url], { timeout: 60000 });
  const vtts = fs.readdirSync(dir).filter((f) => f.endsWith('.vtt'));
  const subsFile = vtts.find((f) => f.includes('.ru')) || vtts[0];
  const subs = subsFile ? vttToText(fs.readFileSync(path.join(dir, subsFile), 'utf8')) : '';
  fs.rm(dir, { recursive: true, force: true }, () => {});
  const mins = info.duration ? `${Math.floor(info.duration / 60)} мин ${info.duration % 60} с` : '?';
  return {
    label: info.title || t.url,
    material: [
      `Медиа: ${info.title || t.url}`,
      `Автор: ${info.uploader || info.channel || '?'}; длительность ${mins}; ${info.upload_date ? `опубликовано ${info.upload_date}` : ''}`,
      info.chapters?.length ? `Главы: ${info.chapters.map((c) => `${Math.floor(c.start_time / 60)}:${String(Math.floor(c.start_time % 60)).padStart(2, '0')} ${c.title}`).join('; ')}` : '',
      info.description ? `\nОписание:\n${clip(info.description, 1500)}` : '',
      subs ? `\nСубтитры (${subsFile.replace(/^subs\.|\.vtt$/g, '')}):\n${clip(subs, 5000)}` : '\nСубтитров нет — суди по описанию и главам.',
    ].filter(Boolean).join('\n'),
  };
}

async function gatherUrl(t) {
  const viaTool = await run('web_action', [t.url], { timeout: 25000 });
  let text = viaTool.ok ? viaTool.stdout : '';
  if (!text.trim()) {
    const res = await fetch(t.url, { headers: { 'User-Agent': 'Mozilla/5.0 capri-desktop' }, signal: AbortSignal.timeout(15000) });
    text = (await res.text()).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  }
  return { label: t.url, material: `Страница ${t.url}:\n${clip(text.trim())}` };
}

async function gatherFile(t) {
  const isLog = /\.(log|out|err)$|\/var\/log\/|journal/i.test(t.file);
  const fd = fs.openSync(t.file, 'r');
  const probe = Buffer.alloc(4096);
  const n = fs.readSync(fd, probe, 0, 4096, 0);
  fs.closeSync(fd);
  if (probe.subarray(0, n).includes(0)) return { label: t.file, material: `Файл ${t.file} — двоичный, текстом не разобрать.` };
  const text = fs.readFileSync(t.file, 'utf8');
  const lines = text.split('\n');
  const body = isLog ? lines.slice(-200).join('\n') : text;
  const errors = isLog ? lines.filter((l) => /\b(error|fail|fatal|panic|exception|critical)\b/i.test(l)).length : 0;
  return {
    label: path.basename(t.file),
    material: `${isLog ? 'Лог' : 'Файл'} ${t.file} (${lines.length} строк${isLog ? `, строк с ошибками: ${errors}` : ''}).\n${isLog ? 'Последние 200 строк' : 'Содержимое'}:\n${clip(isLog ? body.slice(-MATERIAL_CHARS) : body)}`,
  };
}

async function workContext() {
  const win = await activeWindow().catch(() => null);
  if (!win?.pid) return null;
  const term = findShell(procTable(), win.pid);
  const git = await gitState(term.cwd);
  return { window: win.class, cwd: term.cwd, git };
}

const gitBrief = (ctx) => (ctx?.git
  ? `Репозиторий: ${ctx.git.root} (ветка ${ctx.git.branch}). Изменения:\n${ctx.git.diffStat || 'нет'}`
  : ctx?.cwd ? `Каталог терминала: ${ctx.cwd} (не git)` : 'Активный терминал не найден.');

const SUMMARY_PROMPTS = {
  github: 'Ты — Капри. Дай выжимку issue/PR по-русски, 3–6 строк: суть проблемы, текущий статус (и PR: влит ли, что мешает), к чему пришли в комментариях, что делать пользователю. Без воды, без пересказа подряд.',
  gitlab: 'Ты — Капри. Дай выжимку issue/MR по-русски, 3–6 строк: суть, статус, к чему пришли в комментариях, что делать пользователю.',
  media: 'Ты — Капри. По метаданным и субтитрам расскажи по-русски, о чём это видео/аудио: одна фраза сути и 3–6 ключевых тезисов (с таймкодами глав, если они есть). Если субтитров нет — честно скажи, что судишь по описанию.',
  url: 'Ты — Капри. Перескажи страницу по-русски: одна фраза сути и 3–5 главных пунктов. Если это документация или ответ на вопрос — дай сам ответ.',
  file: 'Ты — Капри. Разбери файл по-русски: если это лог — что пошло не так, когда и вероятная причина; если текст или конфиг — суть и что в нём важно. 3–6 строк.',
};

async function route(raw, from = 'выделение') {
  const text = String(raw || '');
  if (!text.trim()) return { intent: 'empty', label: 'пусто', mode: 'none', prompt: '' };
  const t = classify(text);
  const header = `[ВЫДЕЛЕННОЕ — ${from}, интент: ${t.intent}]`;
  switch (t.intent) {
    case 'github':
    case 'gitlab':
    case 'media':
    case 'url':
    case 'file': {
      const g = await { github: gatherGithub, gitlab: gatherGitlab, media: gatherMedia, url: gatherUrl, file: gatherFile }[t.intent](t);
      return { intent: t.intent, label: g.label, mode: 'summarize', system: SUMMARY_PROMPTS[t.intent], prompt: redact(`${header}\n${clip(g.material)}`) };
    }
    case 'error': {
      const ctx = await workContext();
      return {
        intent: 'error', label: 'ошибка', mode: 'agent',
        prompt: redact(`${header}\n${clip(text.trim(), 5000)}\n\n${gitBrief(ctx)}\n\nРазбери ошибку: причина одной фразой, потом локальный фикс — команда или патч через git apply (сначала --check). Нужно больше контекста — context_snapshot, чтение файлов.`),
      };
    }
    case 'change': {
      const ctx = await workContext();
      return {
        intent: 'change', label: clip(text.trim(), 60), mode: 'agent',
        prompt: redact(`${header}\nЗапрос на изменение кода: ${text.trim()}\n\n${gitBrief(ctx)}\n\n${ctx?.git ? 'Найди нужные файлы (grep -rn, sed -n), сделай патч и примени: git -C <репо> apply --check, потом git apply (пользователь увидит дифф и подтвердит).' : 'Репозитория не видно: спроси коротко, где код, или работай с указанным путём.'}`),
      };
    }
    case 'code':
      return { intent: 'code', label: 'фрагмент кода', mode: 'agent', prompt: redact(`${header}\n${clip(text.trim(), 5000)}\n\nКоротко: что делает этот код и есть ли в нём баги. Если он из репозитория в терминале и баг очевиден — предложи патч.`) };
    default:
      return { intent: 'text', label: clip(text.trim(), 60), mode: 'agent', prompt: redact(`${header}\n${clip(text.trim(), 5000)}\n\nОбъясни или ответь на это коротко; если это просьба что-то сделать — сделай.`) };
  }
}

module.exports = { route, selection };

if (require.main === module) {
  (async () => {
    const arg = process.argv.slice(2).join(' ');
    const src = arg ? { text: arg, from: 'аргумент' } : await selection();
    const r = await route(src.text, src.from);
    process.stdout.write(r.mode === 'none' ? 'intent_router: ни выделения, ни буфера\n' : `${r.prompt}\n`);
  })().catch((err) => {
    console.error(`intent_router: ${err.message}`);
    process.exit(1);
  });
}
