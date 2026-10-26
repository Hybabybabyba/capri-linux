'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const MAX_LINE = 64 * 1024;
const TYPE_RE = /^[a-z]+(\.[a-z_]+)+$/;

function socketPath() {
  const dir = process.env.XDG_RUNTIME_DIR || path.join('/tmp', `capri-${process.getuid()}`);
  return path.join(dir, 'capri', 'events.sock');
}

let server = null;

function start(ctx) {
  const file = socketPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try { fs.unlinkSync(file); } catch {}

  server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', (d) => {
      buf += d;
      if (buf.length > MAX_LINE) { sock.destroy(); return; }
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach((line) => dispatch(ctx, line));
    });
    sock.on('end', () => dispatch(ctx, buf));
    sock.on('error', () => {});
  });
  server.on('error', (err) => console.error('[svc:ingress]', err.message));
  server.listen(file, () => fs.chmod(file, 0o600, () => {}));
}

function dispatch(ctx, line) {
  if (!line.trim()) return;
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  if (!ev || typeof ev.type !== 'string' || !TYPE_RE.test(ev.type)) return;
  ctx.bus.emit(ev.type, ev);
}

function stop() {
  server?.close();
  server = null;
  try { fs.unlinkSync(socketPath()); } catch {}
}

module.exports = { name: 'ingress', start, stop };
