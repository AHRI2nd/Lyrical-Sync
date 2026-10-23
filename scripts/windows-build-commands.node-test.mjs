import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'scripts/msstore-build.ps1'), 'utf8');
const invocation = source.match(/Invoke-Checked 'npm\.cmd' @\(([^\n]+)\)/);
assert.ok(invocation, 'No Store Tauri build command was discovered');
for (const target of ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']) {
  test(`actual Store command parses correctly for ${target}`, () => {
    const tokens = [...invocation[1].matchAll(/'([^']*)'|\$(target)\b/g)].map(m => m[2] ? target : m[1]);
    assert.deepEqual(tokens.slice(0, 4), ['run', 'tauri', '--', 'build']);
    const args = tokens.slice(4);
    const separator = args.indexOf('--');
    assert.ok(separator >= 0 && args.slice(separator + 1).includes('--locked'), 'Cargo lock enforcement must be forwarded after --');
    args.splice(separator, 0, '--help');
    const result = spawnSync(process.execPath, [resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--target/);
  });
}
