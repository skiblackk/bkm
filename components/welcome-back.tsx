'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The greeting a person sees when they sign in.
 *
 * Two rules shaped it:
 *
 *   It is a welcome, not a toll gate. It fades itself out, can be dismissed by
 *   pressing anything, and it never blocks the workspace underneath — the
 *   dashboard is already loaded and interactive while it plays.
 *
 *   It is shown once per session. An animation that greets you every time you
 *   click a sidebar item is a nuisance, that is not a welcome. The session flag
 *   lives in sessionStorage, so a new sign-in or a new tab greets you again.
 *
 * The time of day is read from the browser's own clock, so "Good morning" is
 * correct for the person reading it rather than for the server.
 */

export type GreetingPeriod = 'morning' | 'afternoon' | 'evening';

/** Which greeting belongs to an hour of the day (0–23). */
export function periodFor(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

export function greetingFor(hour: number): string {
  return `Good ${periodFor(hour)}`;
}

/** "Joshua Musumbi" → "Joshua"; a first name is warmer than a full name. */
export function firstNameOf(fullName: string): string {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  // Titles and honorifics make a greeting stiff, so drop a leading one.
  const parts = cleaned.split(' ').filter((part) => !/^(mr|mrs|ms|miss|dr|prof|sir|madam)\.?$/i.test(part));
  return parts[0] ?? '';
}

const ILLUSTRATION: Record<GreetingPeriod, { line: string; accent: string; from: string; to: string }> = {
  morning: {
    line: 'A fresh start. The register is ready when you are.',
    accent: '#f2b63c',
    from: '#0f2233',
    to: '#1d4a5c',
  },
  afternoon: {
    line: 'Midway through the day. Everything is where you left it.',
    accent: '#e8a33d',
    from: '#16293c',
    to: '#2c4f63',
  },
  evening: {
    line: 'Winding down. Here is where the day stands.',
    accent: '#8fb4c9',
    from: '#0c1a2b',
    to: '#26314f',
  },
};

export default function WelcomeBack({ name, onDone }: { name: string; onDone?: () => void }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [period, setPeriod] = useState<GreetingPeriod>('morning');
  const [clock, setClock] = useState('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    setPeriod(periodFor(hour));
    setGreeting(greetingFor(hour));
    setClock(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));

    // One frame later, so the entry transition actually runs instead of being
    // applied before the element is painted.
    const enter = window.requestAnimationFrame(() => setVisible(true));
    timer.current = window.setTimeout(() => dismiss(), 4200);
    return () => {
      window.cancelAnimationFrame(enter);
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    setLeaving(true);
    if (timer.current) window.clearTimeout(timer.current);
    // Let the exit transition finish before unmounting.
    window.setTimeout(() => { setVisible(false); onDone?.(); }, 620);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    // Hold the page still while the greeting plays. It is brief, and a page
    // scrolling behind a full-screen animation looks broken rather than lively.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const art = ILLUSTRATION[period];
  const first = firstNameOf(name);

  return (
    <div
      data-testid="welcome-back"
      data-period={period}
      role="status"
      aria-live="polite"
      aria-label={`${greeting} ${first}`}
      onClick={dismiss}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // The workspace is already loaded underneath. Clicks pass through to it
        // as soon as this is dismissed; while it shows it is a soft scrim, not a
        // modal that traps focus.
        backgroundColor: '#05090f',
        opacity: leaving ? 0 : visible ? 1 : 0,
        transition: leaving ? 'opacity 520ms ease' : 'opacity 900ms cubic-bezier(.4,0,.2,1)',
        cursor: 'pointer',
      }}
    >
      {/* Deep, flat backdrop. A gradient proved unreliable here: the app's own
          canvas colour showed through and the greeting read as a ghost over the
          dashboard rather than something welcoming. */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: `radial-gradient(120% 100% at 50% -10%, ${art.to} 0%, #0a1626 42%, #05090f 100%)` }} />
      <style>{`
        @keyframes bkmRise { from { transform: translateY(22px) scale(0.986); } to { transform: none; } }
        @keyframes bkmSunUp { from { transform: translateY(26px); opacity: 0; } to { transform: none; opacity: 1; } }
        @keyframes bkmRay { from { stroke-dashoffset: 120; opacity: 0; } to { stroke-dashoffset: 0; opacity: 1; } }
        @keyframes bkmSweep { from { stroke-dashoffset: 420; } to { stroke-dashoffset: 0; } }
        @keyframes bkmBreathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        @keyframes bkmWord { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .bkm-welcome-card { animation: bkmRise 760ms cubic-bezier(.22,.68,.35,1) both; opacity: 1; }
        .bkm-welcome-word { animation: bkmWord 620ms cubic-bezier(.22,.68,.35,1) both; }
        .bkm-welcome-ray { stroke-dasharray: 120; animation: bkmRay 900ms ease-out both; }
        .bkm-welcome-sweep { stroke-dasharray: 420; animation: bkmSweep 1600ms cubic-bezier(.4,0,.2,1) 320ms both; }
        .bkm-welcome-glow { animation: bkmBreathe 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .bkm-welcome-card, .bkm-welcome-word, .bkm-welcome-ray, .bkm-welcome-sweep, .bkm-welcome-glow { animation: none !important; }
        }
      `}</style>

      <div
        className="bkm-welcome-card"
        style={{
          position: 'relative',
          zIndex: 1,
          width: 'min(560px, calc(100vw - 40px))',
          borderRadius: 20,
          padding: '38px 36px 32px',
          backgroundImage: `linear-gradient(160deg, ${art.from} 0%, ${art.to} 100%), linear-gradient(160deg, ${art.from} 0%, ${art.to} 100%)`,
          backgroundColor: art.from,
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 40px 90px rgba(2,8,16,0.55)',
          overflow: 'hidden',
          color: '#f7f9fb',
        }}
      >
        {/* Horizon line: the day's light moving across the card. */}
        <svg aria-hidden viewBox="0 0 560 200" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.9 }}>
          <defs>
            <radialGradient id="bkm-sun" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={art.accent} stopOpacity="0.95" />
              <stop offset="70%" stopColor={art.accent} stopOpacity="0.18" />
              <stop offset="100%" stopColor={art.accent} stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle className="bkm-welcome-glow" cx="430" cy="52" r="72" fill="url(#bkm-sun)" />
          <circle cx="430" cy="52" r="15" fill={art.accent} opacity="0.95" />
          {[0, 1, 2, 3].map((index) => (
            <line
              key={index}
              className="bkm-welcome-ray"
              x1={430 + Math.cos((Math.PI / 6) + index * (Math.PI / 7)) * 24}
              y1={52 + Math.sin((Math.PI / 6) + index * (Math.PI / 7)) * 24}
              x2={430 + Math.cos((Math.PI / 6) + index * (Math.PI / 7)) * 62}
              y2={52 + Math.sin((Math.PI / 6) + index * (Math.PI / 7)) * 62}
              stroke={art.accent} strokeWidth="1.5" strokeLinecap="round"
              style={{ animationDelay: `${520 + index * 110}ms` }}
            />
          ))}
          <path className="bkm-welcome-sweep" d="M-20 168 C 120 132, 300 196, 580 150" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="1.25" />
          <path d="M-20 182 C 140 150, 320 208, 580 168" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        </svg>

        <div style={{ position: 'relative' }}>
          <div className="bkm-welcome-word" style={{ animationDelay: '80ms', display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: art.accent }}>
            <span style={{ display: 'inline-block', width: 26, height: 1, background: art.accent, opacity: 0.7 }} />
            BKM Associates
            <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums', color: 'rgba(255,255,255,0.45)' }}>{clock}</span>
          </div>

          <h1 className="bkm-welcome-word" style={{ animationDelay: '200ms', margin: '22px 0 0', fontSize: 'clamp(30px, 6vw, 44px)', lineHeight: 1.05, letterSpacing: '-0.045em', fontWeight: 600 }}>
            {greeting},
            <br />
            <span style={{ color: art.accent }}>{first || 'there'}</span>
          </h1>

          <p className="bkm-welcome-word" style={{ animationDelay: '340ms', margin: '16px 0 0', maxWidth: 360, fontSize: 13, lineHeight: 1.7, color: 'rgba(247,249,251,0.72)' }}>
            {art.line}
          </p>

          <div className="bkm-welcome-word" style={{ animationDelay: '460ms', marginTop: 26, display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.38)' }}>
            <span>Opening your workspace</span>
            <span style={{ position: 'relative', flex: 1, height: 1, background: 'rgba(255,255,255,0.14)', overflow: 'hidden', borderRadius: 1 }}>
              <span style={{ position: 'absolute', inset: 0, width: '38%', background: art.accent, opacity: 0.85, animation: 'bkmSweep 1.6s ease-in-out infinite alternate' }} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
