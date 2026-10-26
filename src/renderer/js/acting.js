export const SHEET_FPS = 12;

const rep = (n, keys) => Array.from({ length: n }, () => keys).flat();

export const NEUTRAL = {
  head: 0, mane: 0, hair: 0, tilt: 0, bob: 0, sx: 1, sy: 1, armL: 0, armR: 0, longL: 1, longR: 1,
  smear: [0, 0], echo: [0, 0], kickL: 0, kickR: 0,
};

export const ACTS = {

  stand: {
    loop: true,
    keys: [
      [6, { bob: 0, hair: -2.5, arms: 0.04 }],
      [4, { bob: -2, hair: 0, arms: 0 }],
      [6, { bob: -4, hair: 2.5, arms: -0.05 }],
      [4, { bob: -2, hair: 0, arms: 0 }],
    ],
  },

  sit: {
    loop: true,
    keys: [
      [5, { kickL: 0.24, kickR: -0.03, hair: -1.5, arms: -0.42 }],
      [2, { kickL: 0.08, kickR: 0.08, arms: -0.42 }],
      [5, { kickL: -0.03, kickR: 0.24, hair: 1.5, arms: -0.42 }],
      [2, { kickL: 0.08, kickR: 0.08, arms: -0.42 }],
      [5, { kickL: 0.24, kickR: -0.03, hair: -1.5, arms: -0.42 }],
      [2, { kickL: 0.08, kickR: 0.08, arms: -0.42 }],
      [5, { kickL: -0.03, kickR: 0.24, hair: 1.5, arms: -0.42 }],
      [10, { kickL: 0.04, kickR: 0.04, head: 0.08, arms: -0.4 }],
    ],
  },

  peek: {
    loop: true,
    directional: true,
    keys: [
      [18, { tilt: 7, head: 0.14, reach: 0.1 }],
      [1, { tilt: 7, head: 0.2, smear: [-6, 0], reach: 0.16 }],
      [14, { tilt: 7.5, head: 0.24, mane: 0.08, reach: 0.18 }],
      [1, { tilt: 6, head: 0.14, reach: 0.12 }],
      [12, { tilt: 6.5, head: 0.12, bob: -2, reach: 0.1 }],
    ],
  },

  sleep: {
    loop: true,
    keys: [
      [18, { head: 0.1, mane: -0.12, bob: 2, arms: -0.3 }],
      [1, { head: 0.16, mane: -0.13, bob: 4, arms: -0.34 }],
      [10, { head: 0.21, mane: -0.15, bob: 5, arms: -0.36 }],
      [1, { head: 0.06, mane: -0.08, bob: 0, smear: [0, 8], arms: -0.18 }],
      [4, { head: 0.08, mane: -0.1, bob: 1, arms: -0.26 }],
    ],
  },

  talk: { priority: 0, keys: rep(2, [[3, { head: 0.04, mane: 0.08 }], [3, { head: 0, mane: 0.03 }]]) },

  curious: {
    priority: 1,
    directional: true,
    keys: [
      [1, { head: -0.05, mane: 0.04 }],
      [1, { head: 0.12, mane: 0.15, tilt: 1, smear: [-12, 4] }],
      [10, { head: 0.19, mane: 0.14, tilt: 2 }],
      [6, { head: 0.16, mane: 0.1, tilt: 1.6 }],
      [1, { head: 0.07, tilt: 0.6 }],
    ],
  },

  look: {
    priority: 1,
    keys: [
      [1, { head: 0.08, smear: [-8, 0] }],
      [8, { head: 0.16 }],
      [1, { head: 0 }],
      [1, { head: -0.08, smear: [8, 0] }],
      [8, { head: -0.16 }],
      [1, { head: -0.05 }],
      [3, { head: 0 }],
    ],
  },

  gaze: {
    priority: 1,
    directional: true,
    keys: [
      [3, {}, 'glint'],
      [1, { head: -0.05, bob: 1 }],
      [1, { head: 0.14, mane: 0.12, smear: [-8, 6] }, 'notice'],
      [6, { head: 0.2, mane: 0.1, hair: 0, bob: 0 }],
      [6, { head: 0.23, mane: 0.14, hair: 0, bob: 0 }, 'starlight'],
      [3, { head: 0.23, mane: 0.15, hair: 0, bob: 0, reach: 0.25, long: 1.1 }],
      [3, { head: 0.24, mane: 0.16, hair: 0, bob: 0, reach: 0.55, long: 1.2 }],
      [2, { head: 0.24, mane: 0.16, hair: 0, bob: -1, reach: 0.8, long: 1.3 }],
      [2, { head: 0.25, mane: 0.17, hair: 0, bob: -2, reach: 0.93, long: 1.35 }],
      [14, { head: 0.25, mane: 0.17, hair: 0, bob: -3, reach: 1, long: 1.38 }],
      [1, { head: 0.27, mane: 0.22, hair: 0, bob: -4, reach: 1.02, long: 1.42 }, 'glimmer'],
      [8, { head: 0.25, mane: 0.18, hair: 0, bob: -3, reach: 1, long: 1.38 }],
      [2, { head: 0.14, mane: 0.1, bob: -2, reach: 0.45, long: 1.15 }],
      [2, { head: 0.08, mane: 0.04, bob: -1, reach: 0.12, long: 1.03 }],
      [8, { head: 0.06, mane: -0.04, reach: -0.06 }],
      [1, {}],
    ],
  },

  uplink: {
    priority: 1,
    directional: true,
    keys: [
      [2, { hair: 0, bob: -2 }, 'glint'],
      [3, { hair: 0, bob: -2 }, 'stars'],
      [3, { hair: 0, bob: -2, mane: 0.05 }],
      [4, { hair: 0, bob: -2, mane: 0.1, head: 0.03 }],
      [1, { hair: 0, bob: -1, head: -0.06 }],
      [1, { hair: 0, bob: -2, head: 0.16, mane: 0.16, smear: [-8, 6] }, 'notice'],
      [5, { hair: 0, bob: -2, head: 0.22, mane: 0.14 }],
      [3, { hair: 0, bob: -2, head: 0.23, mane: 0.15, reach: 0.3, long: 1.15 }],
      [3, { hair: 0, bob: -2, head: 0.24, mane: 0.16, reach: 0.6, long: 1.3 }, 'align'],
      [2, { hair: 0, bob: -3, head: 0.25, mane: 0.17, reach: 0.85, long: 1.42 }],
      [2, { hair: 0, bob: -4, head: 0.25, mane: 0.18, reach: 0.96, long: 1.5 }],
      [9, { hair: 0, bob: -5, head: 0.25, mane: 0.18, reach: 1, long: 1.52 }],
      [1, { hair: 0, bob: 1, head: 0.24, mane: 0.26, reach: 0.98, long: 1.45, sy: 0.95, sx: 1.03 }, 'charge'],
      [2, { hair: 0, bob: 3, head: 0.23, mane: 0.32, reach: 0.98, long: 1.42, sy: 0.93, sx: 1.04 }],
      [2, { hair: 0, bob: 4, head: 0.23, mane: 0.38, reach: 0.99, long: 1.4, sy: 0.92, sx: 1.05 }],
      [2, { hair: 0, bob: 5, head: 0.22, mane: 0.44, reach: 1, long: 1.4, sy: 0.91, sx: 1.06, echo: [2, 0] }],
      [1, { hair: 0, bob: -10, head: 0.3, mane: 0.7, reach: 1.05, long: 1.78, sy: 1.14, sx: 0.9, echo: [10, -4], smear: [0, 14] }, 'surge'],
      [1, { hair: 0, bob: -16, head: 0.31, mane: 0.86, reach: 1.06, long: 1.7, sy: 1.06, sx: 0.96, echo: [16, -6] }],
      [2, { hair: 0, bob: -19, head: 0.3, mane: 0.8, reach: 1.06, long: 1.66, echo: [9, -3] }],
      [2, { hair: 0, bob: -19, head: 0.28, mane: 0.74, reach: 1.06, long: 1.62, echo: [4, -1] }],
      [5, { hair: 0, bob: -18, head: 0.28, mane: 0.62, reach: 1.05, long: 1.6 }],
      [1, { hair: 0, bob: -15, head: 0.27, mane: 0.5, reach: 1.03, long: 1.55, smear: [0, -8] }, 'break'],
      [7, { hair: 0, bob: -13, head: 0.26, mane: 0.36, reach: 1.02, long: 1.52 }],
      [1, { hair: 0, bob: -13, head: 0.29, mane: 0.4, reach: 1.03, long: 1.54 }, 'twinkle'],
      [4, { hair: 0, bob: -12, head: 0.28, mane: 0.32, reach: 1.02, long: 1.52 }],
      [1, { hair: 0, bob: -12, head: 0.29, mane: 0.34, reach: 1.02, long: 1.53 }, 'glimmer'],
      [7, { hair: 0, bob: -11, head: 0.27, mane: 0.28, reach: 1, long: 1.5 }],
      [2, { bob: -7, head: 0.2, mane: 0.2, reach: 0.7, long: 1.3 }, 'home'],
      [2, { bob: -4, head: 0.14, mane: 0.12, reach: 0.4, long: 1.12 }],
      [2, { bob: -1, head: 0.08, mane: 0.04, reach: 0.12, long: 1.03 }],
      [10, { bob: 1, head: 0.06, mane: -0.06, reach: -0.06 }],
      [1, {}],
    ],
  },

  victory: {
    priority: 4,
    fps: 24,
    directional: true,
    keys: [
      [3, { sy: 0.9, sx: 1.05, bob: 6, arms: -0.3, mane: -0.15 }],
      [3, { sy: 0.82, sx: 1.1, bob: 10, arms: -0.5, mane: -0.3, head: -0.04 }, 'gather'],
      [1, { sy: 1.24, sx: 0.85, bob: -16, arms: 0.55, mane: 0.45, smear: [0, 22], echo: [12, 0] }, 'launch'],
      [2, { sy: 1.1, sx: 0.94, bob: -30, arms: 1.45, mane: 0.85, echo: [20, -4] }, 'peak'],
      [10, { bob: -36, arms: 1.32, mane: 0.78, head: 0.05 }],
      [2, { bob: -34, arms: 1.18, mane: 0.7, head: -0.08 }, 'laugh'],
      [2, { bob: -38, arms: 1.36, mane: 0.8, head: 0.08 }],
      ...rep(4, [[2, { bob: -34, arms: 1.18, mane: 0.7, head: -0.08 }], [2, { bob: -38, arms: 1.36, mane: 0.8, head: 0.08 }]]),
      [2, { bob: -24, arms: 0.7, mane: 0.45, sy: 1.04 }, 'speak'],
      [2, { bob: -8, arms: 0.15, mane: 0.2, sy: 1.06, sx: 0.96, smear: [0, -12] }],
      [2, { bob: 3, arms: -0.15, mane: -0.06, sy: 0.88, sx: 1.08 }],
      [3, { bob: 1, arms: 0.05, sy: 0.97, sx: 1.02 }],
      [2, { arms: 0 }],
    ],
  },

  zap: {
    priority: 2,
    fps: 24,
    directional: true,
    keys: [
      [3, { reach: 0.2, long: 0.9, head: -0.06, mane: 0.1, bob: 1 }],
      [1, { reach: 1, long: 1.6, head: 0.12, mane: 0.32, smear: [-10, 0], echo: [6, 0] }, 'zap'],
      [6, { reach: 1, long: 1.52, head: 0.14, mane: 0.26 }],
      [4, { reach: 0.96, long: 1.42, head: 0.18, mane: 0.2 }, 'grin'],
      [10, { reach: 0.9, long: 1.36, head: 0.2, mane: 0.16 }],
      [3, { reach: 0.5, long: 1.15, head: 0.14, mane: 0.08 }],
      [3, { reach: 0.15, head: 0.06 }],
      [1, {}],
    ],
  },

  point: {
    priority: 2,
    fps: 24,
    directional: true,
    keys: [
      [2, { head: 0.16, mane: 0.15, tilt: 1, smear: [-10, 2] }, 'spot'],
      [3, { head: 0.2, mane: 0.12, tilt: 1.5 }],
      [3, { reach: -0.45, long: 0.8, head: 0.12, tilt: -5, sy: 0.9, sx: 1.06, bob: 5, mane: -0.2 }],
      [2, { reach: -0.55, long: 0.75, head: 0.1, tilt: -6, sy: 0.86, sx: 1.08, bob: 7, mane: -0.28 }, 'coil'],
      [1, { reach: 0.9, long: 2.3, head: 0.24, tilt: 8, sx: 0.94, sy: 1.1, mane: 0.6, smear: [-18, 0], echo: [14, 0] }, 'lock'],
      [1, { reach: 1.08, long: 2, head: 0.22, tilt: 7, mane: 0.55, echo: [8, 0] }],
      [2, { reach: 1.02, long: 1.42, head: 0.19, tilt: 4, mane: 0.4 }],
      [2, { reach: 0.98, long: 1.58, head: 0.18, tilt: 3, mane: 0.3 }],
      [2, { reach: 1, long: 1.5, head: 0.17, tilt: 3, mane: 0.22 }],
    ],
  },

  pointing: {
    loop: true,
    directional: true,
    keys: [
      [12, { reach: 1, long: 1.5, head: 0.17, mane: 0.16, tilt: 3 }],
      [1, { reach: 1.05, long: 1.8, head: 0.2, mane: 0.24, tilt: 4 }, 'tap'],
      [2, { reach: 1, long: 1.52, head: 0.18, mane: 0.18, tilt: 3 }],
      [1, { reach: 1.05, long: 1.8, head: 0.2, mane: 0.24, tilt: 4 }, 'tap'],
      [10, { reach: 1, long: 1.5, head: 0.17, mane: 0.16, tilt: 3, bob: -2 }],
      [1, { reach: 1, long: 1.5, head: 0.02, mane: 0.12, tilt: 2, smear: [10, 0] }],
      [8, { reach: 1, long: 1.5, head: -0.1, mane: 0.1, tilt: 2 }],
      [1, { reach: 1, long: 1.5, head: 0.12, mane: 0.16, tilt: 3, smear: [-10, 0] }],
      [8, { reach: 1, long: 1.5, head: 0.17, mane: 0.16, tilt: 3, bob: -1 }],
    ],
  },

  unpoint: {
    priority: 2,
    fps: 24,
    directional: true,
    keys: [
      [1, { reach: 0.6, long: 0.9, head: 0.08, tilt: -2, smear: [12, 0], mane: 0.1 }],
      [2, { reach: 0.1, long: 0.85, head: 0.04, tilt: -1 }],
      [2, { reach: -0.06, long: 1, tilt: 0 }],
      [1, {}],
    ],
  },

  fold: {
    priority: 3,
    fps: 24,
    keys: [
      [4, { head: 0.12, mane: 0.12 }],
      [2, { head: 0.06, mane: -0.18, arms: -0.5, sy: 0.93, sx: 1.04 }],
      [3, { mane: -0.36, arms: -0.72, sy: 0.84, sx: 1.08, bob: 4 }],
    ],
  },

  dive: {
    priority: 3,
    keys: [
      [1, { head: -0.05 }],
      [5, { head: 0.18, mane: 0.1, kickL: 0.1, kickR: 0.1 }],
      [2, { head: 0.22, mane: -0.15, sy: 0.9, sx: 1.06, kickL: 0.34, kickR: 0.34, arms: -0.6 }],
      [1, { head: 0.1, mane: -0.28, sy: 1.16, sx: 0.88, smear: [0, -14], arms: -0.7 }],
    ],
  },

  split: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { echo: [3, 0], mane: 0.1 }],
      [2, { echo: [10, -2], mane: 0.18, head: 0.05 }],
      [2, { echo: [22, -4], mane: 0.22, head: -0.06 }, 'minds'],
      [6, { echo: [34, -5], mane: 0.24, head: 0.06, bob: -3 }],
      [2, { echo: [41, -6], mane: 0.26, head: -0.05, bob: -3 }],
      [6, { echo: [36, -5], mane: 0.24, head: 0.07, bob: -3 }],
      [1, { echo: [12, 0], sx: 1.08, sy: 0.94, bob: -1 }, 'snap'],
      [1, { sx: 0.96, sy: 1.04, mane: 0.3 }],
      [3, { mane: 0.1 }],
      [1, {}],
    ],
  },

  alarm: {
    priority: 2,
    directional: true,
    keys: [
      [1, { mane: 0.34, head: 0.1, tilt: 3, arms: 0.36 }, 'stare'],
      [1, { mane: 0.12, head: 0.1, tilt: 3, arms: 0.24 }],
      ...rep(14, [[1, { mane: 0.34, head: 0.1, tilt: 3, arms: 0.36 }], [1, { mane: 0.12, head: 0.1, tilt: 3, arms: 0.24 }]]),
    ],
  },

  flinch: {
    priority: 2,
    keys: [
      [2, { head: 0.22, tilt: 4, sx: 0.92, sy: 1.06, mane: -0.12, bob: 5, smear: [-10, 0], arms: -0.32 }],
      [5, { head: 0.18, tilt: 3.4, mane: -0.1, bob: 4, arms: -0.22 }],
      [1, { head: 0.09, tilt: 1.5, bob: 2, arms: -0.08 }],
    ],
  },

  turn: {
    priority: 3,
    fps: 24,
    flip: true,
    keys: [
      [1, { sx: 0.7, sy: 1.02, echo: [6, 0], arms: -0.1 }],
      [1, { sx: 0.25, sy: 1.04, echo: [10, 0], mane: 0.2, arms: -0.2 }],
      [1, { sx: -0.25, sy: 1.04, echo: [10, 0], mane: 0.2, arms: -0.2 }],
      [1, { sx: -0.7, sy: 1.02, arms: -0.1 }],
      [2, { sx: -1, arms: 0.04 }],
    ],
  },

  spin: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { sy: 0.92, sx: 1.05, bob: 3, arms: -0.2 }],
      [1, { sx: 0.7, echo: [8, 0], mane: 0.25, arms: 0.15 }],
      [1, { sx: 0.2, echo: [14, 0], mane: 0.35, bob: -4, arms: 0.28 }],
      [1, { sx: -0.3, echo: [14, 0], mane: 0.35, bob: -6, arms: 0.3 }],
      [1, { sx: -0.75, echo: [10, 0], mane: 0.3, bob: -6, arms: 0.3 }],
      [1, { sx: -1, echo: [6, 0], bob: -6, arms: 0.28 }],
      [1, { sx: -0.75, echo: [10, 0], mane: 0.3, bob: -5, arms: 0.3 }],
      [1, { sx: -0.3, echo: [14, 0], mane: 0.35, bob: -4, arms: 0.3 }],
      [1, { sx: 0.2, echo: [14, 0], mane: 0.35, bob: -2, arms: 0.25 }],
      [1, { sx: 0.7, echo: [8, 0], mane: 0.25, arms: 0.15 }],
      [2, { sx: 1.06, sy: 0.95, mane: 0.15, arms: -0.06 }],
      [1, { sx: 1 }],
    ],
  },

  hop: {
    priority: 3,
    fps: 24,
    keys: [
      [3, { sy: 0.86, sx: 1.08, bob: 6, mane: -0.08, arms: -0.3 }],
      [1, { sy: 1.18, sx: 0.9, bob: -10, smear: [0, 16], arms: 0.4 }],
      [2, { sy: 1.08, sx: 0.95, bob: -32, mane: 0.15, arms: 0.55 }],
      [4, { bob: -42, mane: 0.3, arms: 0.6 }],
      [2, { sy: 1.06, bob: -26, mane: 0.2, arms: 0.35 }],
      [1, { sy: 1.12, sx: 0.92, bob: -8, smear: [0, -14], arms: 0.15 }],
      [2, { sy: 0.82, sx: 1.12, bob: 5, mane: -0.1, arms: -0.28 }],
      [2, { sy: 0.94, sx: 1.04, bob: 2, arms: 0.06 }],
      [1, {}],
    ],
  },

  land: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { sy: 0.72, sx: 1.22, bob: 6, mane: -0.22, arms: -0.4 }],
      [2, { sy: 0.88, sx: 1.08, bob: 3, mane: -0.1, arms: -0.15 }],
      [2, { sy: 1.05, sx: 0.97, mane: 0.1, arms: 0.1 }],
      [1, {}],
    ],
  },

  plop: {
    priority: 3,
    fps: 24,
    keys: [
      [2, { sy: 0.85, sx: 1.1, mane: -0.12, kickL: 0.3, kickR: 0.3, arms: -0.55 }],
      [2, { sy: 1.05, sx: 0.97, kickL: 0.12, kickR: 0.12, arms: -0.38 }],
      [1, {}],
    ],
  },

  fall: {
    loop: true,
    fps: 24,
    keys: [
      [2, { sy: 1.12, sx: 0.92, mane: 0.36, head: 0.05, smear: [0, -16], armL: 0.8, armR: 0.55 }],
      [2, { sy: 1.1, sx: 0.93, mane: 0.26, head: -0.04, smear: [0, -12], armL: 0.55, armR: 0.82 }],
    ],
  },
};

