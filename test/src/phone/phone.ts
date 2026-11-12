import { signalUrl } from '../input/signal';

/**
 * Runs on the phone (phone.html). Hold the phone flat in your palm, screen up, top pointing at the TV.
 * Phone axes: x right, y toward the top, z out of the screen.
 * Game axes:  x right, y up, z toward the player  →  game = [px, pz, -py].
 * rotationRate is in deg/s: beta about x, gamma about y, alpha about z  →  game gyro = [beta, alpha, -gamma] (rad/s).
 */
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const statusEl = $('status'), rateEl = $('rate');
const startBtn = $<HTMLButtonElement>('start'), holdBtn = $<HTMLButtonElement>('hold'), aBtn = $<HTMLButtonElement>('a'), bBtn = $<HTMLButtonElement>('b');
const room = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase();
const D2R = Math.PI / 180;

interface SignalMsg { type: string; data?: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }
type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

let dc: RTCDataChannel | null = null;
let pc: RTCPeerConnection | null = null;
let ws: WebSocket | null = null;
let trigger: 0 | 1 = 0, aDown: 0 | 1 = 0, bDown: 0 | 1 = 0;
let accelSign = 1;            // some older iOS versions report accelerationIncludingGravity inverted
const signProbe: number[] = [];
let count = 0, lastRateT = performance.now();

const setStatus = (s: string): void => { statusEl.textContent = s; };
setStatus(room ? `Room ${room}. Tap the button to start.` : 'Missing room code. Scan the QR code on the game screen.');

startBtn.onclick = async () => {
  const dm = DeviceMotionEvent as unknown as MotionPermission;
  const dor = DeviceOrientationEvent as unknown as MotionPermission;
  try {
    if (dm.requestPermission && (await dm.requestPermission()) !== 'granted') {
      setStatus('Motion permission denied. Allow it in Settings and reload.');
      return;
    }
    if (dor.requestPermission) await dor.requestPermission();
  } catch {
    setStatus('Could not ask for motion permission. Make sure this page is HTTPS.');
    return;
  }
  startBtn.style.display = 'none';
  holdBtn.style.display = 'block';
  aBtn.style.display = 'block';
  bBtn.style.display = 'block';
  window.addEventListener('devicemotion', onMotion);
  connect();
};

function press(el: HTMLElement, set: (v: 0 | 1) => void): void {
  el.addEventListener('pointerdown', e => { e.preventDefault(); set(1); el.classList.add('down'); });
  const up = (): void => { set(0); el.classList.remove('down'); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
}
press(holdBtn, v => { trigger = v; });
press(aBtn, v => { aDown = v; });
press(bBtn, v => { bDown = v; });

function onMotion(e: DeviceMotionEvent): void {
  const ag = e.accelerationIncludingGravity, rr = e.rotationRate;
  if (!ag || !rr || ag.x === null || ag.y === null || ag.z === null) return;
  // Probe the sign during the first 30 samples (phone roughly flat → z should be about +9.8).
  if (signProbe.length < 30) {
    signProbe.push(ag.z);
    if (signProbe.length === 30) accelSign = signProbe.reduce((a, b) => a + b, 0) < 0 ? -1 : 1;
  }
  const px = ag.x * accelSign, py = ag.y * accelSign, pz = ag.z * accelSign;
  const beta = (rr.beta ?? 0) * D2R, gamma = (rr.gamma ?? 0) * D2R, alpha = (rr.alpha ?? 0) * D2R;
  const packet = [performance.now(), px, pz, -py, beta, alpha, -gamma, trigger, aDown, bDown];
  if (dc?.readyState === 'open') dc.send(JSON.stringify(packet));
  count++;
  const now = performance.now();
  if (now - lastRateT > 1000) {
    rateEl.textContent = `${Math.round(count * 1000 / (now - lastRateT))} Hz`;
    count = 0; lastRateT = now;
  }
}

function connect(): void {
  ws = new WebSocket(signalUrl());
  ws.onopen = () => { ws?.send(JSON.stringify({ type: 'join', room, role: 'phone' })); setStatus('Waiting for the game…'); };
  ws.onerror = () => setStatus('Cannot reach the signal server. Is "npm run signal" running?');
  ws.onmessage = ev => { void onSignal(JSON.parse(String(ev.data)) as SignalMsg); };
}

async function onSignal(msg: SignalMsg): Promise<void> {
  if (msg.type === 'peer-joined') { await makeOffer(); return; }
  if (msg.type === 'peer-left') { setStatus('Game closed. Reload when it is back.'); return; }
  if (msg.type !== 'signal' || !msg.data || !pc) return;
  if (msg.data.sdp) await pc.setRemoteDescription(msg.data.sdp);
  else if (msg.data.candidate) { try { await pc.addIceCandidate(msg.data.candidate); } catch { /* ignore late candidates */ } }
}

async function makeOffer(): Promise<void> {
  pc?.close();
  const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc = peer;
  peer.onicecandidate = e => { if (e.candidate) ws?.send(JSON.stringify({ type: 'signal', data: { candidate: e.candidate.toJSON() } })); };
  const channel = peer.createDataChannel('imu', { ordered: false, maxRetransmits: 0 });
  dc = channel;
  channel.onopen = () => setStatus('Connected! Hold the big button, swing, let go to throw.');
  channel.onclose = () => setStatus('Disconnected. Reload to reconnect.');
  channel.onmessage = ev => {
    const m = JSON.parse(String(ev.data)) as { ping?: number; rumble?: number };
    if (m.ping !== undefined) channel.send(JSON.stringify({ pong: m.ping }));
    if (m.rumble && 'vibrate' in navigator) navigator.vibrate(m.rumble);
  };
  await peer.setLocalDescription(await peer.createOffer());
  ws?.send(JSON.stringify({ type: 'signal', data: { sdp: peer.localDescription?.toJSON() } }));
}
