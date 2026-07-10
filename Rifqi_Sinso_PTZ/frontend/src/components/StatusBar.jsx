import { useEffect, useRef, useState } from "react";

// One-shot "celebrate" pulse when the status flips from disconnected to connected
// (not a repeating animation - that would be distracting on a control panel that's
// supposed to read as calm/trustworthy most of the time).
export default function StatusBar({ deviceConnected }) {
  const [celebrate, setCelebrate] = useState(false);
  const wasConnected = useRef(deviceConnected);

  useEffect(() => {
    if (deviceConnected && !wasConnected.current) {
      setCelebrate(true);
      wasConnected.current = true;
      const t = setTimeout(() => setCelebrate(false), 700);
      return () => clearTimeout(t);
    }
    wasConnected.current = deviceConnected;
  }, [deviceConnected]);

  return (
    <div id="status" className={(deviceConnected ? "ok" : "bad") + (celebrate ? " celebrate" : "")}>
      {deviceConnected ? "Bridge connected, device online" : "Bridge/device not connected"}
    </div>
  );
}
