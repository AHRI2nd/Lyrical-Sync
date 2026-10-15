import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./check-dependencies.mjs', import.meta.url));
function run(installed, locked = '2.5.4', declared = '^2', lockDeclared = '^2') {
  const cwd = mkdtempSync(join(tmpdir(), 'lyrical-deps-'));
  try {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@tauri-apps/plugin-opener': declared } }));
    writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({ packages: {
      '': { dependencies: { '@tauri-apps/plugin-opener': lockDeclared } },
      'node_modules/@tauri-apps/plugin-opener': { version: locked },
    } }));
    if (installed) {
      const dir = join(cwd, 'node_modules/@tauri-apps/plugin-opener'); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: installed }));
    }
    return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
test('accepts packages installed from the current branch lockfile', () => assert.equal(run('2.5.4').status, 0));
test('reports the missing branch dependency and the restoration command', () => {
  const result = run(null); assert.equal(result.status, 1);
  assert.match(result.stderr, /@tauri-apps\/plugin-opener/); assert.match(result.stderr, /npm ci/);
});
test('rejects an installed version from a different lockfile', () => {
  const result = run('2.4.0'); assert.equal(result.status, 1); assert.match(result.stderr, /2\.4\.0.*2\.5\.4/);
});
test('rejects manifest and lockfile disagreement even when installed version matches', () => {
  const result = run('2.5.4', '2.5.4', '^3'); assert.equal(result.status, 1); assert.match(result.stderr, /package-lock/);
});
