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
