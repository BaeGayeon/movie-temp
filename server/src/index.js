import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { C2S, S2C, parseMessage } from './protocol.js';
import { RoomManager } from './rooms.js';

const MAX_PAYLOAD = 16 * 1024;
const RATE_CAPACITY = 60; // 연결당 버스트
const RATE_PER_SEC = 30; // 연결당 초당 평균 메시지 수

export function createServer({ port = Number(process.env.PORT) || 8080, host = '0.0.0.0', ...roomOpts } = {}) {
  const rooms = new RoomManager(roomOpts);

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

  wss.on('connection', (ws) => {
    const conn = {
      userId: null,
      roomCode: null,
      send: (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj)),
      close: () => ws.close(),
    };
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    let tokens = RATE_CAPACITY;
    let last = Date.now();

    ws.on('message', (data, isBinary) => {
      const t = Date.now();
      tokens = Math.min(RATE_CAPACITY, tokens + ((t - last) / 1000) * RATE_PER_SEC);
      last = t;
      if (tokens < 1) return; // 빈도 제한: 초과분은 무시
      tokens -= 1;

      if (isBinary) return;
      const msg = parseMessage(data.toString());
      if (!msg) return; // 잘못된 메시지는 무시하고 연결은 유지

      switch (msg.type) {
        case C2S.CREATE_ROOM:
          rooms.create(conn, msg.userId);
          break;
        case C2S.JOIN_ROOM:
          rooms.join(conn, msg.roomCode, msg.userId);
          break;
        case C2S.LEAVE_ROOM:
          rooms.leave(conn);
          break;
        case C2S.VIDEO:
          rooms.video(conn, msg);
          break;
        case C2S.SET_PERMISSION:
          rooms.setPermission(conn, msg.mode);
          break;
        case C2S.COUNTDOWN_START:
          rooms.countdown(conn, msg.seconds);
          break;
        case C2S.BUFFERING:
          rooms.buffering(conn, msg);
          break;
        case C2S.SYNC_REPORT:
          rooms.syncReport(conn, msg);
          break;
        case C2S.PROFILE_UPDATE:
          rooms.profileUpdate(conn, msg.profile);
          break;
        case C2S.CHAT:
          rooms.chat(conn, msg.text);
          break;
        case C2S.TYPING:
          rooms.typing(conn, msg.isTyping);
          break;
        case C2S.REACTION:
          rooms.reaction(conn, msg.emoji);
          break;
        case C2S.PING:
          conn.send({ type: S2C.PONG });
          // 클라이언트 시계 오차 보정용(RTT 측정에 clientTime 을 그대로 돌려준다)
          if (msg.clientTime !== undefined) {
            conn.send({ type: S2C.SERVER_TIME, serverNow: Date.now(), clientTime: msg.clientTime });
          }
          break;
      }
    });

    ws.on('close', () => rooms.disconnect(conn));
    ws.on('error', () => {});
  });

  // 끊긴 연결 정리
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return {
    server,
    wss,
    rooms,
    listen: () =>
      new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat);
        rooms.shutdown();
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createServer();
  app.listen().then((p) => console.log(`server listening on :${p}`));
}
