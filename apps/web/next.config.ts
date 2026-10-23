import path from 'node:path';
import type { NextConfig } from 'next';

// The API runs beside Next in the same container; Next proxies /api/* to it.
const api = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  poweredByHeader: false,
  // Dev server is opened at 127.0.0.1 (Spotify only accepts loopback IPs for http redirects).
  allowedDevOrigins: ['127.0.0.1'],
  reactStrictMode: true,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
