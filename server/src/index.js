import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { C2S, S2C, ERR, parseMessage } from './protocol.js';
import { RoomManager } from './rooms.js';

const PRIVACY_HTML = {
  ko: fs.readFileSync(new URL('../public/privacy.html', import.meta.url)),
  en: fs.readFileSync(new URL('../public/privacy.en.html', import.meta.url)),
};
const MAX_PAYLOAD = 64 * 1024; // 이미지 프사 포함 profile_update 를 받기 위함(메시지 타입별 상한은 protocol.js)
const RATE_CAPACITY = 60; // 연결당 버스트
const RATE_PER_SEC = 30; // 연결당 초당 평균 메시지 수
const ROOM_CHECK_PER_MIN = 60; // IP 당 방 존재 확인(GET /rooms/<코드>) 분당 횟수. 방 코드 무작위 대입 방지(같은 공유기의 여러 명이 초대 링크를 열어도 되게 넉넉히)
const MAX_CONN_PER_IP = 20; // IP 당 동시 WebSocket 연결 수(같은 공유기의 가족/기숙사가 같이 쓸 수 있는 정도)
const MAX_CONNECTIONS = 10_000; // 서버 전체 동시 연결 수(5,000명에서 메모리 약 130MB 였다)
const CREATE_ROOM_PER_MIN = 10; // IP 당 분당 방 만들기 횟수
// 브라우저는 WebSocket/fetch 에 항상 Origin 을 붙인다. 확장(chrome-extension://<ID>)이 아닌 웹페이지가 서버에 붙는 것을 막는다.
// Origin 이 없는 요청(브라우저가 아닌 클라이언트)은 막지 않는다. 방 접근은 어차피 방 코드/비밀번호가 지킨다.
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const ROOM_CHECK_PATH = /^\/rooms\/([A-Za-z0-9]{6})$/;

const envInt = (name, fallback) => (Number.isInteger(Number(process.env[name])) && Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);

