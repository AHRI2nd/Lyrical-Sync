import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Catches signing a mismatched, expired or development provisioning profile.
function fixture(t, change = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'appstore-profile-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profile = join(dir, 'profile.plist');
  const certificate = Buffer.from('test distribution certificate DER');
  const fingerprint = createHash('sha1').update(certificate).digest('hex').toUpperCase();
  const identities = join(dir, 'identities.txt');
  writeFileSync(identities, `  1) ${fingerprint} \"Apple Distribution: Test (7N6XWH2333)\"\n  2) ${'0'.repeat(40)} \"3rd Party Mac Developer Installer: Test (7N6XWH2333)\"\n  3) ${'1'.repeat(40)} \"Apple Development: Test (7N6XWH2333)\"\n  4) ${'2'.repeat(40)} \"Developer ID Installer: Test (7N6XWH2333)\"\n`);
  const payload = { DeveloperCertificates: [certificate.toString('base64')], ExpirationDate: '2099-01-01T00:00:00Z', TeamIdentifier: ['7N6XWH2333'], Entitlements: { 'com.apple.application-identifier': '7N6XWH2333.com.arisair.lyrical-sync', 'com.apple.developer.team-identifier': '7N6XWH2333' }, ...change };
  const py = spawnSync('python3', ['-c', 'import json,plistlib,sys,datetime,base64; p=json.loads(sys.argv[1]); p["DeveloperCertificates"]=[base64.b64decode(c) for c in p["DeveloperCertificates"]]; p["ExpirationDate"]=datetime.datetime.fromisoformat(p["ExpirationDate"].replace("Z","")); plistlib.dump(p,open(sys.argv[2],"wb"))', JSON.stringify(payload), profile], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const output = join(dir, 'entitlements.plist');
  const run = (extra = []) => spawnSync('python3', [resolve('scripts/appstore-profile.py'), '--profile', profile, '--bundle-id', 'com.arisair.lyrical-sync', '--template', resolve('src-tauri/entitlements.plist'), '--output', output, '--identities', identities, '--signing-identity', fingerprint, ...extra], { encoding: 'utf8' });
  return { output, run, identities };
}
test('derives signed identifiers from a matching distribution profile and enables bookmarks', t => {
  const f = fixture(t); const r = f.run(); assert.equal(r.status, 0, r.stderr);
  const p = spawnSync('python3', ['-c', 'import plistlib,json,sys; print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', f.output], { encoding: 'utf8' });
  const entitlements = JSON.parse(p.stdout);
  assert.equal(entitlements['com.apple.application-identifier'], '7N6XWH2333.com.arisair.lyrical-sync');
  assert.equal(entitlements['com.apple.security.app-sandbox'], true);
  assert.equal(entitlements['com.apple.security.files.bookmarks.app-scope'], true);
  assert.equal(entitlements['com.apple.security.network.client'], undefined);
});
test('rejects an expired profile', t => {
  const f = fixture(t, { ExpirationDate: '2000-01-01T00:00:00Z' }); const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /expired/i);
});
test('rejects another app bundle identity', t => {
  const f = fixture(t, { Entitlements: { 'com.apple.application-identifier': '7N6XWH2333.other.app', 'com.apple.developer.team-identifier': '7N6XWH2333' } });
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /identifier|bundle/i);
});
test('rejects development profiles with get-task-allow', t => {
  const f = fixture(t, { Entitlements: { 'com.apple.application-identifier': '7N6XWH2333.com.arisair.lyrical-sync', 'com.apple.developer.team-identifier': '7N6XWH2333', 'get-task-allow': true } });
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /development/i);
});
test('rejects a profile whose declared team and entitlement disagree', t => {
  const f = fixture(t, { TeamIdentifier: ['OTHERTEAM'] }); const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /team/i);
});

test('rejects a same-team development certificate explicitly selected for Store signing', t => {
  const f = fixture(t); const r = f.run(['--signing-identity', '1'.repeat(40)]); assert.notEqual(r.status, 0); assert.match(r.stderr, /distribution certificate/i);
});
test('rejects a distribution certificate absent from the profile', t => {
  const f = fixture(t, { DeveloperCertificates: [Buffer.from('other DER').toString('base64')] });
  const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /certificate.*profile|profile.*certificate/i);
});
test('rejects a Developer ID installer certificate for an App Store PKG', t => {
  const f = fixture(t); const r = f.run(['--installer-identity', '2'.repeat(40)]); assert.notEqual(r.status, 0); assert.match(r.stderr, /installer.*certificate/i);
});
