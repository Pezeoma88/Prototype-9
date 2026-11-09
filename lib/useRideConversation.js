import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  getRideConversation,
  loadMessages,
  newClientMessageId,
  sendRideMessage,
} from './messaging';
import { checkMessageBody } from './messageText';
import { POLL_INTERVAL_MS, dropConfirmed, mergeMessages, pollSince } from './messageThread';

// Everything one open conversation needs: its live state from the server,
// its messages, polling, and sending with safe retries.
//
// Rules:
// * The server decides. `conversation.canSend` (the server's can_send) is
//   the only thing that allows sending; `conversation.state` says why a
//   chat is read-only. Neither is ever worked out on the phone.
// * Polling: every POLL_INTERVAL_MS while the screen is open AND the app is
//   active. Nothing runs in the background; coming back checks at once.
//   A poll never starts while the previous one is still running, and
//   unmounting stops everything.
// * Sending: each message gets one client id (newClientMessageId) when it
//   is first sent. Retry reuses it, so the server can never save it twice,
//   even when an answer was lost. A message is shown once, however many
//   times the server returns it.
//
// status: 'loading' | 'ready' | 'error' (first load failed; polling keeps
// trying) | 'unavailable' (messaging isn't on this server) | 'not_found'
// (not this person's conversation). The last two stop polling.

function isActiveState(state) {
  // iOS reports 'inactive' for moments like Control Center; 'background'
  // and 'inactive' both count as not active. Anything that isn't a known
  // state string (null at launch, 'unknown', or a non-string as in some
  // test environments) counts as active, since the screen is being shown.
  if (typeof state !== 'string') return true;
  return state !== 'background' && state !== 'inactive';
}

