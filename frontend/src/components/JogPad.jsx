import { useEffect, useRef } from "react";
import { JOG_NUDGE_MS } from "../constants";

// = worst-case backend timeout (400ms H + 400ms V query, see deviceClient.js getPosition).
const JOG_POLL_FALLBACK_MS = 800;
// Confirmed empirically (live device test): a query-position sent too soon after a jog
// command starts gets NO reply at all (the device seems to need a moment to start
// processing the move before it can also answer a query) - a query sent >=150ms after
// the jog command consistently replies within ~70ms. Delay the query, not the jog/stop
// commands themselves (those work fine at any timing - only confirmed for the query).
const JOG_QUERY_SETTLE_MS = 150;

// Pointer Events (not mouse-only) so press-and-hold works on touch too. releasePointerCapture
// keeps the mouseleave-style "slide off the button = stop" fail-safe working for touch as well
// (touch pointers implicitly capture to their target element by spec, which would otherwise
// suppress pointerleave while a finger slides off mid-hold). Ported from hmi.html.
//
// While a pan/tilt button is held, the device keeps moving from a single jog command, but
// nothing pushes its position back to the frontend on its own - so the canvas marker used to
// sit frozen until the next goto-angle. This polls query-position in a self-paced loop (next
// request only after the previous reply arrives, or a timeout) rather than a blind setInterval,
// because deviceClient.getPosition() has no cross-call lock and the device can only handle one
// outstanding query at a time (see deviceClient.js/PROJECT_CONTEXT.md) - a fixed interval could
// fire a second query before the first's reply lands.
export default function JogPad({ sendCommand, onMessage }) {
  const pollingRef = useRef(false);
  const waitingRef = useRef(false);
  const fallbackTimerRef = useRef(null);
  const nudgeTimerRef = useRef(null);
  const settleTimerRef = useRef(null);
  const jogStartRef = useRef(0);

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type !== "position" || !waitingRef.current) return;
      waitingRef.current = false;
      clearTimeout(fallbackTimerRef.current);
      if (pollingRef.current) pollNext();
    });
    return () => {
      unsubscribe();
      clearTimeout(fallbackTimerRef.current);
      clearTimeout(nudgeTimerRef.current);
      clearTimeout(settleTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMessage]);

  // Always wait out the settle window (relative to when the jog command was sent)
  // before actually transmitting a query-position, whether it's the first poll or the
  // final post-release snapshot.
  function sendPositionQuery() {
    const wait = Math.max(0, JOG_QUERY_SETTLE_MS - (Date.now() - jogStartRef.current));
    if (wait === 0) { sendCommand("query-position"); return; }
    settleTimerRef.current = setTimeout(() => sendCommand("query-position"), wait);
  }

  function pollNext() {
    if (!pollingRef.current || waitingRef.current) return;
    waitingRef.current = true;
    sendPositionQuery();
    fallbackTimerRef.current = setTimeout(() => {
      waitingRef.current = false;
      if (pollingRef.current) pollNext();
    }, JOG_POLL_FALLBACK_MS);
  }

  function startPolling() {
    if (pollingRef.current) return;
    jogStartRef.current = Date.now();
    pollingRef.current = true;
    pollNext();
  }
  function stopPolling() {
    pollingRef.current = false;
    if (waitingRef.current) {
      // a query-position is already in flight - let its reply be the final snapshot
      // instead of firing a second, concurrent one: the device/backend can only handle
      // one outstanding query at a time (see deviceClient.js/PROJECT_CONTEXT.md), and a
      // second overlapping query here was silently corrupting/dropping replies.
      return;
    }
    clearTimeout(fallbackTimerRef.current);
    sendPositionQuery(); // final snapshot so the marker settles exactly where the device stopped
  }

  function bind(action) {
    if (action === "stop") {
      return { onPointerDown: () => { clearTimeout(nudgeTimerRef.current); stopPolling(); sendCommand("stop"); } };
    }
    return {
      // One press moves the device for at most JOG_NUDGE_MS before auto-stopping, so a
      // single click/tap is always one small bounded nudge - it doesn't depend on exactly
      // how fast pointerup fires (browser/touch timing varies) or on device response time.
      onPointerDown: (e) => {
        try { e.target.releasePointerCapture(e.pointerId); } catch {}
        sendCommand(action);
        startPolling();
        nudgeTimerRef.current = setTimeout(() => { stopPolling(); sendCommand("stop"); }, JOG_NUDGE_MS);
      },
      onPointerUp: () => { clearTimeout(nudgeTimerRef.current); stopPolling(); sendCommand("stop"); },
      onPointerCancel: () => { clearTimeout(nudgeTimerRef.current); stopPolling(); sendCommand("stop"); },
      onPointerLeave: () => { clearTimeout(nudgeTimerRef.current); stopPolling(); sendCommand("stop"); },
    };
  }

  return (
    <div className="jog">
      <div />
      <button data-action="tilt-up" title="Tilt up" {...bind("tilt-up")}>&#8593;</button>
      <div />
      <button data-action="pan-left" title="Pan left" {...bind("pan-left")}>&#8592;</button>
      <button id="stopBtn" data-action="stop" {...bind("stop")}>STOP</button>
      <button data-action="pan-right" title="Pan right" {...bind("pan-right")}>&#8594;</button>
      <div />
      <button data-action="tilt-down" title="Tilt down" {...bind("tilt-down")}>&#8595;</button>
      <div />
    </div>
  );
}
