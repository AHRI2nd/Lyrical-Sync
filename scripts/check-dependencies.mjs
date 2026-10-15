import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Inspect actual package manifests rather than npm's potentially stale install cache.
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
try {
  const manifest = readJson('package.json');
  const lock = readJson('package-lock.json');
  const problems = [];
  for (const section of ['dependencies', 'devDependencies']) {
    const declared = manifest[section] ?? {};
    const locked = lock.packages?.['']?.[section] ?? {};
    if (JSON.stringify(Object.entries(declared).sort()) !== JSON.stringify(Object.entries(locked).sort())) {
      problems.push(`${section}: package.json and package-lock.json disagree`);
    }
    for (const name of Object.keys(declared)) {
      const expected = lock.packages?.[`node_modules/${name}`]?.version;
      if (!expected) { problems.push(`${name}: missing package-lock.json entry`); continue; }
      try {
        const actual = readJson(join('node_modules', name, 'package.json')).version;
        if (actual !== expected) problems.push(`${name}: installed ${actual}, expected ${expected}`);
      } catch { problems.push(`${name}: missing or unreadable installed package`); }
    }
  }
  if (problems.length) {
    console.error(`Dependencies do not match the current branch:\n${problems.map(p => `  - ${p}`).join('\n')}\nRun npm ci before restarting the app. Use npm ci --offline when the packages are cached.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Cannot verify dependencies: ${error.message}\nRestore package.json/package-lock.json and run npm ci.`);
  process.exitCode = 1;
}
