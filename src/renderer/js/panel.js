import { clamp, ease, reducedMotion } from './util.js';

const NOISE = '▚▞▙▟░▒#%&/\\<>01XZ';

const FACE_DIR = '../../assets/capri/';
export const FACES = {
  calm: 'face-calm.png',
  aside: 'face-aside.png',
  smug: 'face-smug.png',
  wide: 'face-wide.png',
  look: 'face-look.png',
  laugh: 'face-laugh.png',
  many: 'face-many.png',
  grin: 'capri-face.png',
};
const KIND_FACE = { alert: 'many', done: 'look', error: 'laugh', work: 'calm', idle: 'calm', report: 'smug', chat: 'look' };
const PRIORITY = { info: 1, idle: 1, work: 2, done: 3, error: 3, report: 3, chat: 3, alert: 4 };
const DECODE_STEP_MS = 28;
const COUNT_MS = 700;

export class Panel {
  constructor({ panel, ticker, labels }) {
    this.el = panel;
    this.tickerEl = ticker;
    this.labels = labels;
    this.line = panel.querySelector('.panel__line');
    this.portrait = panel.querySelector('.panel__face img');
    this.quote = panel.querySelector('.panel__quote');
    this.reply = panel.querySelector('.panel__reply');
    this.report = panel.querySelector('.panel__report');
    this.actions = panel.querySelector('.panel__actions');
    this.onAction = null;
    this.onDismiss = null;
    this.summary = panel.querySelector('.panel__summary');
    this.log = panel.querySelector('.panel__log');
    this.tag = panel.querySelector('.panel__tag');
    this.state = panel.querySelector('.panel__state');
    this.tickerVerb = ticker.querySelector('.ticker__verb');
    this.tickerTarget = ticker.querySelector('.ticker__target');
    this.current = null;
    this.hideTimer = null;
    this.decodeTimer = null;
    this.anchor = { x: 0, y: 0, side: 1 };
    this.view = { w: innerWidth, h: innerHeight };
    this.onChar = null;
    this.onTalk = null;
    this.suspended = false;
    this.tickerAction = null;
    this.tickerShownAt = 0;
    this.tickerTimer = null;
    this.missed = null;

    this.chatForm = panel.querySelector('.panel__chat');
    this.chatInput = panel.querySelector('.panel__input');
    this.chatSend = panel.querySelector('.panel__send');
    this.chatClose = panel.querySelector('.panel__close');
    this.note = panel.querySelector('.panel__note');
    this.chatForm.addEventListener('click', (e) => e.stopPropagation());
    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.trim();
      if (!text || this.chatInput.disabled) return;
      this.chatInput.value = '';
      this.current?.onSend?.(text);
    });
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
    this.chatClose.addEventListener('click', () => this.hide());

    this.el.addEventListener('click', () => {
      if (this.current?.chat) this.chatInput.focus();
      else this.hide();
    });
    this.portrait.addEventListener('animationend', (e) => {
      if (e.animationName === 'face-swap') this.portrait.classList.remove('is-swapping');
    });
  }

  get visible() {
    return !this.el.hidden && !this.suspended && !this.leaving;
  }

  say(msg) {
    const cur = this.current;
    if (cur && this.visible && cur.kind !== msg.kind && PRIORITY[cur.kind] > PRIORITY[msg.kind] && performance.now() - cur.at < 2600) {
      return false;
    }
    if (cur?.reply && this.visible && PRIORITY[msg.kind] < 2) return false;
    if (cur?.report && this.visible && PRIORITY[msg.kind] < 3) return false;
    if (cur?.chat && !this.el.hidden && !this.leaving && PRIORITY[msg.kind] < 4) {
      if (PRIORITY[msg.kind] >= 3) this.missed = { ...msg, missedAt: performance.now() };
      return false;
    }
    if (cur && this.visible) this.onDismiss?.(cur);
    cur?.onLeave?.();
    this.current = { ...msg, at: performance.now() };
    clearTimeout(this.hideTimer);

    this.el.dataset.kind = msg.kind;
    this.setFace(msg.face || KIND_FACE[msg.kind] || 'grin');
    this.tag.textContent = msg.tag || '';
    this.state.textContent = msg.badge || this.labels.state[msg.kind] || '';
    this.quote.textContent = msg.quote || '';
    this.quote.hidden = !msg.quote;
    this.reply.textContent = msg.reply || '';
    this.reply.hidden = !msg.reply;
    this.reply.scrollTop = 0;
    this.el.classList.toggle('has-reply', Boolean(msg.reply));
    this.el.classList.toggle('has-report', Boolean(msg.report));
    this.el.classList.toggle('is-guide', Boolean(msg.guide));
    this.renderReport(msg.report);
    this.renderActions(msg.actions, msg.onAction);
    this.renderChat(msg.chat);
    this.summary.textContent = msg.summary || '';
    this.summary.hidden = !msg.summary;
    this.renderLog(msg.log || []);

    this.tickerEl.hidden = true;
    this.leaving = false;
    this.el.hidden = false;
    this.el.classList.remove('is-leaving');
    this.replayEnter();
    this.place();
    this.decode(msg.line || '', msg.kind);

    if (msg.hold) this.hideTimer = setTimeout(() => this.hide(), msg.hold);
    return true;
  }

  setFace(name) {
    const src = FACE_DIR + (FACES[name] || FACES.grin);
    if (this.portrait.getAttribute('src') === src) return;
    this.portrait.setAttribute('src', src);
    if (reducedMotion.matches) return;
    this.portrait.classList.remove('is-swapping');
    void this.portrait.offsetWidth;
    this.portrait.classList.add('is-swapping');
  }

  renderReport(report) {
    clearInterval(this.countTimer);
    this.report.hidden = !report;
    if (!report) {
      this.report.replaceChildren();
      return;
    }
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const number = (className, value) => {
      const node = el('b', className, '0');
      node.dataset.value = value;
      return node;
    };
    const head = el('header', 'report__head');
    head.append(el('span', 'report__title', this.labels.report.title), el('span', 'report__date', report.date));
    const hero = el('div', 'report__hero');
    hero.append(number('report__big', report.hero.value), el('span', 'report__label', report.hero.label));
    const grid = el('dl', 'report__grid');
    for (const stat of report.stats) {
      const cell = el('div', stat.hot ? 'report__cell is-hot' : 'report__cell');
      const value = el('dd');
      value.append(number('report__num', stat.value));
      cell.append(el('dt', 'report__label', stat.label), value);
      grid.append(cell);
    }
    const parts = [head, hero, grid];
    if (report.longest) {
      const longest = el('p', 'report__longest');
      longest.append(el('span', 'report__chip', report.longest.label), el('span', 'report__project', report.longest.project), el('b', 'report__time', report.longest.time));
      parts.push(longest);
    }
    const foot = el('footer', 'report__foot');
    foot.append(el('span', '', report.foot), el('span', 'report__sign', 'CAPRI // PROJECT CAPRICORN'));
    parts.push(foot);
    this.report.replaceChildren(...parts);

    const numbers = [...this.report.querySelectorAll('[data-value]')];
    const show = (node, k) => {
      node.textContent = Math.round(Number(node.dataset.value) * k).toLocaleString(document.documentElement.lang);
    };
    if (reducedMotion.matches) {
      numbers.forEach((node) => show(node, 1));
      return;
    }
    const t0 = performance.now();
    const step = () => {
      let counting = false;
      numbers.forEach((node, i) => {
        const k = clamp((performance.now() - t0 - 180 - i * 70) / COUNT_MS, 0, 1);
        show(node, ease.out(k));
        if (k < 1) counting = true;
      });
      if (!counting) clearInterval(this.countTimer);
    };
    step();
    this.countTimer = setInterval(step, 1000 / 12);
  }

  renderActions(actions = [], onAction = null) {
    this.actions.replaceChildren(...actions.map(({ id, label, primary }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'panel__action is-primary' : 'panel__action';
      button.dataset.id = id;
      button.textContent = label;
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onAction) onAction(id);
        else this.onAction?.(id);
      });
      return button;
    }));
    this.actions.hidden = !actions.length;
  }

  setActions(actions, onAction) {
    if (!this.current) return;
    this.current.actions = actions;
    this.renderActions(actions, onAction);
    this.place();
  }

  renderChat(chat) {
    this.el.classList.toggle('is-chat', Boolean(chat));
    this.line.classList.remove('is-streaming');
    this.chatForm.hidden = !chat;
    this.note.hidden = !chat;
    if (!chat) return;
    this.chatInput.placeholder = chat.placeholder;
    this.chatInput.setAttribute('aria-label', chat.placeholder);
    this.chatInput.disabled = false;
    this.chatSend.disabled = false;
    this.chatSend.textContent = chat.send;
    this.chatClose.setAttribute('aria-label', chat.close);
    const tag = document.createElement('b');
    tag.textContent = chat.noteTag;
    this.note.replaceChildren(tag, ` ${chat.note}`);
    requestAnimationFrame(() => this.chatInput.focus());
  }

  chatTurn({ quote, face }) {
    if (!this.current?.chat) return;
    clearInterval(this.decodeTimer);
    this.setFace(face);
    this.quote.textContent = quote;
    this.quote.hidden = !quote;
    this.line.textContent = '';
    this.line.classList.add('is-streaming');
    this.place();
  }

  stream(text, { done = false } = {}) {
    if (!this.current?.chat) return;
    this.line.textContent = text;
    this.line.classList.toggle('is-streaming', !done);
    this.line.scrollTop = this.line.scrollHeight;
    this.place();
  }

  setChatBusy(busy) {
    this.chatInput.disabled = busy;
    this.chatSend.disabled = busy;
    if (!busy && this.current?.chat) this.chatInput.focus();
  }

  relabel(id, label) {
    const button = this.actions.querySelector(`[data-id="${id}"]`);
    if (button) button.textContent = label;
  }

  async snapshot(copy) {
    this.el.classList.add('is-capturing');
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    await frame();
    const r = this.el.getBoundingClientRect();
    const pad = 18;
    const rect = {
      x: Math.max(0, Math.floor(r.left - pad)),
      y: Math.max(0, Math.floor(r.top - pad)),
      width: Math.ceil(r.width + pad * 2 + 6),
      height: Math.ceil(r.height + pad * 2 + 6),
    };
    const plate = document.createElement('div');
    plate.className = 'snap-plate';
    Object.assign(plate.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.append(plate);
    await frame();
    await frame();
    try {
      return await copy(rect);
    } finally {
      plate.remove();
      this.el.classList.remove('is-capturing');
    }
  }

  updateLog(log) {
    if (this.current && this.visible) this.renderLog(log);
  }

  renderLog(entries) {
    this.log.replaceChildren(...entries.slice(-4).map((e) => {
      const li = document.createElement('li');
      if (e.error) li.className = 'is-error';
      const verb = document.createElement('span');
      verb.className = 'panel__verb';
      verb.textContent = e.verb;
      const target = document.createElement('span');
      target.className = 'panel__target';
      target.textContent = e.target || '';
      li.append(verb, target);
      return li;
    }));
    this.log.hidden = entries.length === 0;
  }

  hide() {
    clearTimeout(this.hideTimer);
    clearInterval(this.decodeTimer);
    this.onTalk?.(false);
    if (this.el.hidden || this.leaving) return;
    const gone = this.current;
    this.current = null;
    this.leaving = true;
    if (gone) {
      this.onDismiss?.(gone);
      gone.onLeave?.();
    }
    const missed = gone?.chat && this.missed;
    this.missed = null;
    if (missed && performance.now() - missed.missedAt < 120000) setTimeout(() => this.say(missed), 400);
    if (reducedMotion.matches) {
      this.el.hidden = true;
    } else {
      this.el.classList.add('is-leaving');
      setTimeout(() => {
        if (this.leaving) this.el.hidden = true;
      }, 150);
    }
    if (this.tickerAction) this.setTicker(this.tickerAction);
  }

  clearKind(kind) {
    if (this.current?.kind === kind) this.hide();
  }

  suspend() {
    this.suspended = true;
    this.el.style.visibility = 'hidden';
    this.tickerEl.style.visibility = 'hidden';
  }

  resume() {
    this.suspended = false;
    this.el.style.visibility = '';
    this.tickerEl.style.visibility = '';
    this.place();
    if (!this.el.hidden) this.replayEnter();
  }

  replayEnter() {
    this.el.classList.remove('is-entering');
    void this.el.offsetWidth;
    this.el.classList.add('is-entering');
  }

  decode(text, kind) {
    clearInterval(this.decodeTimer);
    if (reducedMotion.matches || !text) {
      this.line.textContent = text;
      return;
    }
    const chars = [...text];
    let done = 0;
    this.onTalk?.(true);
    const step = () => {
      done = Math.min(chars.length, done + 2);
      const head = chars.slice(0, done).join('');
      let tail = '';
      for (let i = done; i < Math.min(chars.length, done + 6); i++) {
        tail += chars[i] === ' ' ? ' ' : NOISE[Math.floor(Math.random() * NOISE.length)];
      }
      this.line.textContent = head + tail;
      if (chars[done - 1] && chars[done - 1] !== ' ') this.onChar?.(kind);
      if (done >= chars.length) {
        clearInterval(this.decodeTimer);
        this.line.textContent = text;
        this.onTalk?.(false);
      }
    };
    step();
    this.decodeTimer = setInterval(step, DECODE_STEP_MS);
  }

  setTicker(action) {
    this.tickerAction = action;
    clearTimeout(this.tickerTimer);
    if (!action || this.visible) {
      this.tickerEl.hidden = true;
      return;
    }
    const wait = Math.max(0, 380 - (performance.now() - this.tickerShownAt));
    this.tickerTimer = setTimeout(() => {
      const counting = action.thinking && this.tickerEl.dataset.thinking === 'true' && !this.tickerEl.hidden;
      this.tickerShownAt = performance.now();
      this.tickerVerb.textContent = action.verb;
      this.tickerTarget.textContent = action.target || '';
      this.tickerEl.dataset.error = action.error ? 'true' : 'false';
      this.tickerEl.dataset.thinking = action.thinking ? 'true' : 'false';
      this.tickerEl.hidden = false;
      if (!counting) {
        this.tickerEl.classList.remove('is-flash');
        void this.tickerEl.offsetWidth;
        this.tickerEl.classList.add('is-flash');
      }
      this.place();
    }, wait);
  }

  setAnchor(anchor, view) {
    this.anchor = anchor;
    this.view = view;
    this.place();
  }

  place() {
    const { x, y, top: crown = y - 80, lean = 0 } = this.anchor;
    const { w } = this.view;
    const margin = 14;
    const towardLeft = lean ? lean < 0 : x > w / 2;

    if (!this.el.hidden) {
      const pw = this.el.offsetWidth;
      const ph = this.el.offsetHeight;
      let left = towardLeft ? x - pw + 46 : x - 46;
      left = clamp(left, margin, w - pw - margin);
      let top = crown - ph + 14;
      let below = false;
      if (top < margin) {
        top = y + 40;
        below = true;
      }
      if (this.view.h) top = clamp(top, margin, this.view.h - ph - margin);
      this.el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
      this.el.style.setProperty('--tail-x', `${clamp(x - left, 24, pw - 24)}px`);
      this.el.dataset.below = below ? 'true' : 'false';
    }

    if (!this.tickerEl.hidden) {
      const tw = this.tickerEl.offsetWidth;
      const left = clamp(x - tw / 2, margin, w - tw - margin);
      const top = Math.max(margin, crown - this.tickerEl.offsetHeight - 10);
      this.tickerEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    }
  }

  rect() {
    if (this.el.hidden || this.suspended) return null;
    return this.el.getBoundingClientRect();
  }
}
