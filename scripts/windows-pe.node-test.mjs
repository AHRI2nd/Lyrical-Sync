import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function check(t, machine, architecture) {
  const module = new URL('./windows-pe.mjs', import.meta.url);
  assert.ok(existsSync(module), 'Architecture-aware Windows PE checker is missing');
  const { assertMachine } = await import(module);
  const folder = mkdtempSync(join(tmpdir(), 'store-pe-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const bytes = Buffer.alloc(256); bytes.write('MZ'); bytes.writeUInt32LE(128, 60);
  bytes.write('PE\0\0', 128); bytes.writeUInt16LE(machine, 132);
  const file = join(folder, 'app.exe'); writeFileSync(file, bytes);
  return () => assertMachine(file, architecture);
}
for (const [arch, machine] of [['x64', 0x8664], ['arm64', 0xaa64]]) {
  test(`accepts actual ${arch} PE machine`, async t => assert.equal((await check(t, machine, arch))(), machine));
  test(`rejects foreign PE machine in ${arch} payload`, async t => assert.throws(await check(t, arch === 'x64' ? 0xaa64 : 0x8664, arch), /architecture/i));
}
test('rejects unsupported architecture instead of accepting an arbitrary machine', async t => assert.throws(await check(t, 0x8664, 'ia32'), /architecture/i));
test('rejects an unrecognized PE machine', async t => assert.throws(await check(t, 0, 'x64'), /architecture/i));
