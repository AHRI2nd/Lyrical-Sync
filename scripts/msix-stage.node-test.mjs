import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Catches missing runtime, incorrect identity/version/PE metadata, and payload leakage.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'msix-stage-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime'); mkdirSync(runtime);
  const pe = Buffer.alloc(256); pe.write('MZ'); pe.writeUInt32LE(128, 60); pe.write('PE\0\0', 128); pe.writeUInt16LE(0x8664, 132);
  const binary = join(root, 'lyrical-sync.exe'); writeFileSync(binary, pe);
  writeFileSync(join(root, 'secret.pfx'), 'must not ship');
  writeFileSync(join(runtime, 'msedgewebview2.exe'), pe);
  mkdirSync(join(runtime, 'Locales')); writeFileSync(join(runtime, 'Locales', 'ko.pak'), 'complete runtime data');
  const config = join(root, 'store.json');
  const identity = { name: 'TsukimoriAhri.LyricalSync', publisher: 'CN=2D6FFCE0-A794-4D2D-ACC8-9021F42D6211', publisherDisplayName: 'Tsukimori Ahri', minVersion: '10.0.19041.0' };
  writeFileSync(config, JSON.stringify(identity));
  const stage = join(root, 'stage');
  const run = (extra = []) => spawnSync(process.execPath, [resolve('scripts/msix-stage.mjs'), '--config', config, '--app-version', '0.6.101', '--binary', binary, '--runtime', runtime, '--assets', resolve('src-tauri/icons'), '--stage', stage, '--max-version-tested', '10.0.26300.0', ...extra], { encoding: 'utf8' });
  return { root, runtime, binary, config, identity, stage, run };
}

test('stages an x64 package with exact Store identity and complete runtime, excluding unrelated files', t => {
  const f = fixture(t); const r = f.run(); assert.equal(r.status, 0, r.stderr);
  const xml = readFileSync(join(f.stage, 'AppxManifest.xml'), 'utf8');
  assert.match(xml, /Name="TsukimoriAhri\.LyricalSync" Publisher="CN=2D6FFCE0-A794-4D2D-ACC8-9021F42D6211" Version="1\.6\.101\.0" ProcessorArchitecture="x64"/);
  assert.match(xml, /<PublisherDisplayName>Tsukimori Ahri<\/PublisherDisplayName>/);
  assert.match(xml, /EntryPoint="Windows.fullTrustApplication"/);
  assert.match(xml, /Name="runFullTrust"/);
  assert.equal(readFileSync(join(f.stage, 'WebView2', 'Locales', 'ko.pak'), 'utf8'), 'complete runtime data');
  assert.deepEqual(readdirSync(f.stage).sort(), ['AppLicense.txt', 'AppxManifest.xml', 'Assets', 'WebView2', 'lyrical-sync.exe']);
  assert.match(readFileSync(join(f.stage, 'AppLicense.txt'), 'utf8'), /MIT License/);
  assert.equal(existsSync(join(f.stage, 'secret.pfx')), false);
});
for (const version of ['0.6.101-beta', '65535.0.0', '0.65536.0', '0.1.65536', '0.01.1']) {
  test(`rejects invalid or overflowing app version ${version}`, t => {
    const f = fixture(t); const r = f.run(['--app-version', version]); assert.notEqual(r.status, 0); assert.match(r.stderr, /version/i); assert.equal(existsSync(f.stage), false);
  });
}
test('rejects surrounding whitespace in identity instead of shipping mismatched values', t => {
  const f = fixture(t); writeFileSync(f.config, JSON.stringify({ ...f.identity, name: f.identity.name + ' ' }));
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /identity|name/i);
});
test('escapes XML display names', t => {
  const f = fixture(t); writeFileSync(f.config, JSON.stringify({ ...f.identity, publisherDisplayName: 'A & B <C>' }));
  const r = f.run(); assert.equal(r.status, 0, r.stderr); assert.match(readFileSync(join(f.stage, 'AppxManifest.xml'), 'utf8'), /A &amp; B &lt;C&gt;/);
});
test('rejects missing Fixed Version runtime before creating staging', t => {
  const f = fixture(t); rmSync(join(f.runtime, 'msedgewebview2.exe'));
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /runtime|msedgewebview2/i); assert.equal(existsSync(f.stage), false);
});
test('rejects an ARM64 executable in an x64 package', t => {
  const f = fixture(t); const pe = readFileSync(f.binary); pe.writeUInt16LE(0xaa64, 132); writeFileSync(f.binary, pe);
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /x64|architecture/i);
});
test('rejects a staging path inside the runtime source', t => {
  const f = fixture(t); const r = f.run(['--stage', join(f.runtime, 'nested')]); assert.notEqual(r.status, 0); assert.match(r.stderr, /overlap/i);
});
test('never overwrites an existing staging folder', t => {
  const f = fixture(t); mkdirSync(f.stage); writeFileSync(join(f.stage, 'keep.txt'), 'keep');
  const r = f.run(); assert.notEqual(r.status, 0); assert.equal(readFileSync(join(f.stage, 'keep.txt'), 'utf8'), 'keep');
});
test('rejects symlink runtime files instead of copying files outside its source', t => {
  const f = fixture(t); symlinkSync(join(f.root, 'secret.pfx'), join(f.runtime, 'linked.pak'));
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /symlink/i);
});
test('rejects a tested OS version below the package minimum', t => {
  const f = fixture(t); const r = f.run(['--max-version-tested', '10.0.17763.0']); assert.notEqual(r.status, 0); assert.match(r.stderr, /version|minimum/i);
});
