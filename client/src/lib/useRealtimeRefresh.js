import { useEffect, useRef } from 'react';

const REFRESH_INTERVAL = 5000;

export default function useRealtimeRefresh(refresh, enabled = true) {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const run = () => {
      if (!active || document.visibilityState !== 'visible' || inFlightRef.current) return;
      inFlightRef.current = true;
      Promise.resolve()
        .then(() => refreshRef.current())
        .catch((error) => console.error('Automatic data refresh failed:', error))
        .finally(() => { inFlightRef.current = false; });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') run();
    };
    const timerId = setInterval(run, REFRESH_INTERVAL);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', run);
    return () => {
      active = false;
      clearInterval(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', run);
    };
  }, [enabled]);
}
