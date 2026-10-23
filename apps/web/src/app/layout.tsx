import type { Metadata, Viewport } from 'next';
import { Archivo, Shantell_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/toast';
import { QueryProvider } from '@/lib/query';
import './globals.css';

const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' });
const shantell = Shantell_Sans({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-shantell', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Crossfade', template: '%s · Crossfade' },
  description: 'Keeps your playlists identical across Spotify, YouTube Music and Apple Music.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { themeColor: '#16130f', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${shantell.variable}`}>
      <body>
        <QueryProvider>
          <ToastProvider>{children}</ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
