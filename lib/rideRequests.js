import { supabase } from './supabase';

// Submit Ride Request: the one operation in CarpoolBoard that "completes
// later" and is tracked through waiting, success, failure, retry, and
// abandonment (see App.js for the state, and RequestSubmissionPanel for
// what the rider sees).
//
// The rule these helpers follow: the phone only reports what the SERVER has
// said. Stopping a request on the phone (abandoning it, or timing out) does
// not undo anything on the server, and a network error doesn't tell us
// whether the request arrived first. So after any of those, the app asks
// Supabase what it actually holds instead of assuming.

// How long a submission may wait before the app gives up on the reply.
export const SUBMIT_TIMEOUT_MS = 12000;
// How long a single status check may take.
const LOOKUP_TIMEOUT_MS = 8000;
// After an uncertain submission the app checks the server several times,
// because a request that was already on its way can still land after the
// first check. Each number is the wait before that check.
export const CONFIRM_CHECK_DELAYS_MS = [0, 2000, 3000];

const REQUEST_COLUMNS = 'id, ride_id, rider_id, reason, status';

const GENERIC_REFUSAL = "The server couldn't process your request. Please try again.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends the request through the submit_my_ride_request database function,
// which creates a Pending row only if the signed-in rider has no row for
// this ride (the server takes the rider from the session, never from the
// app),
// and otherwise returns the existing row unchanged. That makes it safe to
// call again: a repeat can never create a duplicate or change a status.
//
// `signal` lets the caller abandon the wait. Resolves (never throws) with:
//   { kind: 'row', row }                    the server answered with the
//                                           rider's row; read row.status
//   { kind: 'refused', message, retryable } the server answered "no" and
//                                           saved nothing
//   { kind: 'uncertain', cause }            no answer was received, so the
//                                           request may or may not have been
//                                           saved. cause is 'abandoned',
//                                           'timeout', or 'network'.
export async function submitRideRequest({ rideId, reason, signal }) {
  const controller = new AbortController();
  let cause = 'network';
  const stop = (why) => {
    if (!controller.signal.aborted) {
      cause = why;
      controller.abort();
    }
  };
  const onAbandon = () => stop('abandoned');
  if (signal?.aborted) {
    onAbandon();
  } else {
    signal?.addEventListener('abort', onAbandon);
  }
  const timer = setTimeout(() => stop('timeout'), SUBMIT_TIMEOUT_MS);

  try {
    // retry(false): the app decides when to try again, never the client.
    const { data, error, status } = await supabase
      .rpc('submit_my_ride_request', {
        p_ride_id: rideId,
        p_reason: reason || null,
      })
      .abortSignal(controller.signal)
      .retry(false);

    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && row.id) {
      return { kind: 'row', row };
    }
    // A 4xx status means the server received the call and rejected it, so
    // its transaction was rolled back and no request was saved. P0001 is an
    // error raised on purpose by the database, whose message is for users.
    if (error && status >= 400 && status < 500) {
      console.warn('CarpoolBoard: ride request refused', error);
      const isRule = error.code === 'P0001' && error.message;
      return {
        kind: 'refused',
        message: isRule ? error.message : GENERIC_REFUSAL,
        retryable: !isRule,
      };
    }
    // No status (the request failed or was stopped on the phone) or a 5xx
    // (something between the phone and the database broke): unknown.
    console.warn('CarpoolBoard: ride request got no clear answer', cause, error);
    return { kind: 'uncertain', cause };
  } catch (error) {
    console.warn('CarpoolBoard: ride request got no clear answer', cause, error);
    return { kind: 'uncertain', cause };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbandon);
  }
}

// Asks Supabase for this rider's request row on this ride. Resolves with
// { ok: true, row } (row is null when there is none) or { ok: false } when
// the server couldn't be reached. Never affected by the demo network modes.
export async function lookupRideRequest({ rideId, riderId }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .from('ride_requests')
      .select(REQUEST_COLUMNS)
      .eq('ride_id', rideId)
      .eq('rider_id', riderId)
      .limit(1)
      .abortSignal(controller.signal)
      .retry(false);
    if (error || !Array.isArray(data)) {
      return { ok: false };
    }
    return { ok: true, row: data[0] || null };
  } catch (error) {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// Works out what really happened to a submission whose answer never
// arrived. Checks the server several times over a few seconds and resolves:
//   { kind: 'found', row }        the server has the rider's row
//   { kind: 'not_found', checks } every check ran and none found a row. This
//                                 is "none seen so far", not proof that one
//                                 can never arrive, so callers keep watching
//   { kind: 'unknown' }           the last check couldn't reach the server
//   { kind: 'stale' }             isCurrent() said this check was superseded
// onCheck(number, total) is called as each check starts.
export async function confirmRideRequestOutcome({ rideId, riderId, isCurrent, onCheck }) {
  const total = CONFIRM_CHECK_DELAYS_MS.length;
  let lastCheckReachedServer = false;
  for (let i = 0; i < total; i += 1) {
    if (CONFIRM_CHECK_DELAYS_MS[i] > 0) {
      await sleep(CONFIRM_CHECK_DELAYS_MS[i]);
    }
    if (!isCurrent()) return { kind: 'stale' };
    onCheck?.(i + 1, total);
    const result = await lookupRideRequest({ rideId, riderId });
    if (!isCurrent()) return { kind: 'stale' };
    if (result.ok && result.row) {
      return { kind: 'found', row: result.row };
    }
    lastCheckReachedServer = result.ok;
  }
  return lastCheckReachedServer ? { kind: 'not_found', checks: total } : { kind: 'unknown' };
}

// Withdraws a Pending request by marking it cancelled. Only matches a row
// that is still pending, so it can't overwrite a driver's Accept or Deny.
// Resolves with { ok: true, row } or { ok: false }.
export async function withdrawRideRequest(requestId) {
  try {
    const { data, error } = await supabase
      .from('ride_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select(REQUEST_COLUMNS);
    if (error || !data || data.length === 0) {
      return { ok: false };
    }
    return { ok: true, row: data[0] };
  } catch (error) {
    return { ok: false };
  }
}
