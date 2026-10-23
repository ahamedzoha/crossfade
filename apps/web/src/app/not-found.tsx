import Link from 'next/link';
import { TapeCorners } from '@/components/tape';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <section className="sheet sheet-tilt w-full max-w-[440px] px-7 pt-8 pb-7">
        <TapeCorners />
        <h1 className="display text-[30px]">Not on the setlist</h1>
        <p className="mt-3 text-[14px] text-n4">That page doesn&rsquo;t exist. It may have been removed, or the link is mistyped.</p>
        <Link href="/" className="btn btn-ink mt-6 no-underline">
          Back to the overview
        </Link>
      </section>
    </main>
  );
}
