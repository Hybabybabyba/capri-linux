'use strict';

const net = require('node:net');

const NAME = `\0capri-desktop-${process.getuid()}`;

let server = null;

function claim(onArgs) {
  return new Promise((resolve) => {
    server = net.createServer((sock) => {
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (d) => { buf += d; });
      sock.on('end', () => {
        try { onArgs(JSON.parse(buf)); } catch {}
      });
      sock.on('error', () => {});
    });
    server.once('error', (err) => {
      server = null;
      if (err.code !== 'EADDRINUSE') return resolve(true);
      const client = net.createConnection(NAME, () => client.end(JSON.stringify(process.argv)));
      client.on('close', () => resolve(false));
      client.on('error', () => resolve(false));
    });
    server.listen(NAME, () => resolve(true));
  });
}

module.exports = { claim };
