import { useEffect, useRef, useState } from 'react';
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
 */
function wantsStill(): boolean {
  if (typeof window === 'undefined') return true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches || conn?.saveData === true;
}

interface Props {
  playLabel: string;
  pauseLabel: string;
}

export function SkyLayer({ playLabel, pauseLabel }: Props) {
  // Decided once on mount; an error at load time falls back to the poster.
  const [video, setVideo] = useState(() => !wantsStill());
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const autoTried = useRef(false);
  const userPaused = useRef(false);

  // A fast failure (e.g. 404) can fire `error` before commit, when React drops
  // it, so `onError` never runs; the element's own error state is checked here.
  useEffect(() => {
    if (ref.current?.error) {
      setPlaying(false);
      setVideo(false);
    }
  }, []);

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
      <div className="home-dope-sky" aria-hidden="true">
        {video && (
          <video
            ref={ref}
            className="home-dope-sky__video"
            src="/home-dope/v3-cloud-flight.mp4"
            poster="/home-dope/v3-cloud-poster.jpg"
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
      {video && (
        <button
          type="button"
          className="home-dope-sky-toggle"
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
