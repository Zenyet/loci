import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type { Bookmark } from '../types';
import { acquireFavicon, subscribeFaviconPreferences } from '../services/faviconStorage';
import type { ImageLease } from '../services/imageStore';
import { scheduleAfterDocumentLoad } from '../utils/scheduleAfterDocumentLoad';

const FAVICON_ATTEMPT_TIMEOUT_MS = 8000;

interface Props {
  bookmark: Pick<Bookmark, 'url' | 'color' | 'letter' | 'name'>;
  size?: number;
  fontSize?: number;
  radius?: number;
  style?: CSSProperties;
}

/**
 * Color + letter chip with a site-favicon overlay. Favicon URLs are requested
 * only after `load` + a short delay so the tab can leave the "loading" state
 * first; an unavailable gstatic image falls back to the letter chip.
 */
export function Favicon({ bookmark, size = 22, fontSize = 10, radius = 5, style }: Props) {
  const [ok, setOk] = useState(false);
  const [source, setSource] = useState<{ page: string; url: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const src = source?.page === bookmark.url ? source.url : null;
  useEffect(() => subscribeFaviconPreferences(() => setRevision(value => value + 1)), []);
  useEffect(() => {
    const controller = new AbortController(); let lease: ImageLease | null = null;
    setOk(false); setSource(null);
    const cancel = scheduleAfterDocumentLoad(() => {
      void acquireFavicon(bookmark.url, controller.signal).then(next => {
        if (controller.signal.aborted) { next?.release(); return; }
        lease = next; if (next) setSource({ page: bookmark.url, url: next.url });
      }).catch(() => {});
    });
    return () => { cancel(); controller.abort(); lease?.release(); };
  }, [bookmark.url, revision]);
  useEffect(() => {
    if (!src || ok) return;
    const timer = window.setTimeout(() => setSource(null), FAVICON_ATTEMPT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [src, ok]);
  const base: CSSProperties = {
    width: size,
    height: size,
    fontSize,
    borderRadius: radius,
    background: ok ? '#fff' : bookmark.color,
    ...style,
  };

  return (
    <span className="favicon" style={base} aria-label={bookmark.name}>
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth >= 8) setOk(true);
            else setSource(null);
          }}
          onError={() => setSource(null)}
          style={{
            display: ok ? 'block' : 'none',
            width: '72%',
            height: '72%',
            margin: 'auto',
            objectFit: 'contain',
          }}
        />
      )}
      {!ok && <span>{bookmark.letter}</span>}
    </span>
  );
}
