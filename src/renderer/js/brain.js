import { LINES } from './lines.js';
import { pick, fmt } from './util.js';

export class Brain {
  constructor({ capri, panel, voice, host }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.history = [];
    this.busy = false;
    host.onAgentStep?.((step) => this.onStep(step));
    host.onNotice?.((n) => this.notice(n));
  }

  notice(n) {
    if (n.context) {
      this.history.push(
        { role: 'user', content: `[ФОНОВОЕ СОБЫТИЕ — замечено самой Капри, а не сообщение пользователя]\n${n.context}` },
        { role: 'assistant', content: [n.line, n.reply].filter(Boolean).join(' ') },
      );
    }
    if (n.silent || this.busy) return;
    this.capri.setMode('idle');

    this.capri.wake();
    if (n.kind === 'error') {
      this.capri.hurt();
      this.voice.play('error');
      this.say('error', n.line, { quote: clip(n.quote, 150), face: n.face, reply: n.reply || undefined, hold: n.reply ? null : 9000 });
    } else if (n.kind === 'done') {
      this.capri.celebrate({ onSpeak: () => this.say('done', n.line, { quote: clip(n.quote, 150), face: n.face, hold: 6000 }) });
    } else {
      if (n.kind === 'alert') this.voice.play('alert');
      this.say(n.kind || 'info', n.line, { quote: clip(n.quote, 150), face: n.face, reply: n.reply || undefined, hold: n.reply ? null : 9000 });
    }
  }

  get t() {
    return LINES.ru;
  }

  say(kind, line, extra = {}) {
    this.panel.say({ kind, line, tag: 'Capri', ...extra });
  }

  status() {
    if (this.busy) {
      this.say('work', pick(this.t.busy), { hold: 3000 });
      return;
    }
    this.say('idle', pick(this.t.idle), { hold: 4000 });
  }

  progress(line) {
    if (this.busy) return;
    this.capri.wake();
    this.capri.setMode('work');
    this.say('work', line, { hold: null });
  }

  async ask(text, { label } = {}) {
    const prompt = String(text || '').trim();
    if (!prompt) return;
    if (this.busy) {
      this.say('work', pick(this.t.busy), { hold: 2500 });
      return;
    }
    this.busy = true;
    this.history.push({ role: 'user', content: prompt });

    this.capri.wake();
    this.capri.goToWork();
    this.capri.setMode('work');
    this.capri.pulse();
    this.say('work', pick(this.t.thinking), { quote: clip(label || prompt, 110), face: 'aside', hold: null });

    let res;
    try {
      res = await this.host.askGroq(this.history.slice(-20));
    } catch (err) {
      res = { ok: false, error: err.message };
    }
    if (res.messages?.length) this.history.push(...res.messages);
    this.busy = false;

    if (!res.ok) {
      this.capri.setMode('idle');
      this.capri.hurt();
      this.voice.play('error');
      this.say('error', fmt(pick(this.t.error), { error: res.error || 'unknown error' }), { hold: 7000 });
      return;
    }

    const spoken = String(res.reply || '').trim();
    if (spoken) {
      this.panel.hide();
      this.capri.celebrate({ onSpeak: () => this.say('done', pick(this.t.reply), { reply: spoken, hold: null }) });
    } else {
      this.capri.setMode('idle');
      this.say('done', pick(this.t.done), { hold: 5000 });
    }
  }

  onStep(step) {
    if (!this.busy) return;
    if (step.type === 'say') {
      this.say('work', pick(this.t.reply), { reply: step.text, hold: null });
    } else if (step.type === 'exec') {
      this.capri.setMode('work');
      this.capri.spark();
      this.say('work', fmt(pick(this.t.exec), { command: clip(step.command, 90) }), { hold: null });
    } else if (step.type === 'wait') {
      this.say('work', fmt(pick(this.t.wait), { seconds: step.seconds }), { face: 'aside', hold: null });
    } else if (step.type === 'result') {
      this.showResult(step.command, step.res);
    }
  }

  showResult(command, res) {
    if (res.ok) {
      this.capri.celebrate({
        onSpeak: () => this.say('done', pick(this.t.execOk), {
          quote: clip(res.stdout?.trim() || command, 150),
          hold: 6000,
        }),
      });
    } else {
      this.capri.setMode('idle');
      this.capri.hurt();
      this.voice.play('error');
      this.say('error', pick(this.t.execFail), {
        quote: clip((res.stderr || res.error || `exit ${res.code}`).trim(), 150),
        hold: 8000,
      });
    }
  }
}

function clip(text, max) {
  const str = String(text || '');
  return str.length > max ? str.slice(0, max - 1).trimEnd() + '…' : str;
}
