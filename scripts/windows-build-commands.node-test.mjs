import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const cli = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const commands = Object.entries(pkg.scripts)
  .filter(([name]) => name.startsWith('build:windows-'))
  .map(([name, command]) => [name, command.replace(/^tauri build /, '')]);
for (const workflow of ['build.yml', 'release.yml']) {
  const source = readFileSync(resolve(root, '.github/workflows', workflow), 'utf8');
  for (const [index, match] of [...source.matchAll(/^\s+args: (.+)$/gm)].entries()) {
    commands.push([`${workflow} build ${index}`, match[1]
      .replaceAll('${{ matrix.target }}', 'aarch64-pc-windows-msvc')
      .replaceAll('${{ matrix.bundleArgs }}', '--bundles nsis')]);
  }
}
for (const [name, command] of commands) {
  test(`${name} is accepted by the installed Tauri build parser`, () => {
    const args = command.trim().split(/\s+/);
    const separator = args.indexOf('--');
    args.splice(separator < 0 ? args.length : separator, 0, '--help');
    const result = spawnSync(process.execPath, [cli, 'build', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--target/);
  });
}
