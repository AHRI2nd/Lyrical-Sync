import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = file => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
try {
  const inventory = JSON.parse(readFileSync(resolve(root, 'packaging/licenses/inventory.json'), 'utf8'));
  if (inventory.schema !== 1 || !inventory.components.length || !Object.keys(inventory.inputs).length) throw new Error('Invalid notice inventory');
  for (const [file, expected] of Object.entries(inventory.inputs)) {
    if (hash(file) !== expected) throw new Error(`Stale notices: ${file} changed. Run npm run licenses:generate.`);
  }
  if (hash('src-tauri/ThirdPartyNotices.txt') !== inventory.noticeSha256) throw new Error('Notice payload hash mismatch. Run npm run licenses:generate.');
  console.log(`License notices verified: ${inventory.components.length} components`);
} catch (error) { console.error(`License notice check failed: ${error.message}`); process.exitCode = 1; }
