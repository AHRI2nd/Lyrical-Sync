import { expect, it } from 'vitest';
import { translations } from './translations';
import { SPOTIFY_REDIRECT_URI } from '../utils/spotifyAuth';

it('keeps the supported language dictionaries in parity', () => {
  const expected = Object.keys(translations.ko).sort();
  expect(Object.keys(translations.en).sort()).toEqual(expected);
  expect(Object.keys(translations.ja).sort()).toEqual(expected);
});

it('keeps Spotify settings labels translated in all supported languages', () => {
  for (const lang of ['ko', 'en', 'ja'] as const) {
    const t = translations[lang];
    expect(t.spotifyModeToggle).toBeTruthy();
    expect(t.spotifyModeActive).toBeTruthy();
    expect(t.spotifyModeLocal).toBeTruthy();
    expect(t.spotifyConnectFirst).toBeTruthy();
  }
  expect(translations.en.spotifyModeActive).not.toMatch(/[가-힣]/);
  expect(translations.ja.spotifyModeLocal).not.toMatch(/[가-힣]/);
});

it('keeps Spotify setup text aligned with the runtime redirect URI', () => {
  for (const lang of ['ko', 'en', 'ja'] as const) {
    expect(translations[lang].spotifyClientIdDesc).toContain(SPOTIFY_REDIRECT_URI);
    expect(JSON.stringify(translations[lang].helpSpotifySteps)).toContain(SPOTIFY_REDIRECT_URI);
    expect(JSON.stringify(translations[lang])).not.toContain('54321');
    expect(JSON.stringify(translations[lang])).not.toContain('lyricsync://callback');
  }
});
