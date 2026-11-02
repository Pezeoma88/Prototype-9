-- =====================================================================
-- CarpoolBoard Prototype 6 — Reviews open at departure: function update
-- =====================================================================
--
-- Changes ONE rule in submit_driver_review: a rider with a confirmed seat
-- can review the ride as soon as its scheduled departure time arrives,
-- instead of one hour after it.
--
--   before:  now() >= departure_at + 1 hour
--   after:   now() >= departure_at
--
-- Example: a ride scheduled to depart at 8:20 PM CT can be reviewed from
-- 8:20 PM CT. The database compares timestamps with time zones, so this
-- holds whatever time zone the server or the phone uses.
--
-- Run this AFTER supabase/prototype-6-reviews.sql, which created the
-- function. Do not re-run that original file afterwards: it would put the
-- one-hour wait back.
--
-- Everything else in the function is exactly as before:
--   * only riders whose request is 'accepted' at submit time, requested
--     before the scheduled departure
--   * no self-reviews (plus the driver_reviews_no_self_review check)
--   * one review per rider per ride (plus the unique rule)
--   * reviews are final: the same review again returns the saved one, a
--     different one is refused
--   * the ride row and the rider's request row are locked FOR SHARE while
--     the checks run
--   * SECURITY DEFINER, empty search_path, the same owner, and EXECUTE for
--     anon and authenticated only
--
-- Still a prototype rule, not proof that a ride happened: CarpoolBoard has
-- no record of whether the ride actually left or who was in the car.
-- Without the hour, a confirmed rider can review the moment the ride is due
-- to leave, before the trip could have finished.
--
-- PROTOTYPE SECURITY LIMITATION (unchanged): CarpoolBoard has no Supabase
-- Auth, so p_rider_id is trusted as sent. See the header of
-- supabase/prototype-6-reviews.sql.
--
-- Safety:
--   * Replaces the body of one function. No table, column, constraint,
--     index, view, policy or row is touched; existing reviews are kept
--     exactly as they are.
--   * CREATE OR REPLACE keeps the function's owner and grants; the grants
--     are re-applied anyway so the end state is certain.
--   * Step 0 stops with a clear message, changing nothing, if the function
--     isn't the one this file expects.
--   * Idempotent: running this file again is a no-op.
--   * Wrapped in one transaction: if any step fails, nothing is applied.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Pre-flight checks (read-only; stop early instead of guessing)
-- ---------------------------------------------------------------------

do $$
declare
  v_fn record;
begin
  if to_regclass('public.driver_reviews') is null then
    raise exception
      'Reviews update stopped: public.driver_reviews does not exist. Run supabase/prototype-6-reviews.sql first. Nothing was changed.';
  end if;

  select p.prosecdef, p.proowner
    into v_fn
  from pg_proc p
  where p.oid = to_regprocedure('public.submit_driver_review(uuid, uuid, integer, text)');
  if not found then
    raise exception
      'Reviews update stopped: public.submit_driver_review(uuid, uuid, integer, text) does not exist. Run supabase/prototype-6-reviews.sql first. Nothing was changed.';
  end if;
  if not v_fn.prosecdef then
    raise exception
      'Reviews update stopped: submit_driver_review is not SECURITY DEFINER, so it is not the function this file expects. Nothing was changed.';
  end if;

  -- The function must keep its current owner: that owner's rights are what
  -- let it insert into driver_reviews and read the tables it checks
  -- (verified by query (e2) of the original migration). CREATE OR REPLACE
  -- keeps the owner, but only the owner may run it.
  if not pg_has_role(current_user, v_fn.proowner, 'USAGE') then
    raise exception
      'Reviews update stopped: submit_driver_review is owned by %, and % can''t replace it. Run this file as % (postgres in the Supabase SQL Editor). Nothing was changed.',
      pg_get_userbyid(v_fn.proowner), current_user, pg_get_userbyid(v_fn.proowner);
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 1. submit_driver_review, with reviews opening at departure
-- ---------------------------------------------------------------------
-- Identical to the version in supabase/prototype-6-reviews.sql except for
-- the departure-time check near the end. See that file for the detailed
-- notes on eligibility, locking, concurrency and permissions.

create or replace function public.submit_driver_review(
  p_ride_id uuid,
  p_rider_id uuid,
  p_rating integer,
  p_comment text default null
)
returns public.driver_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ride public.rides%rowtype;
  v_request public.ride_requests%rowtype;
  v_review public.driver_reviews%rowtype;
  v_comment text := btrim(coalesce(p_comment, ''));
  v_ride_gone constant text :=
    'This ride is no longer available, so it can''t be reviewed. It may have been cancelled.';
  v_already_reviewed constant text :=
    'You''ve already reviewed this ride. Reviews are final and can''t be changed.';
  v_account_gone constant text :=
    'Your account could not be found. Please sign in again.';
