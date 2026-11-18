// Generate a self-signed cert (key.pem + cert.pem) for the local HTTPS dev server.
// Valid for localhost and this machine's primary LAN IPv4, so a device on the same
// network (e.g. a phone's browser) can load the page without a "wrong host" error.
// Created once; delete the .pem files to rotate.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const dir = import.meta.dirname;
const keyPath = join(dir, 'key.pem');
const certPath = join(dir, 'cert.pem');
const days = 30;

function primaryIpv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

if (existsSync(certPath) && existsSync(keyPath)) {
  console.log(`[gen-cert] reusing existing ${certPath}`);
} else {
  mkdirSync(dir, { recursive: true });
  const lan = primaryIpv4();
  const sans = ['DNS:localhost', 'IP:127.0.0.1', lan ? `IP:${lan}` : ''].filter(Boolean).join(',');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      String(days),
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-subj',
      '/CN=pn-local-site',
      '-addext',
      `subjectAltName=${sans}`,
    ],
    { stdio: 'inherit' },
  );
  console.log(`[gen-cert] wrote ${certPath} (SAN: ${sans})`);
}
