'use client';

import { use } from 'react';
import { PlaylistView } from '@/components/playlist-view';

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PlaylistView id={id} />;
}
