import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/check-notices.mjs');
test('pins hashed notice inputs and payload to LF on Windows checkouts', () => {
  const manifest = JSON.parse(readFileSync('packaging/licenses/inventory.json', 'utf8'));
  const files = [...Object.keys(manifest.inputs), 'src-tauri/ThirdPartyNotices.txt'];
  const result = spawnSync('git', ['check-attr', '--stdin', 'text', 'eol'], {
    input: files.join('\n') + '\n', encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  for (const file of files) {
    assert.ok(result.stdout.includes(`${file}: text: set\n`), `${file} must be text`);
    assert.ok(result.stdout.includes(`${file}: eol: lf\n`), `${file} must retain LF`);
  }
});
test('validates the checked-in notices for both Store targets and production frontend', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'notices-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync('packaging/licenses/inventory.json', 'utf8'));
  for (const file of [...Object.keys(manifest.inputs), 'packaging/licenses/inventory.json', 'src-tauri/ThirdPartyNotices.txt']) {
    const destination = join(root, file); mkdirSync(join(destination, '..'), { recursive: true }); copyFileSync(file, destination);
  }
  return { root, run: () => spawnSync(process.execPath, [script, root], { encoding: 'utf8' }) };
}
test('rejects changed dependency locks rather than packaging stale notices', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'src-tauri/Cargo.lock'), 'changed dependencies');
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /stale.*Cargo.lock/i);
});
test('rejects missing or edited notice payloads', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'src-tauri/ThirdPartyNotices.txt'), 'truncated');
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /notice.*hash/i);
});
