import { useEffect, useState } from 'react';
import { acquireImage, isImageRef, type ImageLease } from '../services/imageStore';
/** Resolve durable IDs into a temporary URL owned by this mounted view. */
export function useImageSource(value: string | null | undefined) {
  const [resolved, setResolved] = useState<{ value: string; url: string }>({ value: '', url: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true; let lease: ImageLease | undefined;
    setError('');
    if (!value || !isImageRef(value)) return;
    void acquireImage(value).then(next => {
      if (!alive) { next.release(); return; }
      lease = next; setResolved({ value, url: next.url });
    }).catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : '无法读取本机图片。'); });
    return () => { alive = false; lease?.release(); };
  }, [value]);
  return { url: isImageRef(value) ? resolved.value === value ? resolved.url : '' : value ?? '', error };
}
