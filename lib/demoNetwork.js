import { useSyncExternalStore } from 'react';

// DEVELOPMENT-ONLY network simulation for the Submit Ride Request demo.
//
// Supabase normally answers too fast to see "waiting", and failures can't be
// produced on demand, so this lets a developer slow down or break ONE call:
// the submit_my_ride_request RPC. Every other Supabase request (loading the
// board, profiles, photos, Accept/Deny, and the status checks that follow an
// abandoned or failed submission) always goes straight to the real network.
//
// It only does anything when __DEV__ is true (running through
// `npx expo start`). In a production build or published update the mode
// can't be changed, demoFetch is never installed (see lib/supabase.js), and
// the controls aren't rendered.
//
// Nothing here touches the database: the modes only delay, drop, or block
// the app's own request and response.

export const DEMO_NETWORK_AVAILABLE = typeof __DEV__ !== 'undefined' && __DEV__;

// How long the two "slow" modes hold a request.
export const DEMO_DELAY_MS = 6000;

// The only request the simulation is allowed to affect.
const SIMULATED_PATH = '/rest/v1/rpc/submit_my_ride_request';

export const DEMO_NETWORK_MODES = [
  {
    key: 'off',
    label: 'Off (real network)',
    description: 'Requests are sent normally.',
  },
  {
    key: 'slow_before',
    label: 'Delay BEFORE sending',
    description: `Holds the request on the phone for ${DEMO_DELAY_MS / 1000}s, then sends it. Stopping during the hold means nothing was sent.`,
  },
  {
    key: 'slow_after',
    label: 'Delay AFTER server saved',
    description: `Sends right away, then holds the server's reply for ${DEMO_DELAY_MS / 1000}s. Stopping during the hold leaves the request on the server.`,
  },
  {
    key: 'fail_before',
    label: 'Fail before sending',
    description: 'The request never leaves the phone and reports a network error.',
  },
  {
    key: 'lost_response',
    label: 'Lost response',
    description: 'The server saves the request, but the phone is told the network failed.',
  },
  {
    key: 'no_response',
    label: 'No response (timeout)',
    description: 'The request is never sent and never answers, so the app times out.',
  },
];

let currentMode = 'off';
const listeners = new Set();

export function getDemoNetworkMode() {
  return currentMode;
}

// Picks a simulation mode. Ignored outside development. The mode lives only
// in memory, so reloading the app always goes back to 'off'.
export function setDemoNetworkMode(mode) {
  if (!DEMO_NETWORK_AVAILABLE || !DEMO_NETWORK_MODES.some((m) => m.key === mode)) {
    return;
  }
  currentMode = mode;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The current mode, re-rendering the component when it changes.
export function useDemoNetworkMode() {
  return useSyncExternalStore(subscribe, getDemoNetworkMode, getDemoNetworkMode);
}

// Development-only trace in the Metro terminal, so each simulated step
// (held, stopped, sent) can be seen as it happens.
function log(message) {
  console.log(`[demo network] ${message}`);
}

// Runs one held step of a simulation. If the rider stops waiting during it,
// logs what that means for the request before passing the abort on.
async function hold(ms, signal, stoppedMessage) {
  try {
    await wait(ms, signal);
  } catch (error) {
    log(stoppedMessage);
    throw error;
  }
}

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

// Resolves after `ms`, or never when `ms` is null. Rejects like a real
// aborted fetch as soon as `signal` aborts.
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = ms === null ? null : setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      if (timer !== null) clearTimeout(timer);
      reject(abortError());
    });
  });
}

// A drop-in replacement for fetch, given to the Supabase client in
// development. Anything that isn't the submit_my_ride_request RPC is passed
// through untouched, whatever the mode.
export async function demoFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url;
  if (!DEMO_NETWORK_AVAILABLE || typeof url !== 'string' || !url.includes(SIMULATED_PATH)) {
    return fetch(input, init);
  }
  if (currentMode === 'off') {
    log('Off: sending submit_my_ride_request normally (no simulation).');
    return fetch(input, init);
  }

  const signal = init?.signal;
  const seconds = DEMO_DELAY_MS / 1000;
  // In the two modes where the request must reach the server, it is sent
  // WITHOUT the abort signal, so the server always receives it, exactly as
  // if it had already left the phone when the rider stopped waiting.
  const initWithoutAbort = { ...init, signal: undefined };

  switch (currentMode) {
    case 'slow_before':
      log(`Delay BEFORE sending: holding the request on the phone for ${seconds}s. Nothing has been sent.`);
      await hold(DEMO_DELAY_MS, signal, 'Stopped during the hold: the request was NOT sent.');
      log('Hold finished: sending the request to the server now.');
      return fetch(input, init);
    case 'slow_after': {
      log('Delay AFTER server saved: sending the request to the server now.');
      const response = await fetch(input, initWithoutAbort);
      log(`Server answered (HTTP ${response.status}). Holding its reply for ${seconds}s.`);
      await hold(
        DEMO_DELAY_MS,
        signal,
        'Stopped during the hold: the request had ALREADY been sent and answered.'
      );
      log('Hold finished: delivering the reply to the app.');
      return response;
    }
    case 'fail_before':
      log('Fail before sending: the request will NOT be sent.');
      await hold(600, signal, 'Stopped: the request was NOT sent.');
      log('Reporting a network error to the app. Nothing was sent.');
      throw new TypeError('Network request failed (simulated: never sent)');
    case 'lost_response': {
      log('Lost response: sending the request to the server now.');
      const response = await fetch(input, initWithoutAbort);
      log(`Server answered (HTTP ${response.status}). Dropping the reply and reporting a network error.`);
      throw new TypeError('Network request failed (simulated: response lost)');
    }
    case 'no_response':
      log('No response: the request will NOT be sent and will never answer. Waiting for the app to give up.');
      await hold(null, signal, 'The app stopped waiting (timeout or Stop Waiting). The request was NOT sent.');
      throw abortError();
    default:
      return fetch(input, init);
  }
}
