import { useEffect, useRef, useState, useCallback } from "react";

const API_KEY = import.meta.env.VITE_API_KEY || "change-me";

// Ported from hmi.html's WS client: same dynamic-hostname URL construction (works both
// on the dev machine and when reached over LAN from a phone/tablet by IP), same
// reconnect-on-close-after-2s behavior. Exposes a small pub/sub (onMessage) instead of
// one global ws.onmessage, since several components (canvas position, playback arrived
// events, status bar) each need to react to different message types independently.
export function useWebSocket() {
  const wsRef = useRef(null);
  const listenersRef = useRef(new Set());
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [bridgeConnected, setBridgeConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const wsUrl = `${proto}://${location.host}/ws?key=${encodeURIComponent(API_KEY)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setBridgeConnected(true);
      ws.onclose = () => {
        setBridgeConnected(false);
        setDeviceConnected(false);
        if (!cancelled) setTimeout(connect, 2000);
      };
      ws.onerror = () => setBridgeConnected(false);
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "status") setDeviceConnected(!!msg.deviceConnected);
        for (const listener of listenersRef.current) listener(msg);
      };
    }
    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, []);

  const sendCommand = useCallback((action, params) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "command", action, ...(params || {}) }));
    return true;
  }, []);

  const onMessage = useCallback((handler) => {
    listenersRef.current.add(handler);
    return () => listenersRef.current.delete(handler);
  }, []);

  return { bridgeConnected, deviceConnected, sendCommand, onMessage };
}
