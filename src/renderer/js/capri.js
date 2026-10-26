import { SpriteRenderer, SPRITE } from './sprite.js';
import { ACTS, NEUTRAL, Player } from './acting.js';
import { sleep, rand, pick, clamp, lerp, ease, tween, reducedMotion, today, power } from './util.js';

const ON_TWOS = 1000 / 12;
const ON_ONES = 1000 / 24;
const ASLEEP = 1000 / 6;
const SLEEP_AFTER = 10 * 60 * 1000;
const DOZE_AFTER = 20 * 1000;
const GRAVITY = 2600;
const THIGH = 73;

const UPLINK_DAY = 'capri.uplinkDay';

const GREEN = [0.21, 1, 0.48];
const INK = [0.08, 0.06, 0.11];
const RED = [1, 0.13, 0.32];

export class Capri {
  constructor({ root, canvas, image, fx, voice }) {
    this.root = root;
    this.canvas = canvas;
    this.sprite = new SpriteRenderer(canvas, image);
    this.fx = fx;
    this.voice = voice;

    this.scale = 0.6;
    this.view = { w: innerWidth, h: innerHeight };
    this.pos = { x: innerWidth - 200, y: innerHeight - 6 };
    this.facing = 1;
    this.mode = 'idle';
    this.stance = 'stand';
    this.perch = null;
    this.peekSide = null;
    this.windows = { fg: 0, wins: [] };
    this.busy = false;
    this.hidden = false;
    this.stowed = false;
    this.dormant = false;
    this.wander = true;
    this.possessWindows = true;
    this.dragging = false;

    this.p = {
      seed: 0, boil: 0.9, hair: 0, head: 0, mane: 0, armL: 0, armR: 0, longL: 1, longR: 1, sit: 0, kickL: 0, kickR: 0,
      smear: [0, 0], echo: [0, 0],
      glitch: 0, glitchSeed: 0, split: 0, collapse: 0, dissolve: 0, sparkle: 1, grade: 1,
      sil: INK, silAmount: 0, misreg: [-2.6, 2.2], alpha: 1,
    };
    this.bob = 0;
    this.tilt = 0;
    this.sx = 1;
    this.sy = 1;
    this.base = new Player('stand');
    this.act = null;
    this.lastDraw = 0;

    const now = performance.now();
    this.lastActivity = now;
    this.nextTwitch = now + rand(4000, 9000);
    this.nextMove = now + rand(40000, 80000);
    this.nextGaze = now + rand(40000, 90000);
    this.nextShed = now + rand(3000, 8000);
    this.nextNotice = 0;
    this.peekUntil = 0;
    this.lastGlyph = 0;
    this.sleptAt = 0;
    this.uplinkDue = false;
    this.pointing = null;
    this.mouse = null;

    this.onMove = null;
    this.onTeleport = null;
    this.onClick = null;
    this.onMenu = null;
    this.onGaze = null;
    this.onMode = null;
    this.onStow = null;
    this.onUnstow = null;
    this.chipAt = null;
    this.onDoze = null;

    this.alphaMap = this.buildAlphaMap(image);
    this.setScale(this.scale);
    this.bindPointer();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  buildAlphaMap(image) {
    const { width: w, height: h, mirror } = SPRITE;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!SPRITE.armL(x, y) || mirror - x >= w) continue;
        const to = (y * w + mirror - x) * 4 + 3;
        data[to] = Math.max(data[to], data[(y * w + x) * 4 + 3]);
      }
    }
    return data;
  }

  setScale(scale) {
    this.scale = scale;
    this.sprite.resize(scale);
    this.pivot();
    this.place();
  }

  pivot() {
    const s = this.scale;
    const fx = (SPRITE.pad + SPRITE.feet.x) * s;
    const fy = (SPRITE.pad + (this.stance === 'sit' ? SPRITE.hip : SPRITE.feet.y)) * s;
    this.canvas.style.transformOrigin = `${fx}px ${fy}px`;
  }

  setView(w, h) {
    this.view = { w, h };
    if (this.stance === 'stand') {
      this.pos.x = clamp(this.pos.x, 60, w - 60);
      this.pos.y = clamp(this.pos.y, SPRITE.height * this.scale, h - 4);
    }
    this.place();
  }

  get upside() {
    return this.stance === 'peek' && this.peekSide === 'top';
  }

  place() {
    const s = this.scale;
    const left = this.pos.x - (SPRITE.pad + SPRITE.feet.x) * s;
    const top = this.pos.y - (SPRITE.pad + SPRITE.feet.y) * s + this.bob;
    const turn = (this.upside ? 180 : 0) + this.tilt;
    this.root.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    this.canvas.style.transform = `rotate(${turn.toFixed(2)}deg) scale(${(this.facing * this.sx).toFixed(3)}, ${this.sy.toFixed(3)})`;
    this.onMove?.(this.head());
  }

  head(at = this.pos, facing = this.facing) {
    const s = this.scale;
    const bob = at === this.pos ? this.bob : 0;
    const dx = (SPRITE.head.x - SPRITE.feet.x) * s * facing;
    const dy = (SPRITE.feet.y - SPRITE.head.y) * s;
    if (at === this.pos && this.upside) {
      const y = at.y + dy + bob;
      return { x: at.x - dx, y, top: y - 30 * s };
    }
    return { x: at.x + dx, y: at.y - dy + bob, top: at.y - SPRITE.feet.y * s + bob };
  }

  hit(x, y) {
    if (this.hidden || this.p.alpha < 0.5) return false;
    const s = this.scale;
    const fy = this.pos.y + this.bob;
    if (this.upside) {
      x = 2 * this.pos.x - x;
      y = 2 * fy - y;
    }
    const sx = SPRITE.feet.x + ((x - this.pos.x) / s) * this.facing;
    let sy = SPRITE.feet.y - (fy - y) / s;
    if (this.p.sit > 0 && sy > SPRITE.hip) {
      const c = lerp(1, 0.3, this.p.sit);
      sy = sy <= SPRITE.hip + THIGH * c ? SPRITE.hip + (sy - SPRITE.hip) / c : sy + THIGH * (1 - c);
    }
    for (const [dx, dy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) {
      const px = Math.round(sx + dx), py = Math.round(sy + dy);
      if (px < 0 || py < 0 || px >= SPRITE.width || py >= SPRITE.height) continue;
      if (this.alphaMap[(py * SPRITE.width + px) * 4 + 3] > 40) return true;
    }
    return false;
  }

  faceCenter() {
    this.facing = this.pos.x > this.view.w / 2 ? 1 : -1;
  }

  towardCenter() {
    return this.pos.x > this.view.w / 2 ? -1 : 1;
  }

  faceToward(x) {
    this.facing = x < this.pos.x ? 1 : -1;
  }

  get floor() {
    return this.view.h - 6;
  }

  spot(name) {
    const { w } = this.view;
    const s = this.scale;
    const side = 150 * s + 30;
    switch (name) {
      case 'post':
        return { x: w - side - 30, y: this.floor };
      case 'stage':
        return { x: w * 0.5 + rand(-w * 0.12, w * 0.12), y: this.floor };
      case 'chip':
        return { x: side + 30, y: this.floor };
      default: {
        const y = Math.random() < 0.65 ? this.floor : rand(SPRITE.height * s + 200, this.floor);
        let x = rand(side, w - side);
        if (Math.abs(x - this.pos.x) < w * 0.2) x = clamp(w - x, side, w - side);
        return { x, y };
      }
    }
  }

  setWindows(data) {
    this.windows = data;
    if (this.stance !== 'sit' || this.busy || this.dragging) return;
    const win = data.wins.find((w) => w.id === this.perch.id);
    const dx = win ? clamp(this.perch.dx, 50, win.w - 60) : 0;
    if (!win || !this.canSit(win) || this.covered(win, win.x + dx)) {
      this.fall();
      return;
    }
    const to = this.seat(win, dx);
    if (to.x !== this.pos.x || to.y !== this.pos.y) {
      this.pos = to;
      this.place();
    }
  }

  seat(win, dx) {
    return { x: win.x + dx, y: win.y + 3 + (SPRITE.feet.y - SPRITE.hip) * this.scale };
  }

  canSit(win) {
    const roomAbove = SPRITE.hip * this.scale + 12;
    return !win.max && win.w > 260 && win.y > roomAbove && win.y < this.view.h - 80;
  }

  covered(win, x) {
    const half = 34 * this.scale;
    const { wins } = this.windows;
    for (const o of wins) {
      if (o === win || o.id === win.id) return false;
      if (o.x < x + half && o.x + o.w > x - half && o.y <= win.y && o.y + o.h >= win.y) return true;
    }
    return false;
  }

  pickSeat({ frontOnly = false, except = null } = {}) {
    const options = [];
    for (const win of this.windows.wins) {
      if (win.id === except || !this.canSit(win)) continue;
      const dx = clamp(rand(win.w * 0.18, win.w * 0.6), 60, Math.max(60, win.w - 190));
      if (this.covered(win, win.x + dx)) continue;
      options.push({ win, dx });
    }
    const front = options.find((o) => o.win.id === this.windows.fg);
    if (frontOnly) return front || null;
    return front || options[0] || null;
  }

  interval() {
    if (this.busy || this.stance === 'fall' || this.act?.player.act.fps === 24) return ON_ONES;
    return this.mode === 'sleep' ? ASLEEP : ON_TWOS;
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    if (this.hidden) return;
    if (now - this.lastDraw < this.interval() * power.slow - 1) return;
    this.drawFrame(now);
    this.behave(now);
  }

  drawFrame(now = performance.now()) {
    this.lastDraw = now;
    this.animate(now);
    this.sprite.draw(this.p);
    this.place();
  }

  animate(now) {
    const p = this.p;
    p.seed = Math.random() * 100;

    const under = this.base.sample(now);
    const base = under ? this.base.resolve(under.pose, this.facing) : {};
    let act = null;
    let cue = null;
    if (under && under.index !== this.baseIndex) {
      this.baseIndex = under.index;
      if (!this.act) cue = under.cue;
    }
    if (this.act) {
      const drawing = this.act.player.sample(now);
      if (drawing) {
        act = this.act.player.resolve(drawing.pose, this.facing);
        if (drawing.index !== this.act.index) {
          this.act.index = drawing.index;
          cue = drawing.cue;
        }
      } else {
        this.endAct(true);
      }
    }
    const pose = { ...NEUTRAL, ...base, ...act };
    if (this.mode === 'sleep' && this.stance === 'sit' && !act) {
      Object.assign(pose, { head: 0.12, mane: -0.1, kickL: 0.03, kickR: 0.03, armL: -0.45, armR: -0.45 });
    }

    p.head = pose.head;
    p.mane = pose.mane;
    p.hair = pose.hair;
    p.armL = pose.armL;
    p.armR = pose.armR;
    p.longL = pose.longL;
    p.longR = pose.longR;
    p.kickL = pose.kickL;
    p.kickR = pose.kickR;
    p.smear = pose.smear;
    p.echo = pose.echo;
    const bob = this.stance === 'sit' ? clamp(pose.bob, -3, 2) : pose.bob;
    this.bob = this.dragging ? 0 : bob;
    this.tilt = this.dragging ? 0 : pose.tilt;
    this.sx = pose.sx;
    this.sy = pose.sy;
    if (this.debug) Object.assign(p, this.debug);
    if (cue) this.onCue(cue);
  }

  behave(now) {
    if (this.stance === 'fall') {
      this.updateFall(now);
      return;
    }
    if (this.busy || this.dragging) return;

    if (now > this.nextTwitch) {
      this.nextTwitch = now + rand(5000, 13000);
      if (!reducedMotion.matches && this.mode !== 'sleep') this.twitch();
    }

    if (now > this.nextShed) {
      this.nextShed = now + rand(4000, 11000) * (this.mode === 'sleep' ? 2.5 : 1);
      if (!reducedMotion.matches && this.stance !== 'peek') this.shed();
    }

    if (this.mode === 'idle' && this.stance !== 'peek' && now > this.nextGaze) {
      this.nextGaze = now + rand(90000, 180000);
      this.gaze();
    }

    if (this.mode === 'idle' && now - this.lastActivity > SLEEP_AFTER) this.setMode('sleep');
    if (this.mode === 'sleep' && now - this.sleptAt > DOZE_AFTER) {
      this.doze();
      return;
    }

    if (this.stance === 'peek' && now > this.peekUntil) {
      this.unpeek();
      return;
    }

    if (this.mode === 'idle' && now > this.nextMove) {
      this.nextMove = now + rand(25000, 70000);
      this.wanderStep();
    }

    if (this.mode === 'work' && now - this.lastGlyph > 420) {
      this.lastGlyph = now;
      const h = this.head();
      this.fx.glyph(h.x, h.y - 30);
    }
  }

  wanderStep() {
    if (!this.wander || this.stance === 'peek') {
      if (this.stance !== 'peek') this.flourish();
      return;
    }
    if (this.stance === 'sit') {
      const r = Math.random();
      if (r < 0.3) this.flourish();
      else if (r < 0.5 && this.canPossess()) this.possess();
      else if (r < 0.75) this.fall();
      else this.teleport(this.spot('random'));
      return;
    }
    const seat = this.pickSeat();
    const r = Math.random();
    if (seat && r < 0.35) this.sitOn(seat);
    else if (r < 0.6) this.peek();
    else if (r < 0.85) this.teleport(this.spot('random'));
    else this.flourish();
  }

  flourish() {
    if (this.stance === 'sit') this.perform(pick(['look', 'look', 'split']));
    else this.perform(pick(['spin', 'look', 'hop', 'curious', 'split']), this.towardCenter());
  }

  perform(name, dir = 0, { reach = 1 } = {}) {
    if (this.stowed || this.dormant) return Promise.resolve();
    const act = ACTS[name];
    if (reducedMotion.matches && act.fps === 24) {
      if (act.flip) this.facing *= -1;
      return Promise.resolve();
    }
    const next = new Player(name, { dir, reach });
    if (this.act && this.act.player.priority > next.priority) return Promise.resolve();
    this.endAct(false);
    return new Promise((done) => {
      this.act = { player: next, done };
    });
  }

  endAct(completed) {
    const current = this.act;
    if (!current) return;
    this.act = null;
    if (completed && current.player.act.flip) this.facing *= -1;
    current.done();
  }

  setStance(stance, { perch = null, peekSide = null, dir = 0 } = {}) {
    this.stance = stance;
    this.perch = perch;
    this.peekSide = peekSide;
    this.p.sit = stance === 'sit' ? 1 : 0;
    this.base = this.restBase(dir);
    this.pivot();
  }

  restBase(dir = 0) {
    const pt = this.pointing;
    if (pt && (this.stance === 'stand' || this.stance === 'sit')) return new Player('pointing', { dir: pt.dir, reach: pt.reach });
    return new Player(this.baseAct(), { dir });
  }

  baseAct() {
    if (this.stance === 'sit') return 'sit';
    if (this.stance === 'peek') return 'peek';
    if (this.stance === 'fall') return 'fall';
    return this.mode === 'sleep' ? 'sleep' : 'stand';
  }

  setMode(mode) {
    const now = performance.now();
    if (mode !== 'sleep') this.lastActivity = now;
    this.nextMove = Math.max(this.nextMove, now + rand(55000, 120000));
    this.nextGaze = Math.max(this.nextGaze, now + rand(30000, 70000));
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;
    if (mode === 'sleep') this.sleptAt = now;
    this.onMode?.(mode, prev);
    if (this.stance === 'stand') this.base = this.restBase();
    const p = this.p;
    if (mode === 'sleep') tween(p, { alpha: 0.55, sparkle: 0.35, boil: 0.4 }, 900, ease.inOut);
    else tween(p, { alpha: 1, sparkle: 1, boil: 0.9 }, 250, ease.out);
  }

  wake() {
    if (this.mode === 'sleep') this.setMode('idle');
    this.lastActivity = performance.now();
    if (this.dormant) this.rouse();
  }

  goToWork() {
    this.setMode('work');
    const seat = this.pickSeat({ frontOnly: true });
    if (seat) {
      if (this.stance === 'sit' && this.perch?.id === seat.win.id) return;
      this.sitOn(seat);
      return;
    }
    const post = this.spot('post');
    if (this.stance !== 'stand' || Math.hypot(post.x - this.pos.x, post.y - this.pos.y) > 320) this.teleport(post);
  }

  attend() {
    this.wake();
    if (this.stance === 'peek' && !this.busy) this.teleport(this.spot('post'));
  }

  twitch() {
    const p = this.p;
    p.glitchSeed = Math.random() * 100;
    p.glitch = rand(0.15, 0.3);
    p.split = 2;
    setTimeout(() => {
      p.glitch = 0;
      p.split = 0;
    }, ON_TWOS * 2);
  }

  pulse() {
    if (this.busy || reducedMotion.matches) return;
    const p = this.p;
    p.glitchSeed = Math.random() * 100;
    p.glitch = 0.12;
    setTimeout(() => { p.glitch = 0; }, ON_TWOS);
  }

  shed() {
    const s = this.scale;
    const h = this.head();
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
    const r = rand(70, 100) * s;
    this.fx.drift(h.x + Math.cos(a) * r, h.y - 40 * s + Math.sin(a) * r * 0.85, a);
  }

  toScreen(sx, sy) {
    const s = this.scale;
    return {
      x: this.pos.x + (sx - SPRITE.feet.x) * s * this.facing,
      y: this.pos.y - (SPRITE.feet.y - sy) * s + this.bob,
    };
  }

  armToward(dir) {
    return dir * this.facing < 0 ? 'L' : 'R';
  }

  limb(side) {
    const { shoulder, hand, mirror } = SPRITE;
    const a = side === 'L' ? this.p.armL : this.p.armR;
    const k = side === 'L' ? this.p.longL : this.p.longR;
    const vx = (hand.x - shoulder.x) * k, vy = (hand.y - shoulder.y) * k;
    let hx = shoulder.x + Math.cos(a) * vx - Math.sin(a) * vy;
    const hy = shoulder.y + Math.sin(a) * vx + Math.cos(a) * vy;
    let sx = shoulder.x;
    if (side === 'R') {
      hx = mirror - hx;
      sx = mirror - sx;
    }
    return { shoulder: this.toScreen(sx, shoulder.y), hand: this.toScreen(hx, hy) };
  }

  gaze({ big } = {}) {
    if (this.busy || this.hidden || this.act || this.stance === 'peek' || this.stance === 'fall') return false;
    big ??= this.uplinkDue || this.lastUplinkDay() !== today();
    if (reducedMotion.matches) big = false;
    if (big) {
      this.uplinkDue = false;
      try {
        localStorage.setItem(UPLINK_DAY, today());
      } catch {
      }
    }
    const dir = this.towardCenter();
    const { w } = this.view;
    const side = this.armToward(dir);
    const { shoulder } = this.limb(side);
    const y = clamp(shoulder.y - rand(280, 400), 50, shoulder.y - 180);
    const x = clamp(shoulder.x + dir * rand(380, 520), 40, w - 40);
    const to = { x: clamp(x + dir * rand(170, 260), 30, w - 30), y: y - rand(10, 40) };
    const sat = this.fx.satellite({ x, y }, to, { duration: 9500 });
    const reach = () => {
      const at = sat.pos();
      const sh = this.limb(side).shoulder;
      return clamp(Math.atan2(sh.y - at.y, Math.abs(at.x - sh.x)) + 0.52, 0.5, 1.6);
    };
    const road = () => [this.limb(side).hand, sat.pos()];
    this.sky = { sat, road, dir, side, motes: null, surge: null, head: null };
    if (!big) this.onGaze?.('start');
    this.perform(big ? 'uplink' : 'gaze', dir, { reach }).then(() => {
      this.clearSky();
      if (big) this.onGaze?.('end');
    });
    return true;
  }

  lastUplinkDay() {
    try {
      return localStorage.getItem(UPLINK_DAY);
    } catch {
      return null;
    }
  }

  earnUplink() {
    this.uplinkDue = true;
    this.nextGaze = performance.now() + rand(25000, 40000);
  }

  clearSky() {
    if (!this.sky) return;
    const { sat, motes, surge } = this.sky;
    surge?.break();
    motes?.home(...this.moved());
    sat.fade();
    this.sky = null;
    tween(this.p, { sparkle: this.mode === 'sleep' ? 0.35 : 1 }, 400, ease.out);
  }

  moved() {
    const was = this.sky?.head;
    if (!was) return [0, 0];
    const h = this.head();
    return [h.x - was.x, h.y - was.y];
  }

  manePoints(n) {
    const s = this.scale;
    const h = this.head();
    return Array.from({ length: n }, () => {
      const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random());
      return { x: h.x + Math.cos(a) * r * 92 * s, y: h.y - 44 * s + Math.sin(a) * r * 66 * s };
    });
  }

  spark() {
    if (this.busy || this.hidden || reducedMotion.matches || this.stance === 'peek' || this.stance === 'fall') return;
    const s = this.scale;
    const side = Math.random() < 0.5 ? 'L' : 'R';
    const { hand } = this.limb(side);
    const out = (side === 'L' ? -1 : 1) * this.facing;
    if (this.stance === 'sit') {
      const ledge = this.pos.y - (SPRITE.feet.y - SPRITE.hip) * s - 3;
      const at = { x: hand.x + out * rand(10, 40) * s, y: ledge };
      const run = { x: at.x + out * rand(90, 200), y: ledge + rand(-2, 2) };
      this.fx.bolt(hand, at, { life: 200, forks: 1, width: 2 });
      this.fx.bolt(at, run, { life: 260, forks: 2, width: 2 });
    } else {
      for (let i = 0; i < 2; i++) {
        const to = { x: hand.x + out * rand(30, 80) * s, y: hand.y + rand(-50, 30) * s };
        this.fx.bolt(hand, to, { life: rand(140, 220), forks: 1, width: 2 });
      }
    }
    this.voice.play('bolt', { soft: true });
  }

  zap(x, y) {
    if (this.busy || this.hidden || this.act || reducedMotion.matches || this.stance !== 'stand') return false;
    const dir = x < this.pos.x ? -1 : 1;
    const side = this.armToward(dir);
    const reach = () => {
      const sh = this.limb(side).shoulder;
      return clamp(Math.atan2(sh.y - y, Math.abs(x - sh.x)) + 0.52, -0.3, 1.6);
    };
    this.zapAt = { x, y, side, dir };
    this.perform('zap', dir, { reach });
    return true;
  }

  cutinAt(dir, { flip = true } = {}) {
    const s = this.scale;
    const h = this.head();
    const gap = 85 * s + 24, width = 274;
    const fits = (d) => (d > 0 ? h.x + gap + width < this.view.w - 8 : h.x - gap - width > 8);
    if (fits(dir)) return [h.x + dir * gap, h.y - 18, dir];
    if (flip && fits(-dir)) return [h.x - dir * gap, h.y - 18, -dir];
    return [clamp(h.x - width / 2, 8, this.view.w - width - 8), Math.max(56, h.top - 58), 1];
  }

  async flash(colors) {
    const p = this.p;
    for (const color of colors) {
      p.sil = color;
      p.silAmount = 1;
      this.drawFrame();
      await sleep(ON_ONES);
    }
    p.silAmount = 0;
  }

  onCue(cue) {
    const s = this.scale;
    const h = this.head();
    const mane = { x: h.x, y: h.y - 40 * s };
    switch (cue) {
      case 'gather':
        this.fx.burst(mane.x, mane.y, { count: 18, inward: true, power: 0.7, spread: 170 * s });
        break;
      case 'launch':
        this.voice.play('rise');
        this.fx.slices(h.x - 70 * s, h.y - 40 * s, 170 * s, 300 * s, { count: 5 });
        break;
      case 'peak':
        this.voice.play('done');
        this.fx.lines(mane.x, mane.y, { inner: 150 * s + 30 });
        this.fx.ring(mane.x, mane.y);
        this.fx.burst(mane.x, mane.y, { count: 34, power: 1.2, spread: 140 * s });
        setTimeout(() => this.flash([GREEN, INK, GREEN]), 0);
        break;
      case 'speak':
        this.fireSpeak();
        break;
      case 'laugh':
        this.fx.cutin(...this.cutinAt(this.act?.player.dir || this.towardCenter()), { kind: pick(['laugh', 'grin']) });
        break;
      case 'stare':
        this.fx.cutin(...this.cutinAt(this.act?.player.dir || this.towardCenter()), { kind: 'many', life: 640 });
        break;
      case 'notice':
        this.twitch();
        break;
      case 'zap':
        if (this.zapAt) {
          const { x, y, side } = this.zapAt;
          this.fx.bolt(this.limb(side).hand, { x, y }, { life: 240, forks: 2, width: 3 });
          this.fx.burst(x, y, { count: 8, power: 0.35, spread: 16 });
          this.fx.ring(x, y, { size: 0.22 });
          this.voice.play('bolt');
        }
        break;
      case 'grin':
        if (this.zapAt && Math.random() < 0.6) this.fx.cutin(...this.cutinAt(-this.zapAt.dir), { kind: 'look', life: 560 });
        this.zapAt = null;
        break;
      case 'spot':
        if (this.pointing) {
          const { aim } = this.pointing;
          this.fx.ring(aim.x, aim.y, { size: 0.18 });
          this.voice.play('tick');
        }
        break;
      case 'coil':
        this.fx.burst(h.x, h.y + 40 * s, { count: 10, inward: true, power: 0.45, spread: 90 * s });
        this.voice.play('bolt', { soft: true });
        break;
      case 'lock': {
        const pt = this.pointing;
        if (pt && !pt.pointer) {
          const hand = this.limb(pt.side).hand;
          pt.pointer = this.fx.pointer(() => this.limb(pt.side).hand, pt.rect, pt.aim, { label: pt.label });
          if (!reducedMotion.matches) {
            this.fx.bolt(hand, pt.aim, { life: 260, forks: 3, width: 3 });
            this.fx.ring(pt.aim.x, pt.aim.y, { size: 0.55 });
            this.fx.burst(pt.aim.x, pt.aim.y, { count: 12, power: 0.5, spread: 20 });
            this.fx.cutin(...this.cutinAt(-pt.dir, { flip: false }), { kind: 'eyes', life: 480 });
          }
          this.voice.play('bolt');
        }
        break;
      }
      case 'tap':
        this.pointing?.pointer?.tap();
        break;
      case 'minds':
        this.twitch();
        break;
      case 'snap':
        this.twitch();
        this.voice.play('tick');
        break;
      default:
        if (this.sky) this.skyCue(cue);
        break;
    }
  }

  skyCue(cue) {
    const s = this.scale;
    const sky = this.sky;
    const hand = () => this.limb(sky.side).hand;
    switch (cue) {
      case 'glint':
        this.voice.play('star');
        break;
      case 'starlight':
        tween(this.p, { sparkle: 1.8 }, 500, ease.out);
        break;
      case 'stars':
        sky.head = this.head();
        sky.motes = this.fx.motes(this.manePoints(30), { lift: 230 * s + 60, spread: 320 * s + 80 });
        tween(this.p, { sparkle: 0.15 }, 500, ease.out);
        break;
      case 'align':
        sky.motes?.align(sky.road);
        this.voice.play('tick');
        break;
      case 'charge': {
        this.fx.crackle(hand, { life: 640, radius: 70 * s + 14, count: 3 });
        const at = hand();
        this.fx.burst(at.x, at.y, { count: 14, inward: true, power: 0.5, spread: 90 * s });
        this.fx.cutin(...this.cutinAt(-sky.dir, { flip: false }), { kind: 'eyes', life: 600 });
        this.voice.play('charge');
        break;
      }
      case 'surge': {
        const at = hand();
        sky.surge = this.fx.surge(sky.road, {
          onHit: () => {
            const top = sky.sat.pos();
            sky.sat.twinkle(1.25);
            this.fx.ring(top.x, top.y, { size: 0.55 });
            this.fx.lines(top.x, top.y, { inner: 60, life: 460 });
            this.voice.play('star');
          },
        });
        sky.motes?.light(125);
        this.fx.ring(at.x, at.y, { size: 0.6 });
        this.flash([INK, RED]);
        this.voice.play('bolt');
        this.voice.play('rise');
        break;
      }
      case 'break':
        sky.surge?.break();
        sky.surge = null;
        sky.motes?.dim();
        this.voice.play('tick');
        break;
      case 'twinkle': {
        const at = sky.sat.pos();
        sky.sat.twinkle(1);
        this.fx.ring(at.x, at.y, { size: 0.4 });
        this.voice.play('star');
        break;
      }
      case 'glimmer':
        sky.sat.twinkle(0.55);
        if (!sky.motes) this.voice.play('star');
        break;
      case 'home':
        sky.motes?.home(...this.moved());
        sky.motes = null;
        tween(this.p, { sparkle: 1.7 }, 400, ease.out).then(() => tween(this.p, { sparkle: 1 }, 700, ease.inOut));
        break;
    }
  }

  fireSpeak() {
    const fn = this.onSpeak;
    this.onSpeak = null;
    fn?.();
  }

  async hurt() {
    this.perform('flinch');
    if (reducedMotion.matches) return;
    const p = this.p;
    p.sil = RED;
    p.silAmount = 1;
    this.drawFrame();
    await sleep(ON_TWOS);
    p.silAmount = 0;
    p.glitchSeed = Math.random() * 100;
    p.glitch = 0.7;
    p.split = 7;
    await tween(p, { glitch: 0, split: 0 }, 450, ease.out);
  }

  async celebrate({ onSpeak } = {}) {
    this.onSpeak = onSpeak;
    if (reducedMotion.matches || this.stowed || this.dormant) {
      this.voice.play('done');
      this.fireSpeak();
      return;
    }
    await this.perform('victory', this.towardCenter());
    this.fireSpeak();
  }

  async vanish({ beam = true } = {}) {
    const p = this.p;
    const s = this.scale;
    const from = { ...this.pos };
    const head = this.head();
    if (this.sky) this.endAct(false);
    this.stopPointing();
    if (reducedMotion.matches) {
      await tween(p, { alpha: 0 }, 160, ease.linear);
      return head;
    }
    this.voice.play('teleport-out');
    p.glitchSeed = Math.random() * 100;
    await tween(p, { glitch: 0.35, split: 3 }, 90, ease.linear);
    this.fx.burst(head.x, head.y + 70 * s, { count: 22, spread: 150 * s });
    this.fx.slices(head.x - 70 * s, head.y - 40 * s, 170 * s, 320 * s);
    await tween(p, { collapse: 1, glitch: 1, dissolve: 0.5, split: 9 }, 170, ease.in);
    p.alpha = 0;
    const ground = from.y - (this.p.sit ? (SPRITE.feet.y - SPRITE.hip) * s : 0);
    if (!this.upside) {
      this.fx.slit(from.x - 10 * s * this.facing, head.top, ground, { width: 56 * s + 10 });
      if (beam) this.fx.beam(from.x, ground, { width: 40 * s + 8 });
    }
    return head;
  }

  async arrive(to, { face = null, stance = 'stand', perch = null, peekSide = null, dir = 0, fromHead = null, beam = true } = {}) {
    const p = this.p;
    const s = this.scale;
    const facing = face ?? (to.x > this.view.w / 2 ? 1 : -1);
    const toHead = this.head(to, facing);
    if (fromHead && !reducedMotion.matches) {
      this.fx.streak(fromHead.x, fromHead.y, toHead.x, toHead.y);
      await sleep(60);
    }
    this.pos = { ...to };
    this.facing = facing;
    this.setStance(stance, { perch, peekSide, dir });
    this.place();

    if (reducedMotion.matches) {
      p.collapse = 0;
      p.dissolve = 0;
      await tween(p, { alpha: this.mode === 'sleep' ? 0.55 : 1 }, 160, ease.linear);
      return;
    }
    const ground = stance === 'sit' ? to.y - (SPRITE.feet.y - SPRITE.hip) * s : to.y;
    if (beam) this.fx.beam(to.x, ground, { down: true, width: 40 * s + 8 });
    this.fx.vortex(toHead.x, toHead.y + 30 * s, { radius: 170 * s + 40 });
    this.voice.play('teleport-in');
    await sleep(50);

    p.alpha = this.mode === 'sleep' ? 0.55 : 1;
    p.glitchSeed = Math.random() * 100;
    await tween(p, { collapse: 0, dissolve: 0, glitch: 0.6, split: 6 }, 200, ease.out);

    p.sil = GREEN;
    p.silAmount = 1;
    this.drawFrame();
    await sleep(ON_ONES);
    p.sil = INK;
    this.drawFrame();
    await sleep(ON_ONES);
    p.silAmount = 0;
    this.fx.burst(toHead.x, toHead.y + 60 * s, { count: 10, power: 0.55, spread: 110 * s });
    if (stance === 'sit') this.perform('plop');
    await tween(p, { glitch: 0, split: 0 }, 220, ease.out);
  }

  async teleport(to, opts = {}) {
    if (this.stowed) return;
    if (this.busy || this.dormant) {
      this.pending = { to, opts };
      if (this.dormant) this.rouse();
      return;
    }
    this.busy = true;
    this.wake();
    this.onTeleport?.('start');
    const fromHead = await this.vanish();
    await sleep(70);
    await this.arrive(to, { ...opts, fromHead });
    await this.settle();
  }

  async settle() {
    this.busy = false;
    this.nextMove = Math.max(this.nextMove, performance.now() + rand(25000, 60000));
    this.onTeleport?.('end');
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      await this.teleport(next.to, next.opts);
    }
  }

  async stow() {
    if (this.stowed || this.stowing) return;
    this.stowing = true;
    for (let i = 0; this.busy && i < 30; i++) await sleep(100);
    this.busy = true;
    this.endAct(false);
    this.onTeleport?.('start');
    let from = null;
    if (this.dormant) {
      from = this.head();
      this.dormant = false;
      this.onDoze?.('end');
    }
    if (reducedMotion.matches) {
      await tween(this.p, { alpha: 0 }, 160, ease.linear);
    } else {
      if (!from) {
        await this.perform('fold');
        from = await this.vanish({ beam: false });
      }
      const chip = this.chipAt();
      this.fx.streak(from.x, from.y, chip.x, chip.y);
      await sleep(60);
      this.fx.burst(chip.x, chip.y, { count: 12, inward: true, power: 0.45, spread: 40 });
      this.fx.ring(chip.x, chip.y, { size: 0.3 });
      this.voice.play('land');
    }
    this.setStance('stand');
    this.stowed = true;
    this.stowing = false;
    this.hidden = true;
    this.root.hidden = true;
    this.onStow?.();
    this.busy = false;
    if (this.unstowAfter) this.unstow();
  }

  stowNow() {
    this.stowed = true;
    this.hidden = true;
    this.root.hidden = true;
    this.p.alpha = 0;
    this.onTeleport?.('start');
    this.onStow?.();
  }

  async doze() {
    if (this.busy || this.dormant || this.stowed || this.hidden) return;
    this.busy = true;
    this.endAct(false);
    this.onTeleport?.('start');
    this.dozedOn = this.stance === 'sit' ? { ...this.perch } : null;
    const s = this.scale;
    const h = this.head();
    if (!reducedMotion.matches) {
      for (let i = 0; i < 10; i++) this.shed();
      this.fx.burst(h.x, h.y + 60 * s, { count: 10, power: 0.3, spread: 120 * s });
      this.p.glitchSeed = Math.random() * 100;
      await tween(this.p, { dissolve: 0.9, glitch: 0.25, sparkle: 0 }, 700, ease.in);
    }
    this.setStance('stand');
    Object.assign(this.p, { alpha: 0, dissolve: 0, glitch: 0 });
    this.hidden = true;
    this.root.hidden = true;
    this.dormant = true;
    this.onDoze?.('start', h);
    this.busy = false;
  }

  async rouse() {
    if (!this.dormant) return;
    this.dormant = false;
    this.busy = true;
    this.onDoze?.('waking');
    if (this.mode === 'sleep') this.setMode('idle');
    this.lastActivity = performance.now();
    await sleep(reducedMotion.matches ? 0 : 280);
    this.onDoze?.('end');
    this.hidden = false;
    this.root.hidden = false;
    Object.assign(this.p, { alpha: 0, collapse: 0.6, dissolve: 0.5, glitch: 0, split: 0, sparkle: 1 });
    const win = this.dozedOn && this.windows.wins.find((w) => w.id === this.dozedOn.id);
    if (win && this.canSit(win) && !this.covered(win, win.x + this.dozedOn.dx)) {
      await this.arrive(this.seat(win, this.dozedOn.dx), { face: this.facing, stance: 'sit', perch: this.dozedOn, beam: false });
    } else {
      await this.arrive({ x: this.pos.x, y: this.dozedOn ? this.floor : this.pos.y }, { face: this.facing, beam: false });
    }
    this.dozedOn = null;
    await this.settle();
  }

  async unstow() {
    this.unstowAfter = this.stowing;
    if (!this.stowed) return;
    this.stowed = false;
    this.busy = true;
    this.onUnstow?.();
    this.hidden = false;
    this.root.hidden = false;
    if (this.mode === 'sleep') this.setMode('idle');
    this.lastActivity = performance.now();
    Object.assign(this.p, { alpha: 0, collapse: 1, dissolve: 0.5, glitch: 0, split: 0 });
    const chip = this.chipAt();
    const to = this.spot('chip');
    const face = to.x > this.view.w / 2 ? 1 : -1;
    if (!reducedMotion.matches) {
      const toHead = this.head(to, face);
      this.fx.burst(chip.x, chip.y, { count: 10, power: 0.5, spread: 30 });
      this.fx.streak(chip.x, chip.y, toHead.x, toHead.y);
      await sleep(60);
    }
    await this.arrive(to, { face, beam: false });
    await this.settle();
  }

  sitOn({ win, dx }) {
    return this.teleport(this.seat(win, dx), { stance: 'sit', perch: { id: win.id, dx }, face: this.facing });
  }

  canPossess() {
    return this.possessWindows && !this.busy && !this.hidden && this.stance === 'sit' && !reducedMotion.matches
      && this.windows.wins.some((w) => w.id === this.perch?.id);
  }

  async possess() {
    if (!this.canPossess()) return false;
    const s = this.scale;
    const id = this.perch.id;
    const win = this.windows.wins.find((w) => w.id === id);
    const entry = this.pos.x - win.x;
    this.busy = true;
    this.wake();
    this.onTeleport?.('start');
    await this.perform('dive');
    const head = await this.vanish({ beam: false });
    this.fx.streak(head.x, head.y, this.pos.x, win.y + 40 * s);

    const rect = () => this.windows.wins.find((w) => w.id === id) || null;
    const covers = () => {
      const front = [];
      for (const o of this.windows.wins) {
        if (o.id === id) break;
        front.push(o);
      }
      return front;
    };
    const taken = this.fx.possess(rect, { covers, entry, look: () => this.mouse });
    this.voice.play('bolt');
    await sleep(300);
    this.voice.play('possess');
    await sleep(1600);
    taken.leave();
    await sleep(260);

    const here = rect();
    let seat = this.pickSeat({ except: id });
    if (!seat && here && this.canSit(here)) {
      const dx = clamp(here.w - entry + rand(-60, 60), 60, Math.max(60, here.w - 190));
      if (!this.covered(here, here.x + dx)) seat = { win: here, dx };
    }
    const to = seat ? this.seat(seat.win, seat.dx) : this.spot('random');
    const toHead = this.head(to);
    if (here) {
      this.fx.streak(here.x + here.w / 2, here.y + here.h * 0.46, toHead.x, toHead.y);
      await sleep(60);
    }
    if (seat) this.fx.slit(to.x, toHead.top, seat.win.y, { width: 56 * s + 10 });
    await this.arrive(to, seat ? { stance: 'sit', perch: { id: seat.win.id, dx: seat.dx }, beam: false } : {});
    await this.settle();
    return true;
  }

  async peek(side = pick(['left', 'right', 'top'])) {
    if (this.busy) return;
    const s = this.scale;
    const { w, h } = this.view;
    let at, from, facing, dir;
    if (side === 'left') {
      const y = rand(h * 0.55, this.floor);
      facing = -1;
      dir = 1;
      at = { x: 14 * s, y };
      from = { x: -170 * s, y };
    } else if (side === 'right') {
      const y = rand(h * 0.55, this.floor);
      facing = 1;
      dir = -1;
      at = { x: w - 14 * s, y };
      from = { x: w + 170 * s, y };
    } else {
      const x = rand(w * 0.2, w * 0.8);
      facing = pick([1, -1]);
      dir = x > w / 2 ? -1 : 1;
      at = { x, y: -226 * s };
      from = { x, y: -470 * s };
    }

    this.busy = true;
    this.wake();
    this.onTeleport?.('start');
    if (this.p.alpha > 0) await this.vanish();
    this.pos = { ...from };
    this.facing = facing;
    this.setStance('peek', { peekSide: side, dir });
    this.p.collapse = 0;
    this.p.dissolve = 0;
    this.p.glitch = 0;
    this.p.split = 0;
    this.p.alpha = this.mode === 'sleep' ? 0.55 : 1;
    if (reducedMotion.matches) {
      this.pos = at;
    } else {
      for (const k of [0.45, 0.8, 1]) {
        this.pos = { x: lerp(from.x, at.x, k), y: lerp(from.y, at.y, k) };
        this.drawFrame();
        await sleep(ON_TWOS);
      }
    }
    this.peekFrom = from;
    this.peekUntil = performance.now() + rand(15000, 40000);
    this.busy = false;
    this.onTeleport?.('end');
  }

  async unpeek({ shy = false } = {}) {
    if (this.busy || this.stance !== 'peek') return;
    this.busy = true;
    const at = { ...this.pos };
    const from = this.peekFrom || at;
    if (!reducedMotion.matches) {
      for (const k of [0.4, 0.8, 1]) {
        this.pos = { x: lerp(at.x, from.x, k), y: lerp(at.y, from.y, k) };
        this.drawFrame();
        await sleep(ON_TWOS);
      }
    }
    this.p.alpha = 0;
    this.p.collapse = 1;
    this.p.dissolve = 0.5;
    this.busy = false;
    const side = this.peekSide;
    this.setStance('stand');
    if (shy && Math.random() < 0.6) {
      this.peek(pick(['left', 'right', 'top'].filter((x) => x !== side)));
      return;
    }
    this.busy = true;
    this.onTeleport?.('start');
    const seat = this.wander ? this.pickSeat() : null;
    if (seat && Math.random() < 0.4) {
      await this.arrive(this.seat(seat.win, seat.dx), { stance: 'sit', perch: { id: seat.win.id, dx: seat.dx } });
    } else {
      await this.arrive(this.spot('random'));
    }
    this.busy = false;
    this.onTeleport?.('end');
  }

  landing() {
    const hip = this.pos.y - (SPRITE.feet.y - SPRITE.hip) * this.scale;
    let best = null;
    for (const win of this.windows.wins) {
      if (!this.canSit(win) || win.y < hip - 4) continue;
      if (this.pos.x < win.x + 40 || this.pos.x > win.x + win.w - 40) continue;
      if (this.covered(win, this.pos.x)) continue;
      if (!best || win.y < best.y) best = win;
    }
    if (best) {
      const dx = this.pos.x - best.x;
      return { y: this.seat(best, dx).y, stance: 'sit', perch: { id: best.id, dx } };
    }
    return { y: this.floor, stance: 'stand', perch: null };
  }

  fall() {
    if (this.stance === 'fall') return;
    if (this.sky) this.endAct(false);
    this.landingSpot = this.landing();
    this.setStance('fall');
    this.vy = 0;
    this.lastFall = performance.now();
    if (reducedMotion.matches) this.updateFall(this.lastFall + 10000);
  }

  updateFall(now) {
    const target = this.landingSpot;
    const dt = Math.min(0.05, (now - this.lastFall) / 1000);
    this.lastFall = now;
    this.vy = Math.min(this.vy + GRAVITY * dt, 1900);
    const y = reducedMotion.matches ? target.y : this.pos.y + this.vy * dt;
    if (y < target.y) {
      this.pos.y = y;
      return;
    }
    this.pos.y = target.y;
    this.setStance(target.stance, { perch: target.perch });
    const s = this.scale;
    if (target.stance === 'sit') {
      this.perform('plop');
    } else {
      this.perform('land');
      this.fx.burst(this.pos.x, this.pos.y - 20 * s, { count: 12, power: 0.6, spread: 60 * s });
    }
    this.voice.play('land');
    const p = this.p;
    p.glitchSeed = Math.random() * 100;
    p.glitch = 0.3;
    setTimeout(() => { p.glitch = 0; }, ON_ONES * 3);
  }

  async materialize(at) {
    const p = this.p;
    this.pos = { ...at };
    this.faceCenter();
    this.setStance('stand');
    if (reducedMotion.matches) {
      p.alpha = 0;
      this.place();
      await tween(p, { alpha: 1 }, 300, ease.linear);
      return;
    }
    this.busy = true;
    p.alpha = 0;
    p.collapse = 1;
    p.dissolve = 0.5;
    this.place();
    await sleep(250);
    this.fx.beam(at.x, at.y, { down: true, width: 40 * this.scale + 8, life: 260 });
    this.voice.play('teleport-in');
    await sleep(80);
    p.alpha = 1;
    await tween(p, { collapse: 0, dissolve: 0, glitch: 0.5, split: 5 }, 240, ease.out);
    await tween(p, { glitch: 0, split: 0 }, 260, ease.out);
    this.busy = false;
  }

  async intro(at, { label = 'hi', caption = 'PROJECT CAPRICORN', still = reducedMotion.matches } = {}) {
    const p = this.p;
    this.pos = { ...at };
    this.faceCenter();
    this.setStance('stand');
    this.busy = true;
    this.onTeleport?.('start');
    p.alpha = 0;
    p.collapse = 1;
    p.dissolve = 0.5;
    this.place();
    const head = this.head(at, this.facing);
    await this.fx.intro({
      to: { x: head.x, y: head.y, size: 100 * this.scale },
      label,
      caption,
      still,
      onCue: (cue) => {
        if (cue === 'open') this.voice.play('charge');
        else if (cue === 'hand') this.voice.play('land');
        else if (cue === 'wave') this.voice.play('rise');
        else if (cue === 'grab') {
          this.voice.play('land');
          this.voice.play('bolt');
        } else if (cue === 'hi') this.voice.play('hello');
        else if (cue === 'slip') this.voice.play('teleport-out');
      },
    });
    await this.arrive(at, { face: this.facing, beam: false });
    this.busy = false;
    this.onTeleport?.('end');
  }

  aimPoint(rect) {
    const { w, h } = this.view;
    const sh = this.limb(this.armToward(rect.x + rect.w / 2 < this.pos.x ? -1 : 1)).shoulder;
    const inset = Math.min(24, rect.w / 3, rect.h / 3);
    return {
      x: clamp(clamp(sh.x, rect.x + inset, rect.x + rect.w - inset), 6, w - 6),
      y: clamp(clamp(sh.y, rect.y + inset, rect.y + rect.h - inset), 6, h - 4),
    };
  }

  spotNear(rect) {
    const s = this.scale;
    const { w, h } = this.view;
    const side = 150 * s + 30;
    const reach = 230 * s + 90;
    const roomLeft = rect.x, roomRight = w - (rect.x + rect.w);
    let x;
    if (Math.max(roomLeft, roomRight) >= side + 40) {
      x = roomRight >= roomLeft ? rect.x + rect.w + reach : rect.x - reach;
    } else {
      x = rect.x + rect.w / 2 < w / 2 ? w - side : side;
    }
    x = clamp(x, side, w - side);
    const cy = clamp(rect.y + rect.h / 2, 0, h);
    const shoulderToFeet = (SPRITE.feet.y - SPRITE.shoulder.y) * s;
    const y = cy > h * 0.6 ? this.floor : clamp(cy + shoulderToFeet + 50, SPRITE.height * s + 40, this.floor);
    return { x, y, face: rect.x + rect.w / 2 < x ? 1 : -1 };
  }

  async pointAt(rect, { label = '' } = {}) {
    if (this.stowed) return false;
    this.stopPointing();
    const spot = this.spotNear(rect);
    if (this.stance !== 'stand' || Math.hypot(spot.x - this.pos.x, spot.y - this.pos.y) > 140) {
      await this.teleport({ x: spot.x, y: spot.y }, { face: spot.face });
    }
    if (this.stowed || this.hidden) return false;
    const aim = this.aimPoint(rect);
    const dir = aim.x < this.pos.x ? -1 : 1;
    const side = this.armToward(dir);
    const reach = () => {
      const sh = this.limb(side).shoulder;
      return clamp(Math.atan2(sh.y - aim.y, Math.abs(aim.x - sh.x)) + 0.52, -0.6, 1.7);
    };
    this.pointing = { rect, aim, dir, side, reach, label, pointer: null };
    this.base = this.restBase();
    await this.perform('point', dir, { reach });
    if (this.pointing && !this.pointing.pointer) this.onCue('lock');
    return true;
  }

  stopPointing() {
    const pt = this.pointing;
    if (!pt) return;
    this.pointing = null;
    pt.pointer?.retract();
    this.base = this.restBase();
    if (!this.busy && !this.hidden && this.stance === 'stand') this.perform('unpoint', pt.dir);
  }

  canPoint(win) {
    return Boolean(win && !win.max && win.w > 120 && win.y > -10 && !this.covered(win, win.x + win.w / 2));
  }

  async summon(cursor) {
    const { w, h } = this.view;
    const s = this.scale;
    const side = 150 * s + 30;
    const dx = cursor.x > w / 2 ? -260 : 260;
    const to = {
      x: clamp(cursor.x + dx, side, w - side),
      y: clamp(cursor.y + SPRITE.height * s * 0.45, SPRITE.height * s + 120, h - 6),
    };
    if (this.stance === 'stand' && Math.hypot(to.x - this.pos.x, to.y - this.pos.y) < 160) {
      this.facing = cursor.x < this.pos.x ? 1 : -1;
      return;
    }
    await this.teleport(to, { face: cursor.x < to.x ? 1 : -1 });
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.root.hidden = hidden;
  }

  bindPointer() {
    let down = null;
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.hit(e.clientX, e.clientY)) this.onMenu?.();
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.busy || !this.hit(e.clientX, e.clientY)) return;
      down = { x: e.clientX, y: e.clientY, pos: { ...this.pos } };
    });
    window.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!this.dragging && Math.hypot(dx, dy) > 5 && !this.busy) {
          this.dragging = true;
          if (this.upside) {
            down.pos = { x: down.pos.x, y: down.y + (SPRITE.feet.y - SPRITE.head.y) * this.scale };
          }
          this.endAct(false);
          this.setStance('stand');
          this.p.glitch = 0.18;
          this.p.split = 2;
          this.onTeleport?.('start');
        }
        if (this.dragging) {
          this.pos = {
            x: clamp(down.pos.x + dx, 40, this.view.w - 40),
            y: clamp(down.pos.y + dy, SPRITE.height * this.scale * 0.5, this.floor),
          };
          this.p.glitchSeed = Math.random() * 100;
          this.place();
        }
        return;
      }
      this.notice(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      if (!down) return;
      const wasDragging = this.dragging;
      down = null;
      this.dragging = false;
      if (wasDragging) {
        tween(this.p, { glitch: 0, split: 0 }, 200, ease.out);
        this.onTeleport?.('end');
        this.drop();
      } else {
        this.onClick?.();
      }
    });
  }

  drop() {
    const s = this.scale;
    const hip = this.pos.y - (SPRITE.feet.y - SPRITE.hip) * s;
    for (const win of this.windows.wins) {
      if (!this.canSit(win) || Math.abs(hip - win.y) > 26) continue;
      if (this.pos.x < win.x + 40 || this.pos.x > win.x + win.w - 40 || this.covered(win, this.pos.x)) continue;
      const dx = this.pos.x - win.x;
      this.pos = this.seat(win, dx);
      this.setStance('sit', { perch: { id: win.id, dx } });
      this.perform('plop');
      this.voice.play('land');
      return;
    }
    if (this.pos.y < this.floor - 2) this.fall();
    else this.perform('land');
  }

  notice(x, y) {
    if (this.busy || this.hidden || this.stance === 'fall' || this.sky) return;
    const h = this.head();
    if (Math.hypot(x - h.x, y - h.y) > 230) return;
    const now = performance.now();
    if (this.mode === 'sleep') this.wake();
    if (now < this.nextNotice) return;
    this.nextNotice = now + 15000;
    if (this.stance === 'peek') {
      this.unpeek({ shy: true });
      return;
    }
    const wanted = x < this.pos.x ? 1 : -1;
    if (wanted !== this.facing && this.stance === 'stand') {
      this.perform('turn');
      return;
    }
    if (this.mode !== 'idle') return;
    if (Math.random() < 0.3 && this.zap(x, y)) return;
    this.perform('curious', x < h.x ? -1 : 1);
  }
}
