import { COLORS, drawMask } from './fx.js';
import { rand, reducedMotion, power } from './util.js';

const STEP = 1000 / 12;

class Small {
  constructor(canvas, w, h) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = w;
    this.h = h;
    this.visible = false;
    this.pointer = null;
    this.shownAt = 0;
    this.last = 0;
    this.x = 0;
    this.y = 0;
    this.loop = this.loop.bind(this);
  }

  moveTo(x, y) {
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(this.w * dpr)) {
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
    }
    this.x = x;
    this.y = y;
    this.canvas.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  contains(x, y, pad = 8) {
    return x >= this.x - pad && x <= this.x + this.w + pad && y >= this.y - pad && y <= this.y + this.h + pad;
  }

  show() {
    if (this.visible) return;
    this.visible = true;
    this.canvas.hidden = false;
    this.shownAt = performance.now();
    requestAnimationFrame(this.loop);
  }

  hide() {
    this.visible = false;
    this.canvas.hidden = true;
    this.pointer = null;
  }

  loop(now) {
    if (!this.visible) return;
    requestAnimationFrame(this.loop);
    if (now - this.last < STEP * power.slow - 1) return;
    this.last = now;
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.draw(now, Math.floor(now / STEP));
  }

  get landing() {
    return performance.now() - this.shownAt < STEP * 1.5 && !reducedMotion.matches;
  }
}

export class Mask extends Small {
  constructor(canvas) {
    super(canvas, 140, 170);
    this.k = 0.66;
    this.wokeAt = 0;
    this.nextPeek = 0;
    this.peek = null;
  }

  place(x, y, k) {
    this.k = k;
    this.cx = 70;
    this.cy = 110;
    this.moveTo(x - this.cx, y - this.cy);
  }

  show() {
    this.wokeAt = 0;
    this.nextPeek = performance.now() + rand(5000, 9000);
    super.show();
  }

  wake() {
    this.wokeAt = performance.now();
  }

  draw(now, frame) {
    const { ctx } = this;
    const calm = reducedMotion.matches;
    const bob = calm ? 0 : [0, -1.5, -3, -1.5][Math.floor(frame / 6) % 4];
    if (this.landing) {
      drawMask(ctx, this.cx, this.cy, this.k, { flat: COLORS.paper });
      return;
    }
    let eyes = [0, 0], look = null;
    if (now > this.nextPeek && !this.peek) {
      this.peek = { eye: Math.random() < 0.5 ? 0 : 1, until: now + rand(700, 1100) };
      this.nextPeek = now + rand(7000, 14000);
    }
    if (this.peek) {
      if (now > this.peek.until) this.peek = null;
      else eyes[this.peek.eye] = 0.45;
    }
    if (this.pointer) {
      eyes = [0.35, 0.35];
      look = { x: this.pointer.x - this.x, y: this.pointer.y - this.y };
    }
    if (this.wokeAt) {
      eyes = [1, 1];
      look = null;
    }
    const shake = this.wokeAt && !calm ? rand(-2, 2) : 0;
    drawMask(ctx, this.cx + shake, this.cy + bob, this.k, { eyes, look });
  }
}

const MARGIN = { left: 26, bottom: 22 };
const K = 0.6;

export class Chip extends Mask {
  constructor(canvas) {
    super(canvas);
    this.mode = 'idle';
  }

  place(w, h) {
    super.place(MARGIN.left + 50 * K, h - MARGIN.bottom - 54 * K, K);
    this.face = { x: MARGIN.left + 50 * K, y: h - MARGIN.bottom - 54 * K };
  }

  center() {
    return { ...this.face };
  }

  contains(x, y, pad = 8) {
    const { x: fx, y: fy } = this.face;
    return x >= fx - 50 * K - pad && x <= fx + 50 * K + pad && y >= fy - 100 * K - pad && y <= fy + 54 * K + pad;
  }

  setMode(mode) {
    this.mode = mode;
  }

  draw(now, frame) {
    const { ctx } = this;
    const calm = reducedMotion.matches;
    if (this.landing) {
      drawMask(ctx, this.cx, this.cy, this.k, { flat: COLORS.paper });
      return;
    }
    const bob = calm ? 0 : [0, -1.5, -3, -1.5][Math.floor(frame / 6) % 4];
    const eyes = this.mode === 'alert' && (calm || frame % 8 < 6) ? [1, 1] : [0, 0];
    const shake = this.pointer && !calm ? rand(-1, 1) : 0;
    drawMask(ctx, this.cx + shake, this.cy + bob, this.k, { eyes });
  }
}
