'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const EVERY_MS = 60000;
const LOW_BATTERY = 15;
const SAVER_PROFILES = new Set(['power-saver', 'low-power']);
const PCI_VENDORS = { '0x1002': 'amd', '0x10de': 'nvidia', '0x8086': 'intel' };
const MESA_DRIVERS = new Set(['amdgpu', 'radeon', 'i915', 'xe']);

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
};

const has = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => fs.existsSync(path.join(d, cmd)));

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    if (!has(cmd)) return resolve('');
    execFile(cmd, args, { timeout, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function detectSession(env = process.env) {
  const desktop = String(env.XDG_CURRENT_DESKTOP || env.DESKTOP_SESSION || '').toLowerCase();
  const display = env.WAYLAND_DISPLAY ? 'wayland' : env.DISPLAY ? 'x11' : (env.XDG_SESSION_TYPE || 'unknown');
  let wm;
  if (env.HYPRLAND_INSTANCE_SIGNATURE || desktop.includes('hyprland')) wm = 'hyprland';
  else if (env.SWAYSOCK || desktop.includes('sway')) wm = 'sway';
  else if (desktop.includes('kde') || desktop.includes('plasma')) wm = 'kde';
  else if (desktop.includes('gnome')) wm = 'gnome';
  else wm = display === 'x11' ? 'x11' : 'wayland';

  let windowTool = 'none';
  if (wm === 'hyprland') windowTool = 'hyprctl';
  else if (wm === 'sway') windowTool = 'swaymsg';
  else if (display === 'x11') windowTool = has('xdotool') ? 'xdotool' : 'none';
  else if (wm === 'kde' && has('kdotool')) windowTool = 'kdotool';
  const terminal = [env.TERMINAL, 'kitty', 'foot', 'alacritty', 'wezterm', 'ghostty', 'konsole', 'gnome-terminal', 'xfce4-terminal', 'xterm']
    .find((t) => t && has(t)) || null;
  return { wm, display, desktop: desktop || null, windowTool, terminal };
}

function detectDistro() {
  const os = Object.fromEntries(read('/etc/os-release').split('\n')
    .map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^"|"$/g, '')]));
  const pkg = ['pacman', 'apt', 'dnf', 'zypper', 'xbps-install', 'apk', 'emerge'].find(has) || null;
  return { id: os.ID || 'linux', name: os.PRETTY_NAME || os.NAME || 'Linux', pkg };
}

function detectGpu() {
  let cards = [];
  try {
    cards = fs.readdirSync('/sys/class/drm').filter((d) => /^card\d+$/.test(d));
  } catch {}
  const gpus = cards.map((card) => {
    const dev = `/sys/class/drm/${card}/device`;
    let driver = '';
    try { driver = path.basename(fs.readlinkSync(`${dev}/driver`)); } catch {}
    return { card, vendor: PCI_VENDORS[read(`${dev}/vendor`)] || 'other', driver, primary: read(`${dev}/boot_vga`) === '1' };
  });
  const main = gpus.find((g) => g.primary) || gpus[0] || { vendor: 'none', driver: '' };
  return { vendor: main.vendor, driver: main.driver, all: gpus.map(({ vendor, driver }) => `${vendor}/${driver || '?'}`) };
}

function gpuSwitches(gpu = detectGpu(), env = process.env) {
  if (env.CAPRI_GPU === 'off') return { disable: true, switches: [] };
  if (MESA_DRIVERS.has(gpu.driver)) return { disable: false, switches: ['enable-gpu-rasterization', 'enable-zero-copy'] };
  if (gpu.driver === 'nvidia') return { disable: false, switches: ['enable-gpu-rasterization'] };
  return { disable: false, switches: [] };
}

async function gpuModel() {
  const out = await run('lspci', ['-mm']);
  const line = out.split('\n').find((l) => /"(VGA compatible controller|3D controller|Display controller)"/.test(l));
  if (!line) return null;
  const f = line.match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) || [];
  return f.length >= 3 ? `${f[1]} ${f[2]}`.replace(/\s+/g, ' ') : null;
}

async function readPower() {
  let battery = null;
  let onAC = null;
  let supplies = [];
  try { supplies = fs.readdirSync('/sys/class/power_supply'); } catch {}
  for (const name of supplies) {
    const dir = `/sys/class/power_supply/${name}`;
    const type = read(`${dir}/type`);
    if (type === 'Battery' && read(`${dir}/scope`) !== 'Device' && !battery) {
      const capacity = Number(read(`${dir}/capacity`));
      if (Number.isFinite(capacity)) battery = { name, capacity, status: read(`${dir}/status`) || 'Unknown' };
    } else if (type === 'Mains' || type === 'USB') {
      if (read(`${dir}/online`) === '1') onAC = true;
      else if (onAC === null) onAC = false;
    }
  }
  if (battery && onAC === null) onAC = battery.status !== 'Discharging';
  const profile = (await run('powerprofilesctl', ['get'])).trim() || read('/sys/firmware/acpi/platform_profile') || null;
  const low = Boolean(battery && !onAC && battery.capacity < LOW_BATTERY);
  return { battery, onAC, profile, saver: low || SAVER_PROFILES.has(profile), reason: low ? 'battery' : SAVER_PROFILES.has(profile) ? 'profile' : null };
}

async function detectAudio() {
  const info = await run('pactl', ['info']);
  const serverName = (info.match(/^Server Name:\s*(.+)$/m) || [])[1] || '';
  let server = 'none';
  if (/pipewire/i.test(serverName)) server = 'pipewire';
  else if (/pulseaudio/i.test(serverName)) server = 'pulseaudio';
  else if (has('wpctl') && (await run('wpctl', ['status'])).trim()) server = 'pipewire';
  const pulseApi = Boolean(serverName);
  let volumeTool = 'none';
  if (has('pamixer') && pulseApi) volumeTool = 'pamixer';
  else if (server === 'pipewire' && has('wpctl')) volumeTool = 'wpctl';
  else if (pulseApi) volumeTool = 'pactl';
  return { server, detail: serverName || null, volumeTool };
}

let ctx = null;
let profile = null;

const profileFile = () => path.join(ctx.dataDir, 'hardware_profile.json');

function save() {
  try {
    fs.writeFileSync(profileFile(), JSON.stringify(profile, null, 2));
  } catch (err) {
    console.error('[svc:env-adapter] profile:', err.message);
  }
}

async function scan() {
  const gpu = detectGpu();
  const [model, power, audio] = await Promise.all([gpuModel(), readPower(), detectAudio()]);
  return {
    scannedAt: new Date().toISOString(),
    distro: detectDistro(),
    session: detectSession(),
    gpu: { ...gpu, model, ...gpuSwitches(gpu) },
    power,
    audio,
    tools: Object.fromEntries(['wtype', 'ydotool', 'xdotool', 'kdotool', 'wl-copy', 'xclip', 'grim', 'maim', 'slurp', 'tesseract', 'playerctl', 'pamixer', 'jq']
      .map((t) => [t, has(t)])),
  };
}

async function start(c) {
  ctx = c;
  profile = await scan();
  save();
  ctx.env = profile;
  ctx.pace = profile.power.saver ? 3 : 1;
  ctx.bus.emit('env.profile', profile);
}

async function tick() {
  if (!profile) return;
  const power = await readPower();
  profile = { ...profile, power };
  ctx.env = profile;
  save();
  ctx.pace = power.saver ? 3 : 1;
  ctx.bus.emit('env.power', profile);
}

module.exports = {
  name: 'env-adapter',
  every: EVERY_MS,
  steadyPace: true,
  start,
  tick,
  gpuSwitches,
};
