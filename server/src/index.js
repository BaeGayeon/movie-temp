import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { C2S, S2C, parseMessage } from './protocol.js';
import { RoomManager } from './rooms.js';

const PRIVACY_HTML = fs.readFileSync(new URL('../public/privacy.html', import.meta.url));
const MAX_PAYLOAD = 64 * 1024; // 이미지 프사 포함 profile_update 를 받기 위함(메시지 타입별 상한은 protocol.js)
const RATE_CAPACITY = 60; // 연결당 버스트
const RATE_PER_SEC = 30; // 연결당 초당 평균 메시지 수
const ROOM_CHECK_PER_MIN = 20; // IP 당 방 존재 확인(GET /rooms/<코드>) 분당 횟수. 방 코드 무작위 대입 방지
const ROOM_CHECK_PATH = /^\/rooms\/([A-Za-z0-9]{6})$/;

export function createServer({ port = Number(process.env.PORT) || 8080, host = '0.0.0.0', roomCheckPerMin = ROOM_CHECK_PER_MIN, ...roomOpts } = {}) {
  const rooms = new RoomManager(roomOpts);

  // IP 별 방 존재 확인 횟수(1분 창). Render 같은 프록시 뒤에서는 프록시가 덧붙인 마지막 X-Forwarded-For 값을 클라이언트로 본다
  const checks = new Map(); // ip -> { count, resetAt }
  const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim() || req.socket.remoteAddress || '';
  const checkLimited = (ip) => {
    const now = Date.now();
    let e = checks.get(ip);
    if (!e || e.resetAt <= now) {
      for (const [k, v] of checks) if (v.resetAt <= now) checks.delete(k);
      e = { count: 0, resetAt: now + 60_000 };
      checks.set(ip, e);
    }
    return ++e.count > roomCheckPerMin;
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size }));
      return;
    }
    // 초대 링크의 방이 아직 있는지 확인(확장 background 가 호출). 방 정보는 내보내지 않고 존재 여부만 돌려준다
    const check = req.method === 'GET' || req.method === 'OPTIONS' ? ROOM_CHECK_PATH.exec(req.url) : null;
    if (check) {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Cache-Control': 'no-store' };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
      } else if (checkLimited(clientIp(req))) {
        res.writeHead(429, { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
      } else {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        const room = rooms.rooms.get(check[1].toUpperCase());
        res.end(JSON.stringify({ exists: !!room, hasPassword: !!room?.password })); // 방 정보는 이것만 내보낸다(비밀번호 유무는 초대 배너에서 입력칸을 미리 보여 주는 데 쓴다)
      }
      return;
    }
    // 크롬 웹스토어 등록용 개인정보처리방침 주소: https://서버주소/privacy
    if (req.method === 'GET' && (req.url === '/privacy' || req.url === '/privacy/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      res.end(PRIVACY_HTML);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

  wss.on('connection', (ws, req) => {
    const conn = {
      ip: clientIp(req),
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
          rooms.create(conn, msg.userId, { password: msg.password, maxMembers: msg.maxMembers });
          break;
        case C2S.JOIN_ROOM:
          rooms.join(conn, msg.roomCode, msg.userId, msg.password);
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
          rooms.chat(conn, msg.text, msg.videoTime, msg.replyTo);
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