begin
  if p_ride_id is null or p_rider_id is null then
    raise exception 'A ride and a rider are required to leave a review.';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Please choose a rating from 1 to 5 stars.';
  end if;
  if char_length(v_comment) > 300 then
    raise exception 'Your review can be at most 300 characters.';
  end if;

  -- The ride must still exist. Locking it keeps it from being deleted or
  -- rescheduled until this call finishes.
  select * into v_ride from public.rides where id = p_ride_id for share;
  if not found then
    raise exception '%', v_ride_gone;
  end if;

  -- Already reviewed. Reviews are final: the same review sent again is
  -- answered with the one on file, and anything different is refused.
  select * into v_review
  from public.driver_reviews
  where ride_id = p_ride_id and rider_id = p_rider_id;
  if found then
    if v_review.rating = p_rating and v_review.comment = v_comment then
      return v_review;
    end if;
    raise exception '%', v_already_reviewed;
  end if;

  if v_ride.driver_id = p_rider_id then
    raise exception 'You can''t review your own ride.';
  end if;
  if not exists (select 1 from public.profiles where id = p_rider_id) then
    raise exception '%', v_account_gone;
  end if;

  -- The rider needs a confirmed seat on this ride right now. Locking the
  -- request keeps its status from changing (Leave Seat, Deny) until this
  -- call finishes. If such a change is already under way, this waits for
  -- it and then reads the status it left behind.
  select * into v_request
  from public.ride_requests
  where ride_id = p_ride_id and rider_id = p_rider_id
  for share;
  if not found or v_request.status <> 'accepted' then
    raise exception 'Only riders with a confirmed seat on this ride can review it.';
  end if;
  -- ...requested before the ride was due to leave.
  if v_request.created_at > v_ride.departure_at then
    raise exception 'This seat was requested after the ride''s departure time, so the ride can''t be reviewed.';
  end if;

  -- Prototype rule: reviews open at the scheduled departure time.
  if now() < v_ride.departure_at then
    raise exception 'You can review this ride once its scheduled departure time arrives.';
  end if;

  -- The one write. ON CONFLICT DO NOTHING relies on the unique rule on
  -- (ride_id, rider_id): if another call inserted this pair a moment ago,
  -- this insert waits for it, then does nothing instead of failing.
  begin
    insert into public.driver_reviews
      (ride_id, driver_id, rider_id, rating, comment, ride_destination, ride_departure_at)
    values
      (v_ride.id, v_ride.driver_id, p_rider_id, p_rating, v_comment,
       v_ride.destination, v_ride.departure_at)
    on conflict (ride_id, rider_id) do nothing
    returning * into v_review;
  exception
    -- The ride is locked and can't have gone, so the row that vanished
    -- between the checks and the insert is a profile (only possible through
    -- manual clean-up). Say so plainly instead of leaking a constraint name.
    when foreign_key_violation then
      raise exception '%', v_account_gone;
  end;

  -- Nothing inserted: another call for this ride and rider created the
  -- review a moment ago. Treat it exactly like a review that was already
  -- there: the same content is returned, different content is refused.
  if v_review.id is null then
    select * into v_review
    from public.driver_reviews
    where ride_id = p_ride_id and rider_id = p_rider_id;
    if not found then
      raise exception '%', v_ride_gone;
    end if;
    if v_review.rating <> p_rating or v_review.comment <> v_comment then
      raise exception '%', v_already_reviewed;
    end if;
  end if;

  return v_review;
end;
$$;

comment on function public.submit_driver_review(uuid, uuid, integer, text) is
  'Creates a rider''s review of a ride''s driver if the rider is eligible (confirmed seat, requested before departure, scheduled departure time reached, not their own ride) and has not reviewed it, and returns the row. Sending the same review again returns the existing row; sending a different one is refused, because reviews are final. Insert-only. SECURITY DEFINER because the app cannot write driver_reviews directly. PROTOTYPE: p_rider_id is caller-supplied and not authenticated.';

-- Same grants as before: nobody by default, then the app's two roles.
revoke all on function public.submit_driver_review(uuid, uuid, integer, text) from public;
grant execute on function public.submit_driver_review(uuid, uuid, integer, text) to anon, authenticated;

commit;

-- Ask the Supabase API (PostgREST) to pick up the updated function.
notify pgrst, 'reload schema';


-- =====================================================================
-- VERIFICATION (read-only) — run separately AFTER the update above
-- =====================================================================
--
-- -- a) The new rule is in place: expect opens_at_departure = true and
-- --    still_waits_an_hour = false:
-- select position('now() < v_ride.departure_at then' in prosrc) > 0 as opens_at_departure,
--        position('interval ''1 hour''' in prosrc) > 0 as still_waits_an_hour
-- from pg_proc
-- where oid = 'public.submit_driver_review(uuid, uuid, integer, text)'::regprocedure;
--
-- -- b) Still SECURITY DEFINER with an empty search_path, the same owner,
-- --    and EXECUTE for anon and authenticated:
-- select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner,
--        has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
-- from pg_proc p
-- where p.oid = 'public.submit_driver_review(uuid, uuid, integer, text)'::regprocedure;
--
-- -- c) Existing reviews unchanged: same count as before running this file:
-- select count(*) as reviews from public.driver_reviews;
--
-- -- d) Rides a rider could review right now under the new rule:
-- select r.id as ride_id, q.rider_id, r.destination, r.departure_at
-- from public.rides r
-- join public.ride_requests q on q.ride_id = r.id
-- where q.status = 'accepted'
--   and q.created_at <= r.departure_at
--   and now() >= r.departure_at
--   and not exists (
--     select 1 from public.driver_reviews v
--     where v.ride_id = r.id and v.rider_id = q.rider_id
--   );


-- =====================================================================
-- ROLLBACK — only to bring back the one-hour wait. Not run by default.
-- =====================================================================
-- Re-run ONLY step 4 of supabase/prototype-6-reviews.sql (from
-- "create or replace function public.submit_driver_review" through its
-- grant statements), inside begin; ... commit;, then:
-- notify pgrst, 'reload schema';
-- Reviews written in the meantime are kept either way.
