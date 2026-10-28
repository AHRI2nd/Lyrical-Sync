import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function stripRustTestModules(source) {
  const lines = source.split('\n');
  const production = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^#\[cfg\((?:test|all\(test,[^\]]+\))\)\]$/.test(lines[index].trim()) &&
        /^\s*mod\s+\w+\s*\{/.test(lines[index + 1] ?? '')) {
      index++;
      while (index + 1 < lines.length && lines[index + 1] !== '}') index++;
      index++;
      continue;
    }
    production.push(lines[index]);
  }
  return production.join('\n');
}

/** Check the reviewed Store source and platform contract, without changing files. */
export function checkStoreBoundaries(root, policy) {
  root = resolve(root);
  policy ??= JSON.parse(readFileSync(resolve(root, 'config/store-boundaries.json'), 'utf8'));
  const problems = [];
  const sources = [];
  const walk = dir => {
    if (!existsSync(resolve(root, dir))) return;
    for (const entry of readdirSync(resolve(root, dir))) {
      const path = `${dir}/${entry}`;
      const stat = lstatSync(resolve(root, path));
      if (stat.isSymbolicLink()) problems.push(`Unreviewed source symlink: ${path}`);
      else if (stat.isDirectory()) walk(path);
      else sources.push(path);
    }
  };
  for (const dir of ['src', 'src-tauri/src']) walk(dir);
  const reviewed = new Set(policy.sourceInventory);
  const actual = new Set(sources);
  for (const path of sources) if (!reviewed.has(path)) problems.push(`Unreviewed Store source: ${path}`);
  for (const path of reviewed) if (!actual.has(path)) problems.push(`Reviewed Store source removed: ${path}`);
  for (const path of policy.excludedPaths) {
    if (existsSync(resolve(root, path))) problems.push(`Excluded direct-edition path restored: ${path}`);
  }
  for (const [path, expected] of Object.entries(policy.protectedFiles)) {
    if (!existsSync(resolve(root, path)) || sha256(readFileSync(resolve(root, path))) !== expected) {
      problems.push(`Store platform contract changed: ${path}`);
    }
  }
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    const names = Object.keys(pkg[section] ?? {});
    const allowed = new Set(policy[section]);
    for (const name of names) if (!allowed.has(name)) problems.push(`Unreviewed ${section}: ${name}`);
    for (const name of allowed) if (!names.includes(name)) problems.push(`Required ${section} removed: ${name}`);
  }
  const bannedImport = /@tauri-apps\/plugin-(?:updater|process|shell|deep-link|http|opener)(?:\b|\/)|(?:^|\/)(?:Service|LrcLib|Update)(?:\/|$)|(?:useUpdaterStore|useServiceStore|useDeviceStore|serviceControls|deviceControls|modelDefs|spotifyAuth|spotifyPlayer)/;
  const commands = new Set();
  for (const path of sources) {
    if (!/\.(?:[cm]?jsx?|tsx?|rs)$/.test(path) || /\.test\./.test(path)) continue;
    let text = readFileSync(resolve(root, path), 'utf8');
    // Rust unit-test modules are compiled only for tests and may invoke host tools.
    // Keep the production boundary scan focused on code that ships in the Store app.
    if (path.endsWith('.rs')) text = stripRustTestModules(text);
    for (const match of text.matchAll(/(?:from\s*|import\s*(?:\(|)|require\s*\()\s*["']([^"']+)["']/g)) {
      if (bannedImport.test(match[1])) problems.push(`Excluded integration import in ${path}: ${match[1]}`);
    }
    if (/fetch\s*\(\s*["'`]https?:\/\/|new\s+(?:WebSocket|EventSource)\s*\(|import\s*\(\s*["'`]https?:\/\//.test(text)) {
      problems.push(`Remote runtime access introduced: ${path}`);
    }
    if (/\b(?:std::process::Command|Command::new|reqwest::|ureq::|tauri_plugin_(?:updater|shell|http|deep_link))/.test(text)) {
      problems.push(`Excluded native execution or network API: ${path}`);
    }
    if (path.endsWith('.rs')) for (const match of text.matchAll(/#\[tauri::command[^\]]*\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g)) commands.add(match[1]);
  }
  const allowedCommands = new Set(policy.nativeCommands);
  for (const name of commands) if (!allowedCommands.has(name)) problems.push(`Unreviewed native command: ${name}`);
  for (const name of allowedCommands) if (!commands.has(name)) problems.push(`Required native command removed: ${name}`);
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  try {
    const problems = checkStoreBoundaries(root);
    if (problems.length) {
      console.error(`Store boundary review required:\n${problems.map(p => `  - ${p}`).join('\n')}\nResolve edition changes before updating the reviewed policy. See MERGING.md.`);
      process.exitCode = 1;
    } else console.log(`Store boundary checks passed (${relative(process.cwd(), root) || '.'}).`);
  } catch (error) { console.error(`Store boundary check failed: ${error.message}`); process.exitCode = 1; }
}
