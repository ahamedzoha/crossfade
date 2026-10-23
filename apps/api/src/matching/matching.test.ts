import { describe, expect, it } from 'vitest';
import { artistKey, parseTitle } from './normalize.js';
import { sameRecording, scoreMatch } from './score.js';

describe('parseTitle', () => {
  it('strips remaster and feat noise but keeps the base title', () => {
    expect(parseTitle('Dreams - 2004 Remaster').key).toBe('dreams');
    expect(parseTitle('Dreams (Remastered)').key).toBe('dreams');
    expect(parseTitle('Instant Crush (feat. Julian Casablancas)').key).toBe('instant crush');
    expect(parseTitle('Pink + White').key).toBe('pink and white');
  });

  it('keeps version tags that change the recording', () => {
    expect(parseTitle('Dreams (Live)').versionTag).toBe('live');
    expect(parseTitle('Teardrop - Acoustic').versionTag).toBe('acoustic');
    expect(parseTitle('Midnight City (Eric Prydz Remix)').versionTag).toBe('remix:eric prydz remix');
    expect(parseTitle('Dreams - 2004 Remaster').versionTag).toBeNull();
  });

  it('handles YouTube "Artist - Title (Official Video)" titles', () => {
    const p = parseTitle('M83 - Midnight City (Official Video)', ['M83']);
    expect(p.key).toBe('midnight city');
    expect(p.versionTag).toBeNull();
  });

  it('folds accents and punctuation', () => {
    expect(parseTitle('Café del Mar').key).toBe('cafe del mar');
    expect(parseTitle("Don't Stop Me Now").key).toBe('dont stop me now');
  });
});

describe('artistKey', () => {
  it('derives the same primary artist from every provider format', () => {
    expect(artistKey(['Simon & Garfunkel'])).toBe('simon');
    expect(artistKey(['Daft Punk', 'Julian Casablancas'])).toBe('daft punk');
    expect(artistKey(['Daft Punk & Julian Casablancas'])).toBe('daft punk');
    expect(artistKey(['The Weeknd'])).toBe('weeknd');
  });
});

describe('scoreMatch', () => {
  const target = { title: 'Redbone', artists: ['Childish Gambino'], durationMs: 326_000 };

  it('scores ISRC equality as certain', () => {
    expect(scoreMatch({ ...target, isrc: 'USYAH1600107' }, { title: 'x', artists: ['y'], isrc: 'usyah1600107' }).score).toBe(1);
  });

  it('scores a clean match high', () => {
    expect(scoreMatch(target, { title: 'Redbone', artists: ['Childish Gambino'], durationMs: 327_000 }).score).toBeGreaterThan(0.95);
  });

  it('penalises a live version and a wrong artist', () => {
    const live = scoreMatch(target, { title: 'Redbone (Live)', artists: ['Childish Gambino'], durationMs: 330_000 }).score;
    const cover = scoreMatch(target, { title: 'Redbone', artists: ['Some Cover Band'], durationMs: 300_000 }).score;
    expect(live).toBeLessThan(0.85);
    expect(cover).toBeLessThan(0.85);
  });
});

describe('sameRecording', () => {
  it('treats a remaster with a close duration as the same song', () => {
    const a = { title: 'Dreams', artists: ['Fleetwood Mac'], durationMs: 254_000 };
    const b = { title: 'Dreams - 2004 Remaster', artists: ['Fleetwood Mac'], durationMs: 257_000 };
    expect(sameRecording(a, b, 'strict')).toBe(true);
  });

  it('never folds live into studio', () => {
    const a = { title: 'Dreams', artists: ['Fleetwood Mac'], durationMs: 254_000 };
    const b = { title: 'Dreams (Live)', artists: ['Fleetwood Mac'], durationMs: 255_000 };
    expect(sameRecording(a, b, 'loose')).toBe(false);
  });

  it('strict mode respects very different lengths, loose ignores them', () => {
    const a = { title: 'Song', artists: ['A'], durationMs: 200_000 };
    const b = { title: 'Song', artists: ['A'], durationMs: 400_000 };
    expect(sameRecording(a, b, 'strict')).toBe(false);
    expect(sameRecording(a, b, 'loose')).toBe(true);
  });
});
