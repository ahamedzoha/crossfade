// Runs the API (with its sync worker) and the Next.js server side by side.
// If either exits, the other is stopped and the container exits so Docker restarts it.
import { spawn } from 'node:child_process';

const env = process.env;
if (!env.APP_URL || env.APP_URL === `http://localhost:${env.PORT}`) {
  console.warn(
    `crossfade: APP_URL is ${env.APP_URL ?? 'unset'}. Set it to the address you open Crossfade at ` +
      '(e.g. https://crossfade.home.example) so Spotify sign-in can redirect back.',
  );
}

const children = [
  spawn('node', ['dist/main.js'], { cwd: '/app/api', env, stdio: 'inherit' }),
  spawn('node', ['server.js'], {
    cwd: '/app/web/apps/web',
    env: { ...env, PORT: env.PORT ?? '8080', HOSTNAME: env.HOSTNAME ?? '0.0.0.0' },
    stdio: 'inherit',
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 20_000).unref();
  Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.once('exit', r))))).then(() =>
    process.exit(code),
  );
}

for (const c of children) {
  c.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`crossfade: ${c.spawnargs.join(' ')} exited (${signal ?? code}); stopping`);
      stop(code ?? 1);
    }
  });
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => stop(0));
