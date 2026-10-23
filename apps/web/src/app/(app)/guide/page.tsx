'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { CopyButton } from '@/components/controls';
import { DirectionGlyph, LegendSheet, SyncDiagram } from '@/components/guide-visuals';
import { PageHeader } from '@/components/page';
import { Tape } from '@/components/tape';

const SECTIONS = [
  { id: 'how', title: 'How a sync works' },
  { id: 'install', title: 'Install' },
  { id: 'connect', title: 'Connect your services' },
  { id: 'playlists', title: 'Sync a playlist' },
  { id: 'reading', title: 'Reading a setlist' },
  { id: 'review', title: 'Review matches' },
  { id: 'safety', title: 'Safety nets' },
  { id: 'liked', title: 'Liked songs' },
  { id: 'api', title: 'API & webhooks' },
  { id: 'trouble', title: 'When something’s off' },
] as const;

const COMPOSE = `services:
  crossfade:
    image: ghcr.io/ahamedzoha/crossfade:latest
    restart: unless-stopped
    ports: ["8080:8080"]
    environment:
      APP_URL: "https://crossfade.example.com"
    volumes:
      - ./data:/data`;

export default function GuidePage() {
  const [origin, setOrigin] = useState('https://crossfade.example.com');
  const active = useActiveSection();
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <>
      <PageHeader title="Guide" sub={<span>From install to your first synced playlist in about ten minutes.</span>} />
      <div className="grid gap-x-10 px-4 pt-8 pb-16 sm:px-7 xl:grid-cols-[minmax(0,860px)_220px]">
        <article className="min-w-0">
          <Block id="how" title="How a sync works" lead="Crossfade keeps one clean copy of each playlist and makes every service match it.">
            <SyncDiagram />
            <ul className="mt-6 grid gap-3 text-[14px] text-n7 sm:grid-cols-3">
              <Point title="Changes go everywhere">Add or remove a track on any service; the next sync repeats it on the others.</Point>
              <Point title="Duplicates collapse">The same recording twice keeps the earlier one. Live, acoustic and remix versions are never folded.</Point>
              <Point title="Nothing vanishes silently">Every removal is struck through with a note and can be restored.</Point>
            </ul>
          </Block>

          <Block id="install" title="Install" lead="One container, one port, one data folder.">
            <Code value={COMPOSE} label="docker-compose.yml" />
            <ul className="mt-4 flex flex-col gap-2 text-[14px] text-n7">
              <Bullet>
                Set <code className="font-mono text-paper">APP_URL</code> to the address you open Crossfade at. Spotify and Apple sign-in need it on{' '}
                <b className="text-paper">HTTPS</b> (put it behind your reverse proxy) or on <code className="font-mono text-paper">http://127.0.0.1</code>.
              </Bullet>
              <Bullet>The first person to open it creates the admin account. Add the rest of the household under Settings → People.</Bullet>
              <Bullet>
                Back up the <code className="font-mono text-paper">data</code> folder. It holds the database and the key that encrypts everyone&rsquo;s sign-ins.
              </Bullet>
            </ul>
          </Block>

          <Block id="connect" title="Connect your services" lead="An admin sets each service up once; then everyone links their own accounts under Connections.">
            <div className="flex flex-col">
              <Service
                provider="spotify"
                need="A Spotify developer app. Its owner needs Premium; people who connect can be on free accounts (up to 5)."
                steps={[
                  <>Create an app at developer.spotify.com/dashboard with the Web API.</>,
                  <>
                    Add the redirect URI <code className="font-mono text-paper break-all">{origin}/api/connections/spotify/callback</code>
                  </>,
                  <>Add each person&rsquo;s Spotify email under User Management.</>,
                  <>Paste the client ID and secret in Settings → Service apps, then connect.</>,
                ]}
                note="Spotify sign-ins expire after six months; Crossfade warns two weeks ahead."
              />
              <Service
                provider="ytmusic"
                need="Nothing on the server. Each person pastes a browser cookie."
                steps={[
                  <>Open music.youtube.com in a private window and sign in.</>,
                  <>Developer tools → Network → click a music.youtube.com request.</>,
                  <>
                    Turn on <b className="text-paper">Raw</b> for Request Headers and copy the whole Cookie value.
                  </>,
                  <>Paste it under Connections, then close the private window without signing out.</>,
                ]}
                note="Don’t copy from a tab you keep using: your browser refreshes that cookie and Crossfade’s copy dies within minutes."
              />
              <Service
                provider="apple"
                need="Nothing, with a web session. Or a MusicKit key from a paid Apple Developer membership."
                steps={[
                  <>
                    <b className="text-paper">Web session:</b> sign in at music.apple.com, open developer tools → Storage (Application in Chrome) →
                    Cookies, and copy <code className="font-mono text-paper">media-user-token</code>.
                  </>,
                  <>Paste it under Connections → Apple Music → Connect with a web session. It lasts about six months.</>,
                  <>
                    <b className="text-paper">MusicKit key instead:</b> create a key with MusicKit in your developer account, paste Team ID, key ID and
                    .p8 in Settings, then connect.
                  </>,
                ]}
                note="Web sessions can remove tracks but are unofficial and may break when Apple changes its web player. With a key, Apple’s API is add-only and removals become a to-do list under Review → Remove by hand."
              />
            </div>
          </Block>

          <Block id="playlists" title="Sync a playlist" lead="Playlists → New playlist, choose the playlist on each account, then Create and sync.">
            <p className="max-w-[62ch] text-[14px] text-n7">
              The first sync <b className="text-paper">merges</b>: every track from every linked playlist ends up in all of them. You can link more
              playlists later from the playlist page, including two playlists on the same service.
            </p>
            <div className="mt-5 flex flex-col">
              <Direction kind="both" name="Two-way">Changes here sync out, and this playlist receives every change. The default.</Direction>
              <Direction kind="pull" name="Read only">Changes here sync out; Crossfade never writes to it.</Direction>
              <Direction kind="push" name="Mirror">Crossfade makes it match exactly; edits made there are undone.</Direction>
            </div>
            <p className="mt-5 max-w-[62ch] text-[14px] text-n7">
              Playlists sync on a schedule (hourly unless changed in Settings → Syncing or per playlist) and whenever you press{' '}
              <b className="text-paper">Sync now</b>. <b className="text-paper">Dry run</b> shows what a sync would change without writing anything.
            </p>
          </Block>

          <Block id="reading" title="Reading a setlist" lead="Every playlist is drawn as a setlist. These markings carry the whole state.">
            <LegendSheet />
            <dl className="mt-6 grid gap-x-6 gap-y-3 text-[13.5px] text-n7 sm:grid-cols-2">
              <Key mark={<Tape provider="spotify" />}>The track is on that service.</Key>
              <Key mark={<Tape kind="missing" title="Missing" />}>Not there yet, or gone from there.</Key>
              <Key mark={<span className="font-hand text-[24px] leading-none font-bold">+</span>}>Added since the playlist was first imported.</Key>
              <Key mark={<StrikeSample />}>Removed or deduplicated. The note says why; Restore brings it back.</Key>
              <Key mark={<Tape kind="warn">Review</Tape>}>Matched with low confidence; waiting for your call.</Key>
              <Key mark={<Tape kind="hazard" title="Broken" />}>Something is broken, usually a sign-in.</Key>
            </dl>
            <p className="mt-4 max-w-[62ch] text-[13.5px] text-n6">
              The words at the top right of a long sheet, like a dictionary&rsquo;s guide words, name the first and last track in view.
            </p>
          </Block>

          <Block id="review" title="Review matches" lead="When Crossfade isn’t sure a song on one service is the same as on another, it asks.">
            <ul className="flex flex-col gap-2 text-[14px] text-n7">
              <Bullet>Matches of 85% or more go straight through. Between 60% and 85% they sync but land in Review. Below that they wait for you.</Bullet>
              <Bullet>Pick a candidate, paste a link to the right track, search again, or tell it never to match that song.</Bullet>
            </ul>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-n7">
              <Shortcut keys={['↑', '↓']}>choose</Shortcut>
              <Shortcut keys={['Enter']}>use this match</Shortcut>
              <Shortcut keys={['S']}>skip</Shortcut>
              <Shortcut keys={['I']}>never match</Shortcut>
            </div>
          </Block>

          <Block id="safety" title="Safety nets" lead="Two-way sync can spread a mistake, so these are on by default.">
            <p className="mb-4 bg-warn px-3 py-2 text-[13.5px] font-semibold text-ink">
              The guard stopped the last run: would remove 21 of 51 tracks (41%), over the 30% limit. Nothing was changed.
            </p>
            <ul className="flex flex-col gap-2 text-[14px] text-n7">
              <Bullet>
                <b className="text-paper">Deletion guard.</b> A run that would remove more than 30% of a list, or a service that suddenly returns an empty
                playlist, stops and changes nothing. Check the run, then press Run anyway on the playlist if it was intended.
              </Bullet>
              <Bullet>
                <b className="text-paper">Adds win.</b> If one service removes a track while another adds it in the same cycle, it stays.
              </Bullet>
              <Bullet>
                <b className="text-paper">Strike and restore.</b> Hover a row and press Strike to remove a track everywhere; struck tracks stay listed with
                a Restore button.
              </Bullet>
              <Bullet>
                <b className="text-paper">Run history.</b> Every sync is kept for 90 days with each change and its log under Runs.
              </Bullet>
            </ul>
          </Block>

          <Block id="liked" title="Liked songs" lead="Likes on one service show up on the others.">
            <p className="max-w-[62ch] text-[14px] text-n7">
              Open Liked Songs and pick at least two libraries. The first sync merges them, so everything liked anywhere gets liked everywhere.
              Apple Music can only add to your library, never remove.
            </p>
          </Block>

          <Block id="api" title="API & webhooks" lead="Let the rest of your homelab read the clean lists and react to changes.">
            <Code value={`curl -H "Authorization: Bearer $CROSSFADE_KEY" \\\n  ${origin}/api/v1/playlists`} label="List playlists" />
            <p className="mt-4 max-w-[62ch] text-[14px] text-n7">
              Create keys and webhooks under <Link href="/developers">API &amp; Webhooks</Link>, which also has the full endpoint reference and the
              OpenAPI document. Webhooks fire when a run finishes, fails or is guarded, when a list changes, when matches need review and when a sign-in
              expires.
            </p>
          </Block>

          <Block id="trouble" title="When something’s off" lead={null}>
            <dl className="flex flex-col">
              <Faq q="YouTube Music says the sign-in stopped working">
                The cookie was refreshed by a browser still using it, or that session was signed out. Copy a fresh one from a private window and close it.
              </Faq>
              <Faq q="Spotify’s Web API box is greyed out when creating the app">The account creating the app needs Spotify Premium.</Faq>
              <Faq q="Spotify sign-in doesn’t come back to Crossfade">
                The redirect URI in Spotify&rsquo;s dashboard must match exactly. On a plain-HTTP LAN address you&rsquo;ll get a copy-paste step instead.
              </Faq>
              <Faq q="A track matched the wrong version">Find it in Review, or paste a link to the right track there.</Faq>
              <Faq q="A removal on Apple Music didn’t happen">
                With a MusicKit key that&rsquo;s expected: the official API can&rsquo;t remove. Web sessions can, but Apple sometimes refuses edits to playlists
                made in the Music app. Either way it&rsquo;s listed under Review → Remove by hand.
              </Faq>
              <Faq q="A playlist stopped syncing">Open it: a yellow banner means the guard stopped a run, a hazard tape means a service needs reconnecting.</Faq>
            </dl>
          </Block>
        </article>

        <nav aria-label="On this page" className="hidden xl:block">
          <div className="sticky top-8">
            <p className="label mb-3">On this page</p>
            <ul className="flex flex-col border-l border-n2">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={`-ml-px block border-l-2 py-1.5 pl-3 text-[13.5px] no-underline ${
                      active === s.id ? 'border-paper font-bold text-paper' : 'border-transparent text-n6 hover:text-paper'
                    }`}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </>
  );
}

