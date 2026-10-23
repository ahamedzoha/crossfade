import { PROVIDER_META, type ProviderId } from '@crossfade/shared';

export const TAPE: Record<ProviderId, { cls: string; abbr: string }> = {
  spotify: { cls: 'tape-sp', abbr: 'SP' },
  ytmusic: { cls: 'tape-yt', abbr: 'YT' },
  apple: { cls: 'tape-am', abbr: 'AM' },
};

export const serviceName = (p: ProviderId) => PROVIDER_META[p].name;