export class Player {
  constructor(name, { dir = 0, reach = 1, at = performance.now() } = {}) {
    this.name = name;
    this.act = ACTS[name];
    this.dir = dir;
    this.reach = reach;
    this.start = at;
    this.total = this.act.keys.reduce((n, [hold]) => n + hold, 0);
  }

  get priority() {
    return this.act.priority ?? 0;
  }

  sample(now) {
    const fps = this.act.fps || SHEET_FPS;
    let f = Math.floor((now - this.start) / (1000 / fps));
    if (f >= this.total) {
      if (!this.act.loop) return null;
      f %= this.total;
    }
    const { keys } = this.act;
    for (let i = 0; i < keys.length; i++) {
      const [hold, pose, cue] = keys[i];
      if (f < hold) return { pose, index: i, cue };
      f -= hold;
    }
    return null;
  }

  resolve(pose, facing) {
    const out = { ...pose };
    const lean = this.act.directional && this.dir ? this.dir * facing : 0;
    if (lean) {
      if (pose.head !== undefined) out.head = pose.head * lean;
      if (pose.tilt !== undefined) out.tilt = pose.tilt * this.dir;
      if (pose.smear) out.smear = [pose.smear[0] * lean, pose.smear[1]];
      if (pose.echo) out.echo = [pose.echo[0] * lean, pose.echo[1]];
    }
    if (pose.arms !== undefined) {
      out.armL = pose.arms;
      out.armR = pose.arms;
    }
    if (pose.reach !== undefined) {
      const scale = typeof this.reach === 'function' ? this.reach() : this.reach;
      out[lean < 0 ? 'armL' : 'armR'] = pose.reach * scale;
    }
    if (pose.long !== undefined) out[lean < 0 ? 'longL' : 'longR'] = pose.long;
    delete out.arms;
    delete out.reach;
    delete out.long;
    return out;
  }
}
