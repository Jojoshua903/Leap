import QRCode from 'qrcode';
import { BaseBackend } from './InputBackend';
import type { InputSample, Vec3 } from '../types';
import { ComplementaryFilter, qIdentity } from '../math/Filter';
import { TUNING } from '../tuning';
import { isLocalDev, signalUrl } from './signal';

/** Packet sent by phone.ts: [phoneTimeMs, ax, ay, az, gx, gy, gz, trigger, a, b], already in the game's device frame. Older phone pages omit b. */
type ImuPacket = [number, number, number, number, number, number, number, 0 | 1, 0 | 1, (0 | 1)?];
interface SignalData { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
interface SignalMsg { type: string; data?: SignalData }

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Phone as controller. The game page joins a signalling room as "game"; the phone page (phone.html)
 * joins as "phone" and creates the WebRTC offer plus an unordered, no-retransmit DataChannel for low latency.
 */
export class PhoneBackend extends BaseBackend {
  readonly kind = 'phone' as const;
  readonly label = 'Phone';
  readonly room = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private filter = new ComplementaryFilter(TUNING.filterGain);
  private lastPhoneT = 0;
  private pingTimer = 0;

  /** URL the phone should open: this machine's LAN IP in dev, the site's own address when hosted. */
  get phoneUrl(): string {
    const origin = isLocalDev() ? `https://${__LAN_IP__}${location.port ? `:${location.port}` : ''}` : location.origin;
    return `${origin}${import.meta.env.BASE_URL}phone.html?room=${this.room}`;
  }

  qrDataUrl(): Promise<string> {
    return QRCode.toDataURL(this.phoneUrl, { margin: 1, width: 240, color: { dark: '#1d3a52', light: '#ffffff' } });
  }

  async connect(): Promise<void> {
    if (this.ws) return;
    this.setStatus(`Scan the QR code, or open the phone page with room ${this.room}`);
    const ws = new WebSocket(signalUrl());
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room: this.room, role: 'game' }));
    ws.onerror = () => this.setStatus(isLocalDev()
      ? 'Signal server not reachable. Run "npm run signal" in a second terminal.'
      : 'Phone controller needs a hosted signal server (VITE_SIGNAL_URL). See README → GitHub Pages.');
    ws.onclose = () => { this.ws = null; };
    ws.onmessage = ev => { void this.onSignal(JSON.parse(String(ev.data)) as SignalMsg); };
  }

  private async onSignal(msg: SignalMsg): Promise<void> {
    if (msg.type === 'peer-joined') { this.setStatus('Phone found, connecting…'); this.newPeer(); return; }
    if (msg.type === 'peer-left') { this.connected = false; this.setStatus(`Phone disconnected. Room ${this.room} is still open.`); return; }
    if (msg.type !== 'signal' || !msg.data) return;
    if (!this.pc) this.newPeer();
    const pc = this.pc;
    if (!pc) return;
    if (msg.data.sdp) {
      await pc.setRemoteDescription(msg.data.sdp);
      if (msg.data.sdp.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        this.sendSignal({ sdp: pc.localDescription?.toJSON() });
      }
    } else if (msg.data.candidate) {
      try { await pc.addIceCandidate(msg.data.candidate); } catch { /* late candidates after close are harmless */ }
    }
  }

  private sendSignal(data: object): void { this.ws?.send(JSON.stringify({ type: 'signal', data })); }

  private newPeer(): void {
    this.pc?.close();
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    pc.onicecandidate = e => { if (e.candidate) this.sendSignal({ candidate: e.candidate.toJSON() }); };
    pc.ondatachannel = e => this.attachChannel(e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.connected = false;
        this.setStatus('Phone connection lost. Reload the phone page to reconnect.');
      }
    };
  }

  private attachChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => {
      this.connected = true;
      this.filter.reset(qIdentity());
      this.setStatus('Phone connected');
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => { if (dc.readyState === 'open') dc.send(JSON.stringify({ ping: performance.now() })); }, 1000);
    };
    dc.onclose = () => { this.connected = false; this.setStatus('Phone disconnected'); };
    dc.onmessage = ev => this.onData(String(ev.data));
  }

  private onData(raw: string): void {
    const msg = JSON.parse(raw) as ImuPacket | { pong: number };
    if (!Array.isArray(msg)) {
      // round trip / 2 ≈ one-way latency
      this.latencyMs += ((performance.now() - msg.pong) / 2 - this.latencyMs) * 0.3;
      return;
    }
    const [pt, ax, ay, az, gx, gy, gz, trig, a, b] = msg;
    const dt = this.lastPhoneT ? (pt - this.lastPhoneT) / 1000 : 1 / 60;
    this.lastPhoneT = pt;
    const gyro: Vec3 = [gx - this.bias[0], gy - this.bias[1], gz - this.bias[2]];
    const accel: Vec3 = [ax, ay, az];
    this.filter.gain = TUNING.filterGain;
    const sample: InputSample = {
      t: performance.now(), accel, gyro,
      orientation: this.filter.update(gyro, accel, dt),
      buttons: { trigger: trig === 1, a: a === 1, b: b === 1 }
    };
    this.emit(sample);
  }

  protected resetOrientation(): void { this.filter.reset(qIdentity()); }
  protected forwardAfterReset(): InputSample['orientation'] { return qIdentity(); }

  rumble(strength: number, ms: number): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify({ rumble: Math.round(ms * Math.min(1, strength)) }));
  }

  disconnect(): void {
    clearInterval(this.pingTimer);
    this.dc?.close(); this.pc?.close(); this.ws?.close();
    this.dc = null; this.pc = null; this.ws = null;
    this.connected = false;
    this.setStatus('Not connected');
  }
}
