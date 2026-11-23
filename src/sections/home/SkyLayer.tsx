import { useEffect, useRef, useState } from 'react';
import { preload } from 'react-dom';
import { Pause, Play } from 'lucide-react';

/**
 * Hero sky, approved v3 (public/home-dope/design-v3.html): the local 3.6 MB
 * cloud-flight loop over its poster still. The poster is the CSS background, so
 * it is what shows before the video lands, when it fails, and whenever the
 * visitor asked for reduced motion or Save-Data — in those cases no video is
 * requested at all, and no control is rendered.
 *
 * 2026-10-07: a browser was observed holding the loaded video paused despite
 * `autoplay` (cause unconfirmed). Load makes one caught `play()` attempt on the
 * first `canplay`; after that only the visible button starts or stops it. The
 * button's state comes from media events, never from what we asked for.
 *
 * 2026-11-23 (phone speed test): the 3.5 MB video was 80% of the home page and
 * downloaded while the first screen was still loading. The video now mounts only
 * after the page `load` event (poster first), and slow connections (3G or worse)
 * keep the poster like Save-Data does. The prerender snapshot is taken after
 * `load`, so the video and its button carry `data-prerender-strip` and are cut
 * from the static HTML (scripts/lib/prerender-strip.mjs); otherwise the baked
 * `<video autoplay>` would start the download before any JS runs.
 *
 * 2026-11-24: the poster is the hero's largest paint (LCP), but as a CSS
 * background the browser only found it after the stylesheet and layout
 * (requested at ~2.8 s on slow 4G). A high-priority preload goes into <head>;
 * the prerender bakes it into the static HTML, so the request starts with the
 * HTML.
 */
const POSTER = '/home-dope/v3-cloud-poster.jpg';
const SLOW_CONNECTIONS = new Set(['slow-2g', '2g', '3g']);

function wantsStill(): boolean {
  if (typeof window === 'undefined') return true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || conn?.saveData === true
    || SLOW_CONNECTIONS.has(conn?.effectiveType || '');
}

function pageLoaded(): boolean {
  return typeof document !== 'undefined' && document.readyState === 'complete';
}

interface Props {
  playLabel: string;
  pauseLabel: string;
}

export function SkyLayer({ playLabel, pauseLabel }: Props) {
  preload(POSTER, { as: 'image', fetchPriority: 'high' });
  // Decided once on mount; an error at load time falls back to the poster.
  const [video, setVideo] = useState(() => !wantsStill());
  // The video waits for the page `load` event so it never competes with the first screen.
  const [loaded, setLoaded] = useState(pageLoaded);
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const autoTried = useRef(false);
  const userPaused = useRef(false);
  const showVideo = video && loaded;

  useEffect(() => {
    if (!video || loaded) return;
    const onLoad = () => setLoaded(true);
    window.addEventListener('load', onLoad, { once: true });
    // `load` may have fired between the first render and this effect.
    if (pageLoaded()) onLoad();
    return () => window.removeEventListener('load', onLoad);
  }, [video, loaded]);

  // A fast failure (e.g. 404) can fire `error` before commit, when React drops
  // it, so `onError` never runs; the element's own error state is checked here.
  useEffect(() => {
    if (ref.current?.error) {
      setPlaying(false);
      setVideo(false);
    }
  }, [showVideo]);

  const tryPlay = () => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    const p = el.play();
    // Rejection leaves the element paused; `playing` is never set from here.
    if (p && typeof p.catch === 'function') p.catch(() => setPlaying(false));
  };

  const onCanPlay = () => {
    if (autoTried.current || userPaused.current) return;
    autoTried.current = true;
    if (ref.current?.paused) tryPlay();
  };

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (playing) {
      userPaused.current = true;
      el.pause();
    } else {
      userPaused.current = false;
      tryPlay();
    }
  };

  return (
    <>
      {/* data-video = a video is planned (not yet loaded); layouts reserve the toggle's room on it. */}
      <div className="home-dope-sky" aria-hidden="true" data-video={video ? '' : undefined}>
        {showVideo && (
          <video
            ref={ref}
            className="home-dope-sky__video"
            data-prerender-strip=""
            src="/home-dope/v3-cloud-flight.mp4"
            poster={POSTER}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            onCanPlay={onCanPlay}
            onPlaying={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            // No retry: the failed source is dropped and the poster stays.
            onError={() => {
              setPlaying(false);
              setVideo(false);
            }}
          />
        )}
      </div>
      {showVideo && (
        <button
          type="button"
          className="home-dope-sky-toggle"
          data-prerender-strip=""
          aria-label={playing ? pauseLabel : playLabel}
          data-state={playing ? 'playing' : 'paused'}
          onClick={toggle}
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        </button>
      )}
    </>
  );
}
