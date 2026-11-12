import { WebSocketServer, WebSocket } from 'ws';

/**
 * Minimal signalling relay. Each room has at most one "game" and one "phone".
 * Messages: {type:'join', room, role} and {type:'signal', data} (SDP or ICE, passed to the other peer unchanged).
 */
type Role = 'game' | 'phone';
type InMsg = { type: 'join'; room: string; role: Role } | { type: 'signal'; data: unknown };
interface Room { game?: WebSocket; phone?: WebSocket }

const PORT = Number(process.env.PORT ?? 8787);   // hosts like Render/Fly set PORT
const rooms = new Map<string, Room>();
const wss = new WebSocketServer({ port: PORT });

function send(ws: WebSocket | undefined, msg: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', ws => {
  let room = '';
  let role: Role = 'game';

  ws.on('message', raw => {
    let msg: InMsg;
    try { msg = JSON.parse(String(raw)) as InMsg; } catch { return; }

    if (msg.type === 'join') {
      room = msg.room.toUpperCase();
      role = msg.role;
      const r = rooms.get(room) ?? {};
      r[role] = ws;
      rooms.set(room, r);
      const other = role === 'game' ? r.phone : r.game;
      if (other) { send(other, { type: 'peer-joined' }); send(ws, { type: 'peer-joined' }); }
      return;
    }
    if (msg.type === 'signal') {
      const r = rooms.get(room);
      send(role === 'game' ? r?.phone : r?.game, { type: 'signal', data: msg.data });
    }
  });

  ws.on('close', () => {
    const r = rooms.get(room);
    if (!r || r[role] !== ws) return;
    delete r[role];
    send(role === 'game' ? r.phone : r.game, { type: 'peer-left' });
    if (!r.game && !r.phone) rooms.delete(room);
  });
});

console.log(`Signal server listening on ws://localhost:${PORT} (proxied by Vite at /signal)`);
