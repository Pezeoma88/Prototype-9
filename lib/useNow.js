import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

// The current time in milliseconds, re-read every `intervalMs` while the app
// is in the foreground and immediately whenever it comes back to the
// foreground. Ride expiration reads this instead of calling Date.now() during
// render, so the whole app agrees on one "now" and re-renders when it moves.
//
// `onForeground` (optional) runs each time the app returns to the
// foreground, e.g. to reload the board from Supabase.
export function useNow(intervalMs, onForeground) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const onForegroundRef = useRef(onForeground);
  onForegroundRef.current = onForeground;

  useEffect(() => {
    let timer = null;
    function start() {
      if (timer === null) {
        timer = setInterval(() => setNowMs(Date.now()), intervalMs);
      }
    }
    function stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }

    // Track the last state so only a real background -> active change counts
    // (iOS also reports 'inactive' for things like Control Center).
    let lastState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        setNowMs(Date.now());
        start();
        if (lastState === 'background') {
          onForegroundRef.current?.();
        }
      } else if (nextState === 'background') {
        stop();
      }
      lastState = nextState;
    });

    start();
    return () => {
      stop();
      subscription.remove();
    };
  }, [intervalMs]);

  return nowMs;
}
