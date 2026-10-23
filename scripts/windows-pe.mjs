import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Validate the real machine field, independently of file names and host CPU. */
export function assertMachine(file, architecture) {
  const expected = { x64: 0x8664, arm64: 0xaa64 }[architecture];
  if (expected === undefined) throw new Error(`Unsupported Windows architecture: ${architecture}`);
  const bytes = readFileSync(file);
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Invalid PE executable: ${file}`);
  const offset = bytes.readUInt32LE(60);
  if (offset + 6 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0') throw new Error(`Invalid PE header: ${file}`);
  const machine = bytes.readUInt16LE(offset + 4);
  if (machine !== expected) throw new Error(`Executable architecture must be ${architecture}: ${file}`);
  return machine;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const machine = assertMachine(process.argv[2], process.argv[3]);
    console.log(`Verified ${process.argv[3]} PE: 0x${machine.toString(16)}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