export function useRideConversation({ conversationId, currentUserId }) {
  const [status, setStatus] = useState('loading');
  const [statusMessage, setStatusMessage] = useState('');
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  // The phone's own messages not yet confirmed by the server:
  // { clientMessageId, body, status: 'sending' | 'failed', error, createdAtMs }
  const [outgoing, setOutgoing] = useState([]);
  // A failed poll ("Couldn't reach…"), cleared by the next good one.
  const [connectionNotice, setConnectionNotice] = useState('');
  // Why the last send was refused or failed, cleared by the next good send.
  const [sendNotice, setSendNotice] = useState('');

  // Refs hold the latest values for async work, so a late answer is applied
  // to current data and never to a stale copy.
  const mountedRef = useRef(true);
  const statusRef = useRef('loading');
  const messagesRef = useRef([]);
  const outgoingRef = useRef([]);
  const refreshInFlightRef = useRef(false);
  // Client ids with a send call in flight: the guard against double taps.
  const sendingIdsRef = useRef(new Set());

  const updateStatus = useCallback((next, message = '') => {
    statusRef.current = next;
    setStatus(next);
    setStatusMessage(message);
  }, []);

  const updateOutgoing = useCallback((change) => {
    const next = change(outgoingRef.current);
    if (next !== outgoingRef.current) {
      outgoingRef.current = next;
      setOutgoing(next);
    }
  }, []);

  const applyServerMessages = useCallback(
    (incoming) => {
      const next = mergeMessages(messagesRef.current, incoming);
      if (next !== messagesRef.current) {
        messagesRef.current = next;
        setMessages(next);
      }
      updateOutgoing((current) => dropConfirmed(current, incoming, currentUserId));
    },
    [currentUserId, updateOutgoing]
  );

  // A conversation answer from the server. Returns false when polling should
  // stop (no such conversation for this person).
  const applyConversation = useCallback(
    (result) => {
      if (result.kind !== 'ok') return true;
      if (result.conversation === null) {
        updateStatus('not_found');
        return false;
      }
      setConversation(result.conversation);
      return true;
    },
    [updateStatus]
  );

  // One load or poll: the conversation's live state and its messages,
  // together. Resolves false when polling should stop.
  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return true;
    if (statusRef.current === 'unavailable' || statusRef.current === 'not_found') return false;
    refreshInFlightRef.current = true;
    try {
      const isFirstLoad = statusRef.current !== 'ready';
      const [conversationResult, messagesResult] = await Promise.all([
        getRideConversation(conversationId),
        loadMessages(
          isFirstLoad
            ? { conversationId }
            : { conversationId, since: pollSince(messagesRef.current) }
        ),
      ]);
      if (!mountedRef.current) return false;

      const unavailable = [conversationResult, messagesResult].find((r) => r.kind === 'unavailable');
      if (unavailable) {
        updateStatus('unavailable', unavailable.message);
        return false;
      }
      if (!applyConversation(conversationResult)) return false;
      if (messagesResult.kind === 'ok') {
        applyServerMessages(messagesResult.messages);
      }

      const failure = [conversationResult, messagesResult].find((r) => r.kind !== 'ok');
      if (isFirstLoad) {
        if (failure) {
          updateStatus('error', failure.message);
        } else {
          updateStatus('ready');
        }
      } else {
        setConnectionNotice(failure ? failure.message : '');
      }
      return true;
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [conversationId, applyConversation, applyServerMessages, updateStatus]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Polling, tied to this screen being mounted and the app being active.
  useEffect(() => {
    mountedRef.current = true;
    let stopped = false;
    let timer = null;
    let active = isActiveState(AppState.currentState);

    function clearTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    async function tick() {
      timer = null;
      if (stopped || !active || refreshInFlightRef.current) return;
      const keepGoing = await refreshRef.current();
      if (!keepGoing) {
        stopped = true;
        return;
      }
      // The next poll is counted from when this one finished, so a slow
      // answer never overlaps the next request.
      if (!stopped && active && mountedRef.current && timer === null) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      const nowActive = isActiveState(nextState);
      if (nowActive && !active) {
        active = true;
        clearTimer();
        tick(); // back in the foreground: check at once
      } else if (!nowActive) {
        active = false;
        clearTimer();
      }
    });

    tick();
    return () => {
      stopped = true;
      mountedRef.current = false;
      clearTimer();
      subscription.remove();
    };
  }, [conversationId]);

  // Re-reads just the conversation's state, straight away (used when a send
  // is refused, so a chat that just became read-only shows it at once).
  const recheckConversation = useCallback(async () => {
    const result = await getRideConversation(conversationId);
    if (mountedRef.current) {
      applyConversation(result);
    }
  }, [conversationId, applyConversation]);

  // Sends (or re-sends) one message entry, keeping its client id.
  const deliver = useCallback(
    async (entry) => {
      if (sendingIdsRef.current.has(entry.clientMessageId)) return;
      sendingIdsRef.current.add(entry.clientMessageId);
      let result;
      try {
        result = await sendRideMessage({
          conversationId,
          clientMessageId: entry.clientMessageId,
          body: entry.body,
        });
      } finally {
        sendingIdsRef.current.delete(entry.clientMessageId);
      }
      if (!mountedRef.current) return;

      if (result.kind === 'ok') {
        applyServerMessages([result.message]);
        updateOutgoing((current) =>
          current.filter((item) => item.clientMessageId !== entry.clientMessageId)
        );
        setSendNotice('');
        return;
      }
      // Still on screen unless a poll already found it saved.
      updateOutgoing((current) =>
        current.map((item) =>
          item.clientMessageId === entry.clientMessageId
            ? { ...item, status: 'failed', error: result.message }
            : item
        )
      );
      setSendNotice(result.message);
      if (result.kind === 'refused') {
        recheckConversation();
      }
    },
    [conversationId, applyServerMessages, updateOutgoing, recheckConversation]
  );

  // Sends new text. Returns true when it was accepted for sending (the
  // composer then clears), false when it can't be sent.
  const send = useCallback(
    (text) => {
      const checked = checkMessageBody(text);
      if (!checked.ok || !conversation || !conversation.canSend) {
        return false;
      }
      const entry = {
        clientMessageId: newClientMessageId(),
        body: checked.body,
        status: 'sending',
        error: '',
        createdAtMs: Date.now(),
      };
      updateOutgoing((current) => [...current, entry]);
      deliver(entry);
      return true;
    },
    [conversation, deliver, updateOutgoing]
  );

  // Retries a failed message with its ORIGINAL client id and text.
  const retry = useCallback(
    (clientMessageId) => {
      const entry = outgoingRef.current.find((item) => item.clientMessageId === clientMessageId);
      if (!entry || entry.status !== 'failed' || sendingIdsRef.current.has(clientMessageId)) {
        return;
      }
      updateOutgoing((current) =>
        current.map((item) =>
          item.clientMessageId === clientMessageId ? { ...item, status: 'sending', error: '' } : item
        )
      );
      deliver(entry);
    },
    [deliver, updateOutgoing]
  );

  // Try Again after a failed first load.
  const reload = useCallback(() => {
    if (statusRef.current !== 'error') return;
    updateStatus('loading');
    refreshRef.current();
  }, [updateStatus]);

  return {
    status,
    statusMessage,
    conversation,
    messages,
    outgoing,
    connectionNotice,
    sendNotice,
    send,
    retry,
    reload,
  };
}
