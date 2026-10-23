import type { PlaylistDetail } from '@crossfade/shared';

export type ExportFormat = 'json' | 'csv' | 'jspf' | 'm3u';

export const EXPORT_TYPES: Record<ExportFormat, { mime: string; ext: string }> = {
  json: { mime: 'application/json', ext: 'json' },
  csv: { mime: 'text/csv; charset=utf-8', ext: 'csv' },
  jspf: { mime: 'application/jspf+json', ext: 'jspf' },
  m3u: { mime: 'audio/x-mpegurl; charset=utf-8', ext: 'm3u' },
};

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderExport(p: PlaylistDetail, format: ExportFormat): string {
  const rows = p.entries;
  switch (format) {
    case 'json':
      return JSON.stringify(
        {
          id: p.id,
          name: p.name,
          description: p.description,
          trackCount: rows.length,
          exportedAt: new Date().toISOString(),
          tracks: rows.map((e, i) => ({
            position: i + 1,
            title: e.track.title,
            artists: e.track.artists,
            album: e.track.album,
            durationMs: e.track.durationMs,
            isrc: e.track.isrc,
            links: Object.fromEntries(e.track.links.map((l) => [l.provider, { id: l.id, url: l.url }])),
          })),
        },
        null,
        2,
      );
    case 'csv': {
      const head = ['position', 'title', 'artists', 'album', 'duration_ms', 'isrc', 'spotify', 'ytmusic', 'apple'];
      const lines = rows.map((e, i) => {
        const link = (p: string) => e.track.links.find((l) => l.provider === p)?.url ?? '';
        return [i + 1, e.track.title, e.track.artists.join('; '), e.track.album, e.track.durationMs, e.track.isrc, link('spotify'), link('ytmusic'), link('apple')]
          .map(csvCell)
          .join(',');
      });
      return [head.join(','), ...lines].join('\n') + '\n';
    }
    case 'jspf':
      return JSON.stringify(
        {
          playlist: {
            title: p.name,
            annotation: p.description ?? undefined,
            date: new Date().toISOString(),
            creator: 'Crossfade',
            track: rows.map((e) => ({
              title: e.track.title,
              creator: e.track.artists.join(', '),
              album: e.track.album ?? undefined,
              duration: e.track.durationMs ?? undefined,
              identifier: e.track.links.map((l) => l.url).filter(Boolean),
              ...(e.track.isrc ? { meta: [{ 'https://musicbrainz.org/doc/ISRC': e.track.isrc }] } : {}),
            })),
          },
        },
        null,
        2,
      );
    case 'm3u': {
      const lines = ['#EXTM3U', `#PLAYLIST:${p.name}`];
      for (const e of rows) {
        const url = e.track.links[0]?.url;
        if (!url) continue;
        lines.push(`#EXTINF:${Math.round((e.track.durationMs ?? 0) / 1000)},${e.track.artists.join(', ')} - ${e.track.title}`, url);
      }
      return lines.join('\n') + '\n';
    }
  }
}
