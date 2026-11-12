/**
 * Where the WebRTC signalling WebSocket lives.
 * - Dev (npm run dev): Vite proxies wss://<host>/signal to server/signal.ts on port 8787.
 * - Static hosting (GitHub Pages): set VITE_SIGNAL_URL at build time to a hosted signal server,
 *   e.g. wss://breezy-signal.onrender.com. Without it, the phone controller can't connect.
 */
export function signalUrl(): string {
  const custom = import.meta.env.VITE_SIGNAL_URL as string | undefined;
  if (custom) return custom;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`;
}

/** True when the page is served by the Vite dev server on this machine. */
export const isLocalDev = (): boolean => ['localhost', '127.0.0.1'].includes(location.hostname) || location.hostname === __LAN_IP__;
