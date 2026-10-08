import { readFileSync, writeFileSync, mkdirSync, lstatSync, readdirSync, copyFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function requireValue(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error(`Missing or invalid ${key}`);
  return value;
}
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Expected --key value arguments');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}
function appVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('App version must be a stable three-part SemVer');
  const [major, minor, patch] = version.split('.').map(Number);
  if (major > 65534 || minor > 65535 || patch > 65535) throw new Error('MSIX version components overflow');
  return `${major + 1}.${minor}.${patch}.0`;
}
function osVersion(value) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) throw new Error('Invalid Windows version');
  const parts = value.split('.').map(Number);
  if (parts.some(n => n > 65535)) throw new Error('Windows version component overflow');
  return parts;
}
function atLeast(actual, minimum) {
  for (let i = 0; i < 4; i++) { if (actual[i] !== minimum[i]) return actual[i] > minimum[i]; }
  return true;
}
function xml(value) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]); }
function x64(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Invalid PE executable: ${file}`);
  const pe = bytes.readUInt32LE(60);
  if (pe + 6 > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0' || bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error(`Executable architecture must be x64: ${file}`);
}
function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
function sourceFiles(root) {
  const files = [];
  function visit(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Runtime symlink is not allowed: ${path}`);
    if (stat.isDirectory()) { for (const name of readdirSync(path).sort()) visit(join(path, name)); }
    else if (stat.isFile()) files.push(path);
    else throw new Error(`Unsupported runtime entry: ${path}`);
  }
  visit(root); return files;
}
function png(file, width, height) {
  const b = readFileSync(file);
  if (b.length < 24 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || b.toString('ascii', 12, 16) !== 'IHDR' || b.readUInt32BE(16) !== width || b.readUInt32BE(20) !== height) throw new Error(`Invalid PNG dimensions for ${file}: expected ${width}x${height}`);
}
try {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(readFileSync(requireValue(args, 'config'), 'utf8'));
  for (const field of ['name', 'publisher', 'publisherDisplayName', 'minVersion']) requireValue(config, field);
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(config.name)) throw new Error('Invalid package identity name');
  if (!config.publisher.startsWith('CN=') || config.publisher.length > 8192 || /[\r\n]/.test(config.publisher)) throw new Error('Invalid publisher identity');
  const version = appVersion(requireValue(args, 'app-version'));
  const tested = requireValue(args, 'max-version-tested');
  if (!atLeast(osVersion(tested), osVersion(config.minVersion))) throw new Error('Tested Windows version is below package minimum');
  const binary = realpathSync(requireValue(args, 'binary'));
  const runtime = realpathSync(requireValue(args, 'runtime'));
  const assets = realpathSync(requireValue(args, 'assets'));
  const stage = resolve(requireValue(args, 'stage'));
  if (existsSync(stage)) throw new Error('Staging path already exists; refusing to overwrite it');
  mkdirSync(dirname(stage), { recursive: true });
  const canonicalStage = join(realpathSync(dirname(stage)), stage.split(sep).at(-1));
  for (const source of [runtime, assets, binary]) {
    if (isWithin(source, canonicalStage) || isWithin(canonicalStage, source)) throw new Error('Staging path overlaps an input source');
  }
  x64(binary); x64(join(runtime, 'msedgewebview2.exe'));
  const runtimeFiles = sourceFiles(runtime);
  const logos = [['StoreLogo.png', 50, 50], ['Square44x44Logo.png', 44, 44], ['Square150x150Logo.png', 150, 150]];
  for (const [name, w, h] of logos) png(join(assets, name), w, h);
  const values = { NAME: config.name, PUBLISHER: config.publisher, PUBLISHER_DISPLAY_NAME: config.publisherDisplayName, VERSION: version, MIN_VERSION: config.minVersion, MAX_VERSION_TESTED: tested };
  let manifest = readFileSync(join(repo, 'packaging/msix/AppxManifest.xml.in'), 'utf8');
  manifest = manifest.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => { if (!(key in values)) throw new Error(`Unresolved manifest value ${key}`); return xml(values[key]); });
  if (/\{\{|\}\}/.test(manifest)) throw new Error('Unresolved manifest template');
  mkdirSync(stage); mkdirSync(join(stage, 'Assets'));
  copyFileSync(binary, join(stage, 'lyrical-sync.exe'));
  for (const [name] of logos) copyFileSync(join(assets, name), join(stage, 'Assets', name));
  for (const file of runtimeFiles) { const target = join(stage, 'WebView2', relative(runtime, file)); mkdirSync(dirname(target), { recursive: true }); copyFileSync(file, target); }
  copyFileSync(join(repo, 'LICENSE'), join(stage, 'AppLicense.txt'));
  writeFileSync(join(stage, 'AppxManifest.xml'), manifest);
  const inventory = sourceFiles(stage).map(file => ({ path: relative(stage, file).split(sep).join('/'), sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }));
  process.stdout.write(JSON.stringify({ version, identity: config, architecture: 'x64', maxVersionTested: tested, files: inventory }, null, 2) + '\n');
} catch (error) { console.error(`MSIX staging failed: ${error.message}`); process.exitCode = 1; }
