import test from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStoreBoundaries, sha256 } from './check-store-boundaries.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'store-boundaries-'));
  const put = (path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
  const app = 'export const local = true;';
  const native = '#[tauri::command]\nfn read_local() {}';
  put('src/App.tsx', app); put('src-tauri/src/lib.rs', native);
  put('package.json', JSON.stringify({ dependencies: { react: '19' }, devDependencies: {} }));
  put('entitlements.plist', '<sandbox>true</sandbox>');
  const policy = { sourceInventory: ['src/App.tsx', 'src-tauri/src/lib.rs'], excludedPaths: ['src/Service.ts'],
    dependencies: ['react'], devDependencies: [], nativeCommands: ['read_local'], protectedFiles: { 'entitlements.plist': sha256('<sandbox>true</sandbox>') } };
  try { run({ root, put, policy, app, native }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('accepts the reviewed local-only Store baseline', () => fixture(({ root, policy }) => assert.deepEqual(checkStoreBoundaries(root, policy), [])));
test('rejects newly merged source until explicitly reviewed', () => fixture(({ root, put, policy }) => {
  put('src/new-feature.ts', 'export const feature = true;');
  assert.match(checkStoreBoundaries(root, policy).join('\n'), /Unreviewed Store source/);
}));
test('rejects excluded paths even when added to the inventory', () => fixture(({ root, put, policy }) => {
  put('src/Service.ts', 'export {};'); policy.sourceInventory.push('src/Service.ts');
  assert.match(checkStoreBoundaries(root, policy).join('\n'), /Excluded direct-edition path restored/);
}));
test('rejects updater imports in an existing shared source', () => fixture(({ root, put, policy }) => {
  put('src/App.tsx', 'const plugin = import("@tauri-apps/plugin-updater");');
  assert.match(checkStoreBoundaries(root, policy).join('\n'), /Excluded integration import/);
}));
test('rejects direct remote runtime calls in existing source', () => fixture(({ root, put, policy }) => {
  put('src/App.tsx', 'fetch("https://example.com/code.js");');
  assert.match(checkStoreBoundaries(root, policy).join('\n'), /Remote runtime access/);
}));
test('rejects unreviewed dependencies', () => fixture(({ root, put, policy }) => {
  put('package.json', JSON.stringify({ dependencies: { react: '19', '@tauri-apps/plugin-updater': '2' } }));
  assert.match(checkStoreBoundaries(root, policy).join('\n'), /Unreviewed dependencies/);
}));
test('rejects altered sandbox and platform contracts', () => fixture(({ root, put, policy }) => {
  put('entitlements.plist', '<sandbox>false</sandbox>');
  assert.match(checkStoreBoundaries(root, policy).join('\n'), /platform contract changed/);
}));
test('rejects new native commands and external process execution', () => fixture(({ root, put, policy, native }) => {
  put('src-tauri/src/lib.rs', native + '\n#[tauri::command]\nasync fn install_code() { Command::new("python"); }');
  const problems = checkStoreBoundaries(root, policy).join('\n');
  assert.match(problems, /Unreviewed native command: install_code/); assert.match(problems, /Excluded native execution/);
}));
test('rejects deletion of reviewed Store sources', () => fixture(({ root, policy }) => {
  rmSync(join(root, 'src/App.tsx'));
  assert.match(checkStoreBoundaries(root, policy).join('\n'), /Reviewed Store source removed/);
}));

test('protects the shipped public runtime script against unreviewed changes', () => fixture(({ root, put, policy }) => {
  const shippedPolicy = JSON.parse(readFileSync(new URL('../config/store-boundaries.json', import.meta.url), 'utf8'));
  const path = 'public/runtime-errors.js';
  put(path, readFileSync(new URL('../public/runtime-errors.js', import.meta.url)));
  if (shippedPolicy.protectedFiles[path]) policy.protectedFiles[path] = shippedPolicy.protectedFiles[path];
  assert.deepEqual(checkStoreBoundaries(root, policy), []);
  put(path, 'fetch("https://example.com/runtime.js");');
  assert.match(checkStoreBoundaries(root, policy).join('\n'), /platform contract changed: public\/runtime-errors\.js/);
}));

test('keeps the protected public script unchanged under Windows checkout conversion', () => fixture(({ root, put, policy }) => {
  const path = 'public/runtime-errors.js';
  const shippedPolicy = JSON.parse(readFileSync(new URL('../config/store-boundaries.json', import.meta.url), 'utf8'));
  policy.protectedFiles[path] = shippedPolicy.protectedFiles[path];
  put('.gitattributes', readFileSync(new URL('../.gitattributes', import.meta.url)));
  put(path, readFileSync(new URL('../public/runtime-errors.js', import.meta.url)));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', ...args], { stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '.gitattributes', path);
  rmSync(join(root, path));
  git('checkout-index', '--all', '--force');
  assert.deepEqual(checkStoreBoundaries(root, policy), []);
}));

test('keeps every protected platform file byte-identical under Windows checkout conversion', () => fixture(({ root, put, policy }) => {
  const shipped = JSON.parse(readFileSync(new URL('../config/store-boundaries.json', import.meta.url), 'utf8'));
  policy.protectedFiles = shipped.protectedFiles;
  put('.gitattributes', readFileSync(new URL('../.gitattributes', import.meta.url)));
  for (const path of Object.keys(policy.protectedFiles)) put(path, readFileSync(new URL('../' + path, import.meta.url)));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.autocrlf=true', '-c', 'core.eol=crlf', ...args], { stdio: 'pipe' });
  git('init', '--quiet'); git('add', '.gitattributes', ...Object.keys(policy.protectedFiles));
  for (const path of Object.keys(policy.protectedFiles)) rmSync(join(root, path));
  git('checkout-index', '--all', '--force');
  assert.deepEqual(checkStoreBoundaries(root, policy), []);
}));
