import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
let folder, binary;
after(() => { if (folder) rmSync(folder, { recursive: true, force: true }); });
function run(architecture, source) {
  const module = resolve(root, 'src-tauri/windows_manifest.rs');
  assert.ok(existsSync(module), 'Target-aware Windows assembly manifest renderer is missing');
  if (!binary) {
    folder = mkdtempSync(join(tmpdir(), 'store-manifest-')); binary = join(folder, process.platform === 'win32' ? 'probe.exe' : 'probe');
    const harness = `#[path=${JSON.stringify(module)}] mod windows_manifest;\nfn main(){let a:Vec<String>=std::env::args().collect();let s=std::fs::read_to_string(&a[2]).unwrap();match windows_manifest::render(&s,&a[1]){Ok(v)=>print!("{}",v),Err(e)=>{eprintln!("{}",e);std::process::exit(1);}}}`;
    writeFileSync(join(folder, 'probe.rs'), harness);
    execFileSync('rustc', ['--edition=2021', join(folder, 'probe.rs'), '-o', binary]);
  }
  const input = join(folder, 'input.xml'); writeFileSync(input, source);
  return spawnSync(binary, [architecture, input], { encoding: 'utf8' });
}
const source = readFileSync(resolve(root, 'src-tauri/windows-app.manifest'), 'utf8');
test('x64 assembly manifest remains byte-for-byte compatible', () => {
  const r = run('x86_64', source); assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, source);
});
test('ARM assembly identity matches native executable and preserves security/DPI declarations', () => {
  const r = run('aarch64', source); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /name="LyricalSync" version="0\.7\.1\.0" processorArchitecture="arm64"/);
  assert.match(r.stdout, /Common-Controls[^\n]+processorArchitecture="\*"/);
  assert.match(r.stdout, /PerMonitorV2/); assert.doesNotMatch(r.stdout, /requireAdministrator/);
});
test('unsupported target cannot produce a misleading assembly manifest', () => {
  const r = run('x86', source); assert.notEqual(r.status, 0); assert.match(r.stderr, /architecture/i); assert.equal(r.stdout, '');
});
test('an incompatible manifest template fails closed', () => {
  const r = run('aarch64', '<assembly/>'); assert.notEqual(r.status, 0); assert.match(r.stderr, /template/i); assert.equal(r.stdout, '');
});
