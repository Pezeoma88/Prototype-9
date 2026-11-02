import { supabase } from './supabase';
import { getBoardAvatarUrl } from './board';

// Driver ratings and reviews (see supabase/prototype-6-reviews.sql).
//
// The app can only READ driver_reviews. Every review is created by the
// submit_my_driver_review database function (supabase/auth-1-accounts.sql),
// which takes the reviewer from the signed-in session and decides who may
// review:
// a rider with a confirmed (accepted) seat, requested before departure,
// once the scheduled departure time has arrived, never on their own ride,
// once per ride. Reviews are final. (The departure-time rule comes from
// supabase/prototype-6-reviews-open-at-departure.sql.)
//
// The eligibility check in this file is only for showing the right button
// or message. It uses the phone's clock and the last board load, so the
// server can still say no; when it does, its answer is what's shown.

export const REVIEW_COLUMNS =
  'id, ride_id, driver_id, rider_id, rating, comment, ride_destination, ride_departure_at, created_at';

// Same limit as driver_reviews_comment_check.
export const REVIEW_MAX_LENGTH = 300;

const SUBMIT_TIMEOUT_MS = 12000;

// The start of the message submit_my_driver_review raises when a rider who
// already reviewed the ride sends a different rating or comment.
const ALREADY_REVIEWED_PREFIX = 'You’ve already reviewed this ride';
const ALREADY_REVIEWED_PREFIX_ASCII = "You've already reviewed this ride";

const GENERIC_REFUSAL = "The server couldn't save your review. Please try again.";

// Loads what the app shows about reviews:
//   * every review of the given drivers (for Ride Details and Profile), and
//   * every review the signed-in person wrote (to know which rides they've
//     already reviewed),
//   * plus each given driver's review count and average.
// Resolves to { reviewRows, ratingSummaries } where ratingSummaries maps a
// driver id to { average, count }. A driver with no reviews is not in it.
// Throws if either query fails, so the caller can tell "no reviews" apart
// from "couldn't load reviews".
export async function loadReviewData({ driverIds, myProfileId }) {
  const ids = [...new Set([...driverIds, ...(myProfileId ? [myProfileId] : [])])];
  if (ids.length === 0) {
    return { reviewRows: [], ratingSummaries: {} };
  }

  let reviewsQuery = supabase.from('driver_reviews').select(REVIEW_COLUMNS);
  reviewsQuery = myProfileId
    ? reviewsQuery.or(`driver_id.in.(${ids.join(',')}),rider_id.eq.${myProfileId}`)
    : reviewsQuery.in('driver_id', ids);
  const [reviewsResult, summaryResult] = await Promise.all([
    reviewsQuery.order('created_at', { ascending: false }),
    supabase
      .from('driver_rating_summary')
      .select('driver_id, review_count, average_rating')
      .in('driver_id', ids),
  ]);
  if (reviewsResult.error) throw reviewsResult.error;
  if (summaryResult.error) throw summaryResult.error;

  const ratingSummaries = {};
  for (const row of summaryResult.data) {
    const average = Number(row.average_rating);
    const count = Number(row.review_count);
    if (Number.isFinite(average) && count > 0) {
      ratingSummaries[row.driver_id] = { average, count };
    }
  }
  return { reviewRows: reviewsResult.data, ratingSummaries };
}

// Sends a review through submit_my_driver_review. Resolves (never throws) with:
//   { kind: 'saved', review }          the server holds this review. Also
//                                      the answer to a repeat of the same
//                                      review, which is safe to send again.
//   { kind: 'already_reviewed', message }  this ride was already reviewed
//                                      with a different rating or comment;
//                                      nothing changed (reviews are final)
//   { kind: 'refused', message }       the server said no and saved nothing
//   { kind: 'uncertain' }              no answer arrived (offline, timeout),
//                                      so it may or may not have been saved
export async function submitDriverReview({ rideId, rating, comment }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  try {
    const { data, error, status } = await supabase
      .rpc('submit_my_driver_review', {
        p_ride_id: rideId,
        p_rating: rating,
        p_comment: comment.trim() === '' ? null : comment.trim(),
      })
      .abortSignal(controller.signal)
      .retry(false);

    const review = Array.isArray(data) ? data[0] : data;
    if (!error && review && review.id) {
      return { kind: 'saved', review };
    }
    // 4xx: the server received the call and rolled it back. P0001 is an
    // error raised on purpose by the function, written for users.
    if (error && status >= 400 && status < 500) {
      console.warn('CarpoolBoard: review refused', error);
      const message = error.code === 'P0001' && error.message ? error.message : GENERIC_REFUSAL;
      if (
        message.startsWith(ALREADY_REVIEWED_PREFIX) ||
        message.startsWith(ALREADY_REVIEWED_PREFIX_ASCII)
      ) {
        return { kind: 'already_reviewed', message };
      }
      return { kind: 'refused', message };
    }
    console.warn('CarpoolBoard: review got no clear answer', error);
    return { kind: 'uncertain' };
  } catch (error) {
    console.warn('CarpoolBoard: review got no clear answer', error);
    return { kind: 'uncertain' };
  } finally {
    clearTimeout(timer);
  }
}

// Whether the signed-in person can review this ride right now, as far as
// the phone can tell. Mirrors submit_my_driver_review's rules:
//   { status: 'reviewed', review }   they already reviewed it
//   { status: 'eligible' }           they can review it now
//   { status: 'too_early', opensAt } confirmed seat, but the ride hasn't
//                                    reached its scheduled departure yet;
//                                    reviews open at opensAt (a Date, the
//                                    departure time)
//   { status: 'not_eligible' }       anything else
// `ride` is an entry of App's drivers state, `requestRow` the person's own
// ride_requests row for it (any status), `myReview` their review of it.
export function getReviewEligibility({ ride, requestRow, myReview, currentUserId, nowMs = Date.now() }) {
  if (myReview) {
    return { status: 'reviewed', review: myReview };
  }
  if (
    !ride ||
    !requestRow ||
    requestRow.status !== 'accepted' ||
    ride.driverAccountId === currentUserId
  ) {
    return { status: 'not_eligible' };
  }
  const departureMs = ride.departureAt.getTime();
  const requestedMs = new Date(requestRow.created_at).getTime();
  if (!Number.isFinite(departureMs) || !(requestedMs <= departureMs)) {
    return { status: 'not_eligible' };
  }
  // Prototype rule: reviews open at the scheduled departure time, the same
  // moment submit_my_driver_review starts accepting them.
  if (nowMs < departureMs) {
    return { status: 'too_early', opensAt: new Date(departureMs) };
  }
  return { status: 'eligible' };
}

// A driver_reviews row in the shape the review list shows.
export function toReviewDisplay(row, profilesById) {
  return {
    id: row.id,
    rideId: row.ride_id,
    rating: row.rating,
    comment: row.comment || '',
    rideDestination: row.ride_destination,
    rideDepartureAt: new Date(row.ride_departure_at),
    createdAt: new Date(row.created_at),
    reviewerId: row.rider_id,
    reviewerName: profilesById[row.rider_id]?.name || 'A rider',
    reviewerAvatarUrl: getBoardAvatarUrl(profilesById, row.rider_id),
  };
}

// "Oct 13, 2026"
export function formatReviewDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