export function createServer({
  port = Number(process.env.PORT) || 8080,
  host = '0.0.0.0',
  roomCheckPerMin = ROOM_CHECK_PER_MIN,
  maxConnPerIp = envInt('MAX_CONN_PER_IP', MAX_CONN_PER_IP),
  maxConnections = envInt('MAX_CONNECTIONS', MAX_CONNECTIONS),
  createRoomPerMin = CREATE_ROOM_PER_MIN,
  // 프록시(Render 등) 뒤에서만 true. 프록시 없이 X-Forwarded-For 를 믿으면 헤더를 위조해 IP 별 제한을 피할 수 있다
  trustProxy = process.env.TRUST_PROXY === '1',
  // 스토어에 올린 확장의 ID(32자). 정하면 그 확장의 Origin 만 허용하고, 없으면 아무 확장의 Origin 이나 허용한다
  extensionId = process.env.EXTENSION_ID,
  maxRooms = envInt('MAX_ROOMS', undefined),
  restoreKey = process.env.RESTORE_KEY, // 방 복구 토큰 서명 키(재시작 뒤에도 같은 값이어야 한다)
  ...roomOpts
} = {}) {
  const rooms = new RoomManager({ ...roomOpts, ...(maxRooms ? { maxRooms } : {}), ...(restoreKey ? { restoreKey } : {}) });

  // IP 별 방 존재 확인 횟수(1분 창). Render 같은 프록시 뒤에서는 프록시가 덧붙인 마지막 X-Forwarded-For 값을 클라이언트로 본다
  const clientIp = (req) => (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim()) || req.socket.remoteAddress || '';
  const originOk = (origin) => (origin === undefined ? true : extensionId ? origin === `chrome-extension://${extensionId}` : EXTENSION_ORIGIN_RE.test(origin));
  // 확장 background 의 fetch 만 읽을 수 있게 한다: 허용된 Origin 이면 그 값을 그대로 돌려준다(웹페이지의 읽기 요청에는 CORS 헤더를 주지 않는다)
  const cors = (req) => {
    const o = req.headers.origin;
    return o !== undefined && originOk(o) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : { Vary: 'Origin' };
  };
  // IP 별 1분 창 횟수 제한(메모리에서만 세고 창이 지나면 지운다). 넘으면 true
  const windowLimiter = (limit) => {
    const map = new Map(); // ip -> { count, resetAt }
    return (ip) => {
      const now = Date.now();
      let e = map.get(ip);
      if (!e || e.resetAt <= now) {
        for (const [k, v] of map) if (v.resetAt <= now) map.delete(k);
        e = { count: 0, resetAt: now + 60_000 };
        map.set(ip, e);
      }
      return ++e.count > limit;
    };
  };
  const checkLimited = windowLimiter(roomCheckPerMin);
  const createLimited = windowLimiter(createRoomPerMin);
  const connsByIp = new Map(); // ip -> 지금 열려 있는 연결 수
  let connTotal = 0;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      // 확장 background 가 잠든 서버를 깨울 때 이 주소를 fetch 한다. 스토어 빌드는 서버 주소에 대한 호스트 권한이 없어 CORS 헤더가 없으면 응답이 와도 fetch 가 실패한다
      res.writeHead(200, { ...SECURITY_HEADERS, ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, serverId: rooms.serverId })); // serverId: 서버가 켜질 때마다 바뀌는 값(확장이 끊긴 이유가 재배포인지 구분하는 데 쓴다)
      return;
    }
    // 초대 링크의 방이 아직 있는지 확인(확장 background 가 호출). 방 정보는 내보내지 않고 존재 여부만 돌려준다
    const check = req.method === 'GET' || req.method === 'OPTIONS' ? ROOM_CHECK_PATH.exec(req.url) : null;
    if (check) {
      const c = { ...SECURITY_HEADERS, ...cors(req), 'Access-Control-Allow-Methods': 'GET', 'Cache-Control': 'no-store' };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, c);
        res.end();
      } else if (checkLimited(clientIp(req))) {
        res.writeHead(429, { ...c, 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'rate_limited' }));
      } else {
        res.writeHead(200, { ...c, 'Content-Type': 'application/json' });
        const room = rooms.rooms.get(check[1].toUpperCase());
        res.end(JSON.stringify({ exists: !!room, hasPassword: !!room?.password })); // 방 정보는 이것만 내보낸다(비밀번호 유무는 초대 배너에서 입력칸을 미리 보여 주는 데 쓴다)
      }
      return;
    }
    // 크롬 웹스토어 등록용 개인정보처리방침 주소: https://서버주소/privacy (?lang=ko|en, 없으면 브라우저 언어에 맞춤)
    if (req.method === 'GET' && /^\/privacy\/?(\?|$)/.test(req.url)) {
      const q = new URL(req.url, 'http://x').searchParams.get('lang');
      const lang = q === 'ko' || q === 'en' ? q : /^\s*en/i.test(req.headers['accept-language'] ?? '') ? 'en' : 'ko';
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        Vary: 'Accept-Language',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
      });
      res.end(PRIVACY_HTML[lang]);
      return;
    }
    res.writeHead(404, SECURITY_HEADERS);
    res.end();
  });

  const wss = new WebSocketServer({
    server,
    maxPayload: MAX_PAYLOAD,
    verifyClient: ({ origin }, done) => (originOk(origin) ? done(true) : done(false, 403, 'Forbidden')),
  });

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    // 연결 수 상한: 넘으면 이유를 알리고 바로 닫는다(확장이 안내를 띄우고 다시 시도하지 않는다)
    if (connTotal >= maxConnections || (connsByIp.get(ip) ?? 0) >= maxConnPerIp) {
      ws.send(JSON.stringify({ type: S2C.ERROR, code: ERR.TOO_MANY_CONNECTIONS, message: '접속이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.' }));
      ws.close(1013, 'too many connections'); // 1013: try again later
      return;
    }
    connTotal++;
    connsByIp.set(ip, (connsByIp.get(ip) ?? 0) + 1);
    ws.on('close', () => {
      connTotal--;
      const n = (connsByIp.get(ip) ?? 1) - 1;
      if (n > 0) connsByIp.set(ip, n);
      else connsByIp.delete(ip);
    });
    const conn = {
      ip,
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
          if (createLimited(ip)) {
            conn.send({ type: S2C.ERROR, code: ERR.TOO_MANY_ROOMS, message: '방을 너무 자주 만들고 있어요. 잠시 뒤에 다시 해 주세요.' });
            break;
          }
          rooms.create(conn, msg.userId, { password: msg.password, maxMembers: msg.maxMembers, lang: msg.lang, roomCode: msg.roomCode, mode: msg.mode, secret: msg.secret, restoreToken: msg.restoreToken });
          break;
        case C2S.JOIN_ROOM:
          rooms.join(conn, msg.roomCode, msg.userId, msg.password, msg.lang, msg.secret);
          break;
        case C2S.LEAVE_ROOM:
          rooms.leave(conn);
          break;
        case C2S.VIDEO:
          rooms.video(conn, msg);
          break;
        case C2S.RATE:
          rooms.rate(conn, msg);
          break;
        case C2S.SET_PERMISSION:
          rooms.setPermission(conn, msg.mode);
          break;
        case C2S.SET_ROOM_OPTIONS:
          rooms.setOptions(conn, msg);
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
          rooms.chat(conn, msg.text, msg.videoTime, msg.replyTo, msg.ad);
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
    // 배포 등으로 곧 꺼질 때: 연결된 모두에게 알리고 닫는다(1012 = service restart). 확장이 바로 다시 연결해 방을 복구한다
    announceRestart: () => {
      // 새 연결은 더 받지 않는다: 재접속이 죽어가는 서버에 붙지 않고 새 서버로 가야 한다
      server.close();
      for (const ws of wss.clients) {
        if (ws.readyState !== ws.OPEN) continue;
        ws.send(JSON.stringify({ type: S2C.SERVER_RESTARTING }));
        ws.close(1012, 'service restart');
      }
    },
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
  if (!process.env.RESTORE_KEY) console.warn('RESTORE_KEY 가 없어요: 서버가 재시작되면 방을 복구할 수 없어요(환경변수로 고정할 것)');
  const app = createServer();
  app.listen().then((p) => console.log(`server listening on :${p}`));
  // Render 는 배포할 때 새 서버를 먼저 띄우고 옛 서버에 SIGTERM 을 보낸다(기본 30초 뒤 강제 종료).
  // 옛 서버는 모두에게 재시작을 알리고 닫아서, 확장이 바로 새 서버로 다시 연결해 방을 복구하게 한다.
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig}: 재시작을 알리고 종료합니다`);
    app.announceRestart();
    setTimeout(() => app.close().then(() => process.exit(0)), 1000);
    setTimeout(() => process.exit(0), 10_000).unref(); // 닫히지 않아도 10초 안에는 끝낸다
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