function useActiveSection() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '0px 0px -65% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return active;
}

function Block({ id, title, lead, children }: { id: string; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-n2 py-10 first:pt-0 last:border-b-0">
      <h2 className="display text-[26px] [font-stretch:112%] sm:text-[30px]">{title}</h2>
      {lead ? <p className="mt-2 mb-6 max-w-[62ch] text-[15px] text-n6">{lead}</p> : <div className="mb-5" />}
      {children}
    </section>
  );
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="border-t border-n3 pt-3">
      <b className="block font-bold text-paper">{title}</b>
      <span className="mt-1 block text-[13.5px] text-n6">{children}</span>
    </li>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="grid max-w-[66ch] grid-cols-[14px_minmax(0,1fr)] gap-2">
      <span className="mt-[9px] h-[3px] w-[10px] bg-n5" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

function Code({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">{label}</span>
        <CopyButton value={value} />
      </div>
      <pre className="overflow-x-auto bg-n1 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-n7 shadow-[inset_0_0_0_1px_var(--color-n2)]">{value}</pre>
    </div>
  );
}

function Service({ provider, need, steps, note }: { provider: 'spotify' | 'ytmusic' | 'apple'; need: string; steps: ReactNode[]; note: string }) {
  const name = provider === 'spotify' ? 'Spotify' : provider === 'ytmusic' ? 'YouTube Music' : 'Apple Music';
  return (
    <div className="grid gap-x-6 gap-y-3 border-t border-n2 py-6 first:border-t-0 first:pt-0 md:grid-cols-[180px_minmax(0,1fr)]">
      <div>
        <Tape provider={provider} />
        <h3 className="display mt-2 text-[19px] [font-stretch:108%]">{name}</h3>
      </div>
      <div className="min-w-0 text-[14px] text-n7">
        <p>
          <b className="text-paper">You need:</b> {need}
        </p>
        <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 marker:font-bold marker:text-n5">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="mt-3 text-[13px] text-n6">{note}</p>
      </div>
    </div>
  );
}

function Direction({ kind, name, children }: { kind: 'both' | 'pull' | 'push'; name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-t border-n2 py-3 text-[14px] text-n7 first:border-t-0 sm:grid-cols-[84px_100px_minmax(0,1fr)]">
      <span className="text-n6">
        <DirectionGlyph kind={kind} />
      </span>
      <b className="font-bold text-paper">{name}</b>
      <span className="col-start-2 sm:col-start-auto">{children}</span>
    </div>
  );
}

function Key({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 border-t border-n2 pt-3">
      <dt className="flex justify-center">{mark}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function StrikeSample() {
  return (
    <svg viewBox="0 0 56 16" className="h-4 w-14" aria-label="Struck through" role="img">
      <rect x="2" y="4" width="52" height="8" fill="var(--color-n4)" />
      <path d="M1 9 C14 7 28 10 55 7" fill="none" stroke="var(--color-paper)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function Shortcut({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {keys.map((k) => (
        <span key={k} className="kbd">
          {k}
        </span>
      ))}
      {children}
    </span>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-n2 py-3.5 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:gap-6">
      <dt className="font-bold text-paper">{q}</dt>
      <dd className="text-[14px] text-n7">{children}</dd>
    </div>
  );
}
