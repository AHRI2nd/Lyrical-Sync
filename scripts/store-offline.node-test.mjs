import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('loads only bundled scripts and styles in the Store entry point', () => {
  const window = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8')).window;
  try {
    const resources = Array.from(window.document.querySelectorAll('script[src],link[href]'))
      .map(node => node.getAttribute('src') ?? node.getAttribute('href'));
    assert.ok(resources.length > 0);
    for (const url of resources) assert.match(url, /^\/(?!\/)/);
  } finally { window.close(); }
});

test('Windows runtime keeps SmartScreen protection and audio playback defaults', () => {
  const base = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  const window = base.app.windows[0];
  assert.equal(typeof window.additionalBrowserArgs, 'string');
  const flags = window.additionalBrowserArgs.split(/\s+/);
  const disabled = flags.find(flag => flag.startsWith('--disable-features='))?.split('=')[1].split(',') ?? [];
  assert.deepEqual(disabled.sort(), ['msPdfOOUI', 'msWebOOUI']);
  assert.ok(flags.includes('--autoplay-policy=no-user-gesture-required'));
  assert.equal(flags.some(flag => /smartscreen|ignore-certificate|disable-web-security|no-sandbox/i.test(flag)), false);
  assert.deepEqual([window.width, window.height, window.minWidth, window.minHeight], [1200, 800, 900, 600]);
  for (const platform of ['windows', 'msstore']) {
    const overlay = JSON.parse(readFileSync(new URL(`../src-tauri/tauri.${platform}.conf.json`, import.meta.url)));
    assert.equal(overlay.app?.windows, undefined, 'Platform overlays must preserve the main window security configuration');
  }
});

test('Windows executable declares per-monitor DPI awareness without elevation', () => {
  const xml = readFileSync(new URL('../src-tauri/windows-app.manifest', import.meta.url), 'utf8');
  const window = new JSDOM(xml, { contentType: 'application/xml' }).window;
  try {
    const doc = window.document;
    assert.equal(doc.getElementsByTagNameNS('http://schemas.microsoft.com/SMI/2016/WindowsSettings', 'dpiAwareness')[0]?.textContent, 'PerMonitorV2');
    assert.equal(doc.getElementsByTagNameNS('http://schemas.microsoft.com/SMI/2005/WindowsSettings', 'dpiAware')[0]?.textContent, 'true/pm');
    const controls = doc.getElementsByTagNameNS('urn:schemas-microsoft-com:asm.v1', 'assemblyIdentity')[0];
    assert.equal(controls?.getAttribute('name'), 'Microsoft.Windows.Common-Controls');
    assert.equal(controls?.getAttribute('version'), '6.0.0.0');
    assert.equal(doc.querySelector('requestedExecutionLevel')?.getAttribute('level') ?? 'asInvoker', 'asInvoker');
  } finally { window.close(); }
});
