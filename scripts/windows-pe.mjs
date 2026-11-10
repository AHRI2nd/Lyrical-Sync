import { openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function expectedMachine(architecture) {
  const expected = { x64: 0x8664, arm64: 0xaa64 }[architecture];
  if (expected === undefined) throw new Error(`Unsupported Windows architecture: ${architecture}`);
  return expected;
}

function readAt(fd, buffer, position) {
  let total = 0;
  while (total < buffer.length) {
    const count = readSync(fd, buffer, total, buffer.length - total, position + total);
    if (count === 0) break;
    total += count;
  }
  return total;
}

/** Read only PE headers; runtime DLLs may be hundreds of megabytes. */
function readPeMachine(file) {
  const fd = openSync(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    const dosBytes = readAt(fd, dos, 0);
    if (dosBytes < 2 || dos.toString('ascii', 0, 2) !== 'MZ') return null;
    if (dosBytes < dos.length) throw new Error(`Invalid PE DOS header: ${file}`);

    const offset = dos.readUInt32LE(60);
    const header = Buffer.alloc(6);
    if (readAt(fd, header, offset) !== header.length || header.toString('ascii', 0, 4) !== 'PE\0\0') {
      throw new Error(`Invalid PE header: ${file}`);
    }
    return header.readUInt16LE(4);
  } finally {
    closeSync(fd);
  }
}

/** Validate a required executable's real machine field, not its filename or host CPU. */
export function assertMachine(file, architecture) {
  const expected = expectedMachine(architecture);
  const machine = readPeMachine(file);
  if (machine === null) throw new Error(`Invalid PE executable: ${file}`);
  if (machine !== expected) throw new Error(`Executable architecture must be ${architecture}: ${file}`);
  return machine;
}

/** Validate a runtime payload file if it is PE; leave non-PE resources untouched. */
export function assertOptionalMachine(file, architecture) {
  const expected = expectedMachine(architecture);
  const machine = readPeMachine(file);
  if (machine === null) return null;
  if (machine !== expected) throw new Error(`Runtime PE architecture must be ${architecture}: ${file}`);
  return machine;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const machine = assertMachine(process.argv[2], process.argv[3]);
    console.log(`Verified ${process.argv[3]} PE: 0x${machine.toString(16)}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
