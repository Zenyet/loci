import { useEffect, useRef } from 'react';

/** Coordinate existing independent menus without coupling their state models. */
export function useSurfaceDismiss(owner: string, open: boolean, dismiss: () => void) {
  const callback = useRef(dismiss);
  callback.current = dismiss;
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== owner) callback.current();
    };
    window.addEventListener('loci:surface', listener);
    return () => window.removeEventListener('loci:surface', listener);
  }, [owner]);
  useEffect(() => {
    if (open) window.dispatchEvent(new CustomEvent('loci:surface', { detail: owner }));
  }, [owner, open]);
}
