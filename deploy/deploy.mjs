#!/usr/bin/env node
// MiniRouter deploy script — uploads source to the server and recreates
// the container via docker compose. Secrets stay on the server's .env
// (gitignored); this script only needs SSH creds from the local .env.
//
// Local .env (gitignored) must define:
//   MINIROUTER_SSH_HOST, MINIROUTER_SSH_PORT, MINIROUTER_SSH_USER,
//   MINIROUTER_SSH_PASSWORD
//
// Usage: node deploy/deploy.mjs [remote-dir]
import { execSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFileSync } from 'node:fs';
import { Client } from 'ssh2';

const REPO = process.cwd();
const REMOTE_DIR = process.argv[2] || '/opt/minirouter-src';
const TAR_LOCAL = '/tmp/minirouter-src.tgz';

// ── load local .env (SSH creds only) ──────────────────────────────
const env = {};
try {
  for (const line of readFileSync(`${REPO}/.env`, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
} catch {
  // no local .env; fall back to process.env
}
const cfg = { ...process.env, ...env };
const HOST = cfg.MINIROUTER_SSH_HOST;
const PORT = Number(cfg.MINIROUTER_SSH_PORT || 22);
const USER = cfg.MINIROUTER_SSH_USER || 'root';
const PASS = cfg.MINIROUTER_SSH_PASSWORD;
if (!HOST || !PASS) {
  console.error('Missing MINIROUTER_SSH_HOST / MINIROUTER_SSH_PASSWORD in .env');
  process.exit(1);
}

// ── pack source (exclude node_modules, .git, .env, build artifacts) ──
console.log('[1/4] Packing source (excl node_modules/.git/.env)...');
execSync(
  `tar -czf ${TAR_LOCAL} -C ${REPO} ` +
    '--exclude=node_modules --exclude=.git --exclude=.env ' +
    "--exclude='*.db' --exclude=dist --exclude=logs --exclude=.tmp " +
    '--exclude=.tmp-e2e --exclude=.worktrees .',
  { stdio: 'inherit' }
);

const conn = new Client();
conn.on('ready', () => {
  conn.sftp((err, sftp) => {
    if (err) throw err;
    console.log('[2/4] Uploading to', `${USER}@${HOST}:${PORT}`);
    const write = sftp.createWriteStream('/tmp/minirouter-src.tgz');
    write.on('close', () => {
      console.log('[3/4] Extracting + docker compose up --build --force-recreate');
      const cmd =
        `set -e && ` +
        `mkdir -p ${REMOTE_DIR} && ` +
        `cd ${REMOTE_DIR} && ` +
        `tar -xzf /tmp/minirouter-src.tgz && ` +
        `rm -f /tmp/minirouter-src.tgz && ` +
        `docker compose up -d --build --force-recreate && ` +
        `sleep 3 && docker ps --filter name=minirouter ` +
        `--format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"`;
      conn.exec(cmd, (e2, stream) => {
        if (e2) throw e2;
        stream.on('data', (d) => process.stdout.write(d.toString()));
        stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
        stream.on('close', (code) => {
          conn.end();
          console.log(`\n[4/4] done (exit ${code})`);
          process.exit(code || 0);
        });
      });
    });
    createReadStream(TAR_LOCAL).pipe(write);
  });
}).connect({ host: HOST, port: PORT, username: USER, password: PASS });
