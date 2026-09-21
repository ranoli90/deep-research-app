import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const ignore = readFileSync('.dockerignore', 'utf8');
const dockerfile = readFileSync('deployment/render/Dockerfile', 'utf8');
const api = readFileSync('deployment/render/start-api.sh', 'utf8');
const worker = readFileSync('deployment/render/start-worker.sh', 'utf8');
const extractionLock = readFileSync('apps/backend/extraction/requirements.lock', 'utf8');

test('Docker context has only backend workspace inputs and denies credential classes', () => {
  const lines = ignore.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.equal(lines[0], '*');
  assert.deepEqual(lines.filter((line) => line.startsWith('!')), [
    '!package.json', '!pnpm-lock.yaml', '!pnpm-workspace.yaml', '!tsconfig.base.json',
    '!apps', '!apps/backend', '!apps/backend/**', '!packages',
    '!packages/contracts', '!packages/contracts/**',
    '!packages/research-core', '!packages/research-core/**',
    '!packages/design', '!packages/design/**',
    '!deployment', '!deployment/render', '!deployment/render/**',
  ]);
  for (const deny of [
    '**/.env', '**/.env.*', '**/.credentials', '**/.credentials/**',
    '**/credentials.json', '**/.npmrc', '**/.netrc', '**/*.p8',
    '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx',
    '**/*.jks', '**/*.keystore', '**/node_modules', '**/node_modules/**',
  ]) assert.ok(lines.includes(deny), `missing deny rule: ${deny}`);
  assert.ok(!lines.some((line) => line.startsWith('!') && /mobile|\.credentials|\.env/.test(line)));
});

test('image copies explicit source roots only and provisions the isolated parser', () => {
  assert.doesNotMatch(dockerfile, /^\s*(?:COPY|ADD)\s+\.\s+\./m);
  assert.doesNotMatch(dockerfile, /^\s*ADD\b/m);
  const contextCopies = dockerfile.split(/\r?\n/).filter((line) => /^COPY\s/.test(line) && !line.includes('--from='));
  assert.deepEqual(contextCopies, [
    'COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./',
    'COPY apps/backend/package.json apps/backend/package.json',
    'COPY packages/contracts/package.json packages/contracts/package.json',
    'COPY packages/research-core/package.json packages/research-core/package.json',
    'COPY packages/design/package.json packages/design/package.json',
    'COPY tsconfig.base.json ./',
    'COPY apps/backend/ apps/backend/',
    'COPY packages/contracts/ packages/contracts/',
    'COPY packages/research-core/ packages/research-core/',
    'COPY packages/design/ packages/design/',
    'COPY deployment/render/ deployment/render/',
    'COPY apps/backend/extraction/requirements.lock /tmp/extraction-requirements.lock',
  ]);
  assert.match(dockerfile, /EXTRACTION_RUNTIME=\/opt\/extraction-runtime/);
  assert.match(dockerfile, /FROM python:3\.12-slim-bookworm AS runtime/);
  assert.match(dockerfile, /COPY --from=dependencies \/usr\/local\/bin\/node \/usr\/local\/bin\/node/);
  assert.match(extractionLock.split(/\r?\n/, 1)[0], /Python 3\.12 \/ Linux x86_64/);
  assert.match(dockerfile, /bubblewrap ca-certificates/);
  assert.match(dockerfile, /libgomp1 libstdc\+\+6/);
  assert.match(dockerfile, /pip install --no-cache-dir --require-hashes --only-binary=:all: -r \/tmp\/extraction-requirements\.lock/);
  assert.match(dockerfile, /^USER 10001:10001$/m);
  assert.doesNotMatch(dockerfile, /^HEALTHCHECK\b/m);
  assert.doesNotMatch(dockerfile, /(?:ARG|ENV)\s+[^\n]*(?:SECRET|TOKEN|API_KEY)/i);
  assert.match(api, /exec node_modules\/\.bin\/tsx apps\/backend\/src\/api\/server\.ts/);
  assert.match(worker, /exec node_modules\/\.bin\/tsx apps\/backend\/src\/worker\/main\.ts/);
});

test('API and worker launchers parse as POSIX shell', () => {
  for (const script of ['deployment/render/start-api.sh', 'deployment/render/start-worker.sh']) {
    const result = spawnSync('sh', ['-n', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test('Render PORT wins over stale API_PORT while local API_PORT remains usable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norrow-render-launch-'));
  try {
    mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
    const probe = join(dir, 'node_modules/.bin/tsx');
    writeFileSync(probe, '#!/bin/sh\nprintf "%s|%s|%s\\n" "$API_HOST" "$API_PORT" "$1"\n');
    chmodSync(probe, 0o700);
    // The launcher resolves node_modules relative to cwd, so use a test-only
    // copied script in the temporary directory to exercise the actual bytes.
    writeFileSync(join(dir, 'start-api.sh'), api);
    const rendered = spawnSync('sh', ['start-api.sh'], {
      cwd: dir,
      env: { ...process.env, PORT: '12345', API_PORT: '9999', API_HOST: '127.0.0.1' },
      encoding: 'utf8',
    });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(rendered.stdout.trim(), '0.0.0.0|12345|apps/backend/src/api/server.ts');
    const local = spawnSync('sh', ['start-api.sh'], {
      cwd: dir,
      env: { ...process.env, PORT: '', API_PORT: '8789', API_HOST: '127.0.0.1' },
      encoding: 'utf8',
    });
    assert.equal(local.status, 0, local.stderr);
    assert.equal(local.stdout.trim(), '127.0.0.1|8789|apps/backend/src/api/server.ts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
