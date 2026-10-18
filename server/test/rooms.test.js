import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createServer } from '../src/index.js';
import { RoomManager } from '../src/rooms.js';

// 테스트는 모두 같은 주소(127.0.0.1)에서 오므로 IP 당 제한은 넉넉하게 둔다(제한 자체는 아래 별도 테스트가 확인)
const app = createServer({ port: 0, host: '127.0.0.1', graceMs: 200, emptyTtlMs: 200, bufferWaitMs: 400, resumeDelayMs: 100, maxConnPerIp: 1000, createRoomPerMin: 1000 });
let port;
before(async () => {
  port = await app.listen();
});
after(() => app.close());

const EXT_ORIGIN = `chrome-extension://${'a'.repeat(32)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let uid = 0;
const secretOf = (userId) => `secret-${userId}`.padEnd(32, 'x');
const newUserId = () => `user-${String(++uid).padStart(4, '0')}-testtest`;

class Client {
  constructor(userId = newUserId()) {
    this.userId = userId;
    this.inbox = [];
    this.waiters = [];
  }
  async open() {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(m);
      else this.inbox.push(m);
    });
    await new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
    });
    return this;
  }
  // 방 만들기/참가에는 본인 확인용 secret 이 필요하다. 테스트에서는 userId 로 만든 고정 값을 자동으로 붙인다(직접 넣으면 그대로 둔다)
  send(m) {
    if (typeof m === 'object' && (m.type === 'create_room' || m.type === 'join_room') && m.secret === undefined) m = { ...m, secret: secretOf(m.userId) };
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }
  // 조건에 맞는 메시지를 기다린다(이미 받은 것 포함)
  next(type, timeout = 1000) {
    const pred = (m) => m.type === type;
    const i = this.inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const k = this.waiters.indexOf(w);
        if (k >= 0) {
          this.waiters.splice(k, 1);
          reject(new Error(`timeout waiting for ${type}`));
        }
      }, timeout);
    });
  }
  // 해당 타입 메시지가 오지 않음을 확인
  async none(type, ms = 150) {
    await sleep(ms);
    assert.equal(this.inbox.some((m) => m.type === type), false, `unexpected ${type}`);
  }
  close() {
    this.ws.close();
  }
}

async function makeRoom() {
  const a = await new Client().open();
  a.send({ type: 'create_room', userId: a.userId });
  const created = await a.next('room_created');
  const state = await a.next('room_state');
  return { a, code: created.roomCode, created, state };
}

async function joinRoom(code) {
  const c = await new Client().open();
  c.send({ type: 'join_room', roomCode: code, userId: c.userId });
  return { c, state: await c.next('room_state') };
}

test('GET /privacy: 개인정보처리방침 페이지', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/privacy`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /개인정보처리방침/);
});

test('GET /privacy: ?lang=en 또는 Accept-Language 로 영어 페이지', async () => {
  const q = await fetch(`http://127.0.0.1:${port}/privacy?lang=en`);
  assert.match(await q.text(), /Privacy Policy/);
  const h = await fetch(`http://127.0.0.1:${port}/privacy`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  assert.match(await h.text(), /Privacy Policy/);
  const ko = await fetch(`http://127.0.0.1:${port}/privacy?lang=ko`, { headers: { 'Accept-Language': 'en-US' } });
  assert.match(await ko.text(), /개인정보처리방침/);
});

test('GET /health', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.headers.get('access-control-allow-origin'), null, '웹페이지(Origin 없음/확장이 아님)에는 CORS 헤더를 주지 않는다');
  const ext = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: EXT_ORIGIN } });
  assert.equal(ext.headers.get('access-control-allow-origin'), EXT_ORIGIN, '확장(호스트 권한 없는 스토어 빌드)이 잠든 서버를 깨우려면 CORS 헤더가 필요하다');
  const web = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(web.headers.get('access-control-allow-origin'), null);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('GET /rooms/<코드>: 방 존재 여부만 돌려준다', async () => {
  const { code } = await makeRoom();
  const url = (c) => `http://127.0.0.1:${port}/rooms/${c}`;
  const yes = await fetch(url(code));
  assert.equal(yes.status, 200);
  assert.equal(yes.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(url(code), { headers: { Origin: EXT_ORIGIN } })).headers.get('access-control-allow-origin'), EXT_ORIGIN);
  assert.deepEqual(await yes.json(), { exists: true, hasPassword: false });
  assert.deepEqual(await (await fetch(url(code.toLowerCase()))).json(), { exists: true, hasPassword: false });
  assert.deepEqual(await (await fetch(url('ZZZZZZ'))).json(), { exists: false, hasPassword: false });
  const locked = await makeRoomWith({ password: 'secret1' });
  assert.deepEqual(await (await fetch(url(locked.code))).json(), { exists: true, hasPassword: true });
  assert.equal((await fetch(url('abc'))).status, 404); // 형식이 다르면 없는 주소
});

test('GET /rooms/<코드>: IP 당 분당 횟수 제한', async () => {
  const limited = createServer({ port: 0, host: '127.0.0.1', roomCheckPerMin: 3 });
  const p = await limited.listen();
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`http://127.0.0.1:${p}/rooms/ABCDEF`)).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  } finally {
    await limited.close();
  }
});

test('extension/shared/protocol.js 는 서버 protocol.js 와 동일', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const server = readFileSync(`${dir}../src/protocol.js`, 'utf8');
  const ext = readFileSync(`${dir}../../extension/shared/protocol.js`, 'utf8');
  assert.equal(ext, server);
});

test('방 생성: 6자리 영숫자 코드, 만든 사람이 방장, 임시 이름', async () => {
  const { a, code, created, state } = await makeRoom();
  assert.match(code, /^[A-Z0-9]{6}$/);
  assert.equal(created.hostId, a.userId);
  assert.equal(state.hostId, a.userId);
  assert.equal(state.mode, 'everyone');
  assert.equal(state.participants.length, 1);
  assert.match(state.participants[0].name, /^게스트\d{4}$/);
  a.close();
});

test('참가(소문자 코드 허용), 입장 알림, video 중계(보낸 사람 제외)', async () => {
  const { a, code } = await makeRoom();
  const { c: b, state } = await joinRoom(code.toLowerCase());
  assert.equal(state.participants.length, 2);
  const joined = await a.next('participant_joined');
  assert.equal(joined.user.id, b.userId);

  a.send({ type: 'video', action: 'play', time: 12.5, sentAt: 111 });
  const v = await b.next('video');
  assert.deepEqual([v.action, v.time, v.sentAt, v.fromId], ['play', 12.5, 111, a.userId]);
  assert.ok(typeof v.serverAt === 'number');
  await a.none('video');

  b.send({ type: 'video', action: 'seek', time: 99, sentAt: 222 });
  const v2 = await a.next('video');
  assert.deepEqual([v2.action, v2.time, v2.fromId], ['seek', 99, b.userId]);
  a.close();
  b.close();
});

test('없는 방 참가는 error, 잘못된 메시지는 무시하고 연결 유지', async () => {
  const c = await new Client().open();
  c.send({ type: 'join_room', roomCode: 'ZZZZZZ', userId: c.userId });
  assert.equal((await c.next('error')).code, 'room_not_found');

  c.send('not json');
  c.send({ type: 'video', action: 'explode', time: 1, sentAt: 1 });
  c.send({ type: 'join_room', roomCode: 'x', userId: 'short' });
  c.send({ type: 'unknown_type' });
  c.send(JSON.stringify({ type: 'video', action: 'play', time: 1, sentAt: 1, pad: 'x'.repeat(9000) }));
  c.send({ type: 'ping' });
  await c.next('pong');
  c.close();
});

test('방장 전용 모드: 방장만 조작 가능, 모드 변경은 방장만', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);

  b.send({ type: 'set_permission', mode: 'host_only' }); // 방장 아님 → 무시
  await a.none('mode_changed');

  a.send({ type: 'set_permission', mode: 'host_only' });
  assert.equal((await a.next('mode_changed')).mode, 'host_only');
  assert.equal((await b.next('mode_changed')).mode, 'host_only');

  b.send({ type: 'video', action: 'play', time: 5, sentAt: 1 });
  assert.equal((await b.next('error')).code, 'not_allowed');
  await a.none('video');

  a.send({ type: 'video', action: 'pause', time: 7, sentAt: 2 });
  assert.equal((await b.next('video')).time, 7);

  a.send({ type: 'set_permission', mode: 'everyone' });
  await b.next('mode_changed');
  b.send({ type: 'video', action: 'play', time: 8, sentAt: 3 });
  assert.equal((await a.next('video')).time, 8);
  a.close();
  b.close();
});

test('늦게 입장: 마지막 영상 상태와 서버 시각 전달', async () => {
  const { a, code } = await makeRoom();
  a.send({ type: 'video', action: 'play', time: 10, sentAt: 1 });
  await sleep(300);
  const { c, state } = await joinRoom(code);
  assert.equal(state.video.playing, true);
  assert.equal(state.video.time, 10);
  assert.ok(state.serverNow - state.video.updatedAt >= 250, '경과 시간 보정 가능해야 함');

  a.send({ type: 'video', action: 'pause', time: 20, sentAt: 2 });
  await sleep(50);
  const { c: d, state: s2 } = await joinRoom(code);
  assert.equal(s2.video.playing, false);
  assert.equal(s2.video.time, 20);
  a.close();
  c.close();
  d.close();
});

test('방장 퇴장 시 가장 먼저 들어온 사람에게 위임', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  const { c } = await joinRoom(code);
  a.send({ type: 'leave_room' });
  assert.equal((await b.next('participant_left')).user.id, a.userId);
  assert.equal((await b.next('host_changed')).hostId, b.userId);
  assert.equal((await c.next('host_changed')).hostId, b.userId);
  a.close();
  b.close();
  c.close();
});

test('재접속: 유예 시간 안에 같은 userId 로 복귀하면 퇴장 알림 없음', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  await a.next('participant_joined');
  const bId = b.userId;
  b.close();
  await sleep(50);
  const b2 = await new Client(bId).open();
  b2.send({ type: 'join_room', roomCode: code, userId: bId });
  const st = await b2.next('room_state');
  assert.equal(st.participants.length, 2);
  await sleep(300); // 유예 시간(200ms) 경과
  await a.none('participant_left');
  a.close();
  b2.close();
});

test('유예 시간이 지나면 퇴장 처리', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  await a.next('participant_joined');
  b.close();
  const left = await a.next('participant_left', 1000);
  assert.equal(left.user.id, b.userId);
  a.close();
});

test('모두 나가면 일정 시간 뒤 방 삭제', async () => {
  const { a, code } = await makeRoom();
  a.send({ type: 'leave_room' });
  await sleep(50);
  const c1 = await new Client().open();
  c1.send({ type: 'join_room', roomCode: code, userId: c1.userId }); // TTL 이내: 아직 존재
  assert.equal((await c1.next('room_state')).roomCode, code);
  c1.send({ type: 'leave_room' });
  await sleep(400); // emptyTtlMs(200ms) 경과
  const c2 = await new Client().open();
  c2.send({ type: 'join_room', roomCode: code, userId: c2.userId });
  assert.equal((await c2.next('error')).code, 'room_not_found');
  a.close();
  c1.close();
  c2.close();
});

// ---------------- 2단계 ----------------

test('ping(clientTime) → server_time 로 시계 오차 보정용 값을 돌려줌', async () => {
  const c = await new Client().open();
  const t0 = Date.now();
  c.send({ type: 'ping', clientTime: t0 });
  await c.next('pong');
  const st = await c.next('server_time');
  assert.equal(st.clientTime, t0);
  assert.ok(Math.abs(st.serverNow - Date.now()) < 1000);
  c.close();
});

test('카운트다운: 방장만 시작, startAt 은 서버 시각, 모두에게 같은 값', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  b.send({ type: 'countdown_start', seconds: 3 });
  assert.equal((await b.next('error')).code, 'not_allowed');
  await a.none('countdown');

  a.send({ type: 'video', action: 'seek', time: 42, sentAt: 1 });
  await b.next('video');
  const before = Date.now();
  a.send({ type: 'countdown_start', seconds: 3 });
  const ca = await a.next('countdown');
  const cb = await b.next('countdown');
  assert.equal(ca.startAt, cb.startAt);
  assert.equal(ca.time, 42);
  assert.ok(ca.startAt >= before + 3000 && ca.startAt <= Date.now() + 3000);

  // 카운트다운 중 입장: "startAt 에 재생 시작" 상태를 받는다
  const { state } = await joinRoom(code);
  assert.equal(state.video.playing, true);
  assert.equal(state.video.updatedAt, ca.startAt);
  assert.ok(state.video.updatedAt > state.serverNow);

  a.send({ type: 'countdown_start', seconds: 0 }); // 범위 밖은 무시
  a.send({ type: 'countdown_start', seconds: 99 });
  await a.none('countdown');
  a.close();
  b.close();
});

test('버퍼링: 한 명이 버퍼링하면 방 정지, 해소되면 함께 재개', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 30, sentAt: 1 });
  await b.next('video');

  b.send({ type: 'buffering', isBuffering: true, time: 31.5 });
  const sa = await a.next('buffer_state');
  await b.next('buffer_state');
  assert.deepEqual(sa.waitingIds, [b.userId]);
  assert.equal(sa.video.playing, false);
  assert.equal(sa.video.time, 31.5);

  const before = Date.now();
  b.send({ type: 'buffering', isBuffering: false });
  const resumed = await a.next('buffer_state');
  assert.deepEqual(resumed.waitingIds, []);
  assert.equal(resumed.video.playing, true);
  assert.equal(resumed.video.time, 31.5);
  assert.ok(resumed.video.updatedAt >= before + 90, '재개는 약간 뒤의 서버 시각');
  a.close();
  b.close();
});

test('버퍼링: 대기 상한이 지나면 강제 재개', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 5, sentAt: 1 });
  await b.next('video');
  b.send({ type: 'buffering', isBuffering: true });
  await a.next('buffer_state');
  const forced = await a.next('buffer_state', 1500); // bufferWaitMs=400
  assert.deepEqual(forced.waitingIds, []);
  assert.equal(forced.video.playing, true);
  a.close();
  b.close();
});

test('버퍼링: 재생 중이 아니면 무시, 버퍼링 중 나가면 대기 해제', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  b.send({ type: 'buffering', isBuffering: true }); // 정지 상태 → 무시
  await a.none('buffer_state');

  a.send({ type: 'video', action: 'play', time: 1, sentAt: 1 });
  await b.next('video');
  b.send({ type: 'buffering', isBuffering: true });
  await a.next('buffer_state');
  b.send({ type: 'leave_room' });
  const after = await a.next('buffer_state');
  assert.deepEqual(after.waitingIds, []);
  assert.equal(after.video.playing, true);
  a.close();
  b.close();
});

test('버퍼링 중 사용자가 직접 일시정지하면 자동 재개하지 않음', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 1, sentAt: 1 });
  await b.next('video');
  b.send({ type: 'buffering', isBuffering: true });
  await a.next('buffer_state');
  a.send({ type: 'video', action: 'pause', time: 2, sentAt: 2 });
  await b.next('video');
  b.send({ type: 'buffering', isBuffering: false });
  const st = await a.next('buffer_state');
  assert.equal(st.video.playing, false);
  a.close();
  b.close();
});

test('sync_report: 방장 위치만 기준점이 되어 다른 참가자에게 전달', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 10, sentAt: 1 });
  await b.next('video');

  b.send({ type: 'sync_report', time: 99, playing: true, sentAt: 2 }); // 방장 아님 → 무시
  await a.none('video');

  a.send({ type: 'sync_report', time: 12.3, playing: true, sentAt: 3 });
  const v = await b.next('video');
  assert.deepEqual([v.action, v.time, v.fromId], ['sync', 12.3, a.userId]);
  await a.none('video');

  const { state } = await joinRoom(code);
  assert.equal(state.video.time, 12.3);
  a.close();
  b.close();
});

test('버퍼링 중 시크는 자동 재개를 취소하지 않고 위치만 갱신', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 1, sentAt: 1 });
  await b.next('video');
  b.send({ type: 'buffering', isBuffering: true, time: 50 });
  await a.next('buffer_state');
  b.send({ type: 'video', action: 'seek', time: 50.2, sentAt: 2 }); // 늦게 도착한 seeked
  assert.equal((await a.next('video')).time, 50.2);
  b.send({ type: 'buffering', isBuffering: false });
  const st = await a.next('buffer_state');
  assert.equal(st.video.playing, true);
  assert.equal(st.video.time, 50.2);
  a.close();
  b.close();
});

// ---------------- 3단계 ----------------

const PROFILE = { name: '가연', avatar: { kind: 'emoji', value: '🐻', bg: '#FFAA00' }, color: '#38d9a9' };

test('입장 시 기본 프로필(이름/이모지/색)이 부여된다', async () => {
  const { a, state } = await makeRoom();
  const me = state.participants[0];
  assert.match(me.name, /^게스트\d{4}$/);
  assert.equal(me.avatar.kind, 'emoji');
  assert.match(me.avatar.bg, /^#[0-9a-f]{6}$/);
  assert.match(me.color, /^#[0-9a-f]{6}$/);
  a.close();
});

test('프로필 변경은 본인 포함 방 전체에 전파되고, 이후 입장자/재입장에 반영', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  await a.next('participant_joined');
  a.send({ type: 'profile_update', profile: PROFILE });
  const ua = await a.next('profile_updated');
  const ub = await b.next('profile_updated');
  assert.deepEqual(ub.user, ua.user);
  assert.equal(ua.user.id, a.userId);
  assert.equal(ua.user.name, '가연');
  assert.equal(ua.user.avatar.bg, '#ffaa00'); // 정규화(소문자)

  const { state } = await joinRoom(code);
  const found = state.participants.find((p) => p.id === a.userId);
  assert.equal(found.name, '가연');
  assert.equal(found.avatar.value, '🐻');
  a.close();
  b.close();
});

test('잘못된 프로필은 무시', async () => {
  const { a } = await makeRoom();
  const bad = [
    { ...PROFILE, name: '' },
    { ...PROFILE, name: 'x'.repeat(17) },
    { ...PROFILE, name: 'a​b' }, // 제로폭 문자
    { ...PROFILE, avatar: { kind: 'emoji', value: 'ab', bg: '#ffaa00' } },
    { ...PROFILE, avatar: { kind: 'emoji', value: '🐻🐻', bg: '#ffaa00' } },
    { ...PROFILE, avatar: { kind: 'image', value: 'data:image/png;base64,AAAA', bg: '#ffaa00' } },
    { ...PROFILE, avatar: { kind: 'emoji', value: '🐻', bg: 'red' } },
    { ...PROFILE, avatar: { kind: 'emoji', value: 'A', bg: '#ffaa00' } },
    { ...PROFILE, color: 'javascript:1' },
  ];
  for (const profile of bad) a.send({ type: 'profile_update', profile });
  await a.none('profile_updated');
  a.close();
});

test('채팅: 본인 포함 전체 전달, userId 만 붙고 서버 시각, 길이/빈 문자열 검증', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'chat', text: '  안녕하세요 <b>x</b>\n둘째줄 ' });
  const ca = await a.next('chat');
  const cb = await b.next('chat');
  assert.deepEqual(ca, cb);
  assert.equal(ca.userId, a.userId);
  assert.equal(ca.text, '안녕하세요 <b>x</b>\n둘째줄'); // 태그는 그대로(클라이언트가 textContent 로 렌더링), 줄바꿈은 유지
  assert.ok(Math.abs(ca.sentAt - Date.now()) < 1000);
  assert.deepEqual(Object.keys(ca).sort(), ['id', 'sentAt', 'text', 'type', 'userId']);
  assert.match(ca.id, /^[0-9a-f]{8}$/);

  a.send({ type: 'chat', text: '   ' });
  a.send({ type: 'chat', text: 'x'.repeat(2001) });
  a.send({ type: 'chat', text: 123 });
  a.send({ type: 'chat', text: 'a\u0007b' }); // 제어문자
  await b.none('chat');
  a.close();
  b.close();
});

test('채팅 답장: replyTo 는 형식이 맞을 때만 전달, 메시지마다 id 가 다름', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'chat', text: '원본' });
  const orig = await b.next('chat');
  b.send({ type: 'chat', text: '답장', replyTo: orig.id });
  const reply = await a.next('chat'); // 원본(a 본인 수신분)
  const got = await a.next('chat');
  assert.equal(reply.id, orig.id);
  assert.equal(got.replyTo, orig.id);
  assert.notEqual(got.id, orig.id);
  b.send({ type: 'chat', text: '엉뚱', replyTo: '<script>' });
  const bad = await a.next('chat');
  assert.equal(bad.text, '엉뚱');
  assert.equal('replyTo' in bad, false);
  a.close();
  b.close();
});

test('채팅: 긴 글(2000자)과 줄바꿈 정리', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  const long = '가'.repeat(2000);
  a.send({ type: 'chat', text: long });
  assert.equal((await b.next('chat')).text, long);
  const quoted = '"'.repeat(2000); // JSON 이스케이프로 크기가 두 배가 돼도 통과
  a.send({ type: 'chat', text: quoted });
  assert.equal((await b.next('chat')).text, quoted);
  a.send({ type: 'chat', text: '첫 줄  \r\n\r\n\r\n\r\n셋째\t줄' });
  assert.equal((await b.next('chat')).text, '첫 줄\n\n셋째 줄');
  a.close();
  b.close();
});

test('채팅 빈도 제한: 도배는 일부만 전달', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  for (let i = 0; i < 30; i++) a.send({ type: 'chat', text: `m${i}` });
  await sleep(300);
  const got = b.inbox.filter((m) => m.type === 'chat').length;
  assert.ok(got >= 5 && got <= 8, `전달된 개수 ${got}`);
  a.close();
  b.close();
});

test('입력 중 표시: 보낸 사람 제외 전달', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'typing', isTyping: true });
  const t = await b.next('typing');
  assert.deepEqual([t.userId, t.isTyping], [a.userId, true]);
  await a.none('typing');
  a.send({ type: 'typing', isTyping: false });
  assert.equal((await b.next('typing')).isTyping, false);
  a.close();
  b.close();
});

test('이모지 리액션: 이모지는 모두 허용(조합/국기 포함), 텍스트는 거부, 사용자당 초당 횟수 제한', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  for (const bad of ['<script>', 'ab', '❤️❤️', '', 'A', '1']) a.send({ type: 'reaction', emoji: bad });
  await b.none('reaction');
  await sleep(1200); // 버킷 보충
  for (const ok of ['💩', '🧑‍🚀', '🇰🇷', '1️⃣']) {
    a.send({ type: 'reaction', emoji: ok });
    assert.equal((await b.next('reaction')).emoji, ok);
    await sleep(400); // 버킷 보충
  }
  await sleep(1200);
  b.inbox.length = 0;
  a.inbox.length = 0;
  for (let i = 0; i < 20; i++) a.send({ type: 'reaction', emoji: '❤️' });
  await sleep(300);
  const got = b.inbox.filter((m) => m.type === 'reaction');
  assert.ok(got.length >= 3 && got.length <= 4, `전달된 개수 ${got.length}`);
  assert.deepEqual([got[0].userId, got[0].emoji], [a.userId, '❤️']);
  assert.equal(a.inbox.filter((m) => m.type === 'reaction').length, got.length, '본인에게도 전달');
  a.close();
  b.close();
});


// ---------------- 4단계 ----------------

// 검증기는 형식/크기/파일 헤더만 보므로 테스트용으로 헤더만 맞춘 바이트열을 쓴다
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const fakeWebp = (n = 200) => b64([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...new Array(n).fill(7)]);
const fakeJpeg = (n = 200) => b64([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(7)]);
const img = (data, mime = 'webp') => ({ ...PROFILE, avatar: { kind: 'image', value: `data:image/${mime};base64,${data}`, bg: '#ffaa00' } });

test('이미지 프사: WebP/JPEG 데이터 URL 이 모든 참가자에게 전달된다', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  await a.next('participant_joined');
  a.send({ type: 'profile_update', profile: img(fakeWebp()) });
  const u = await b.next('profile_updated');
  assert.equal(u.user.avatar.kind, 'image');
  assert.equal(u.user.avatar.value, `data:image/webp;base64,${fakeWebp()}`);
  await sleep(50);
  const { state } = await joinRoom(code); // 이후 입장자의 room_state 에도 포함
  assert.equal(state.participants.find((p) => p.id === a.userId).avatar.kind, 'image');
  a.close();
  b.close();
});

test('이미지 프사: 같은 사진으로 색만 여러 번 바꿔도 모두 반영된다', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  await a.next('participant_joined');
  a.send({ type: 'profile_update', profile: img(fakeWebp()) });
  await b.next('profile_updated');
  const colors = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'];
  for (const color of colors) a.send({ type: 'profile_update', profile: { ...img(fakeWebp()), color } });
  for (const color of colors) assert.equal((await b.next('profile_updated')).user.color, color);
  a.close();
  b.close();
});

test('이미지 프사 검증: 크기 상한(20KB), MIME, 파일 헤더, base64 형식', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  await a.next('participant_joined');

  a.send({ type: 'profile_update', profile: img(fakeJpeg(20 * 1024 - 4), 'jpeg') }); // 정확히 20KB: 허용
  assert.equal((await b.next('profile_updated')).user.avatar.kind, 'image');

  const bad = [
    img(fakeWebp(20 * 1024)), // 20KB 초과
    img(fakeJpeg(), 'webp'), // 선언은 webp, 실제는 jpeg
    img(fakeWebp(), 'jpeg'), // 선언은 jpeg, 실제는 webp
    img(b64(Buffer.from('<svg onload=alert(1)>'.padEnd(64))), 'webp'), // 이미지가 아님
    img(fakeWebp(), 'png'), // 허용하지 않는 MIME
    img('****not base64****'),
    img(fakeWebp() + '!!'),
    { ...PROFILE, avatar: { kind: 'image', value: 'https://evil.example/a.png', bg: '#ffaa00' } }, // 외부 URL 금지
    { ...PROFILE, avatar: { kind: 'image', value: 'javascript:alert(1)', bg: '#ffaa00' } },
  ];
  for (const profile of bad) a.send({ type: 'profile_update', profile });
  await b.none('profile_updated', 300);
  a.close();
  b.close();
});

test('이미지 프로필 변경은 빈도 제한(증폭 방지), 이모지 프로필은 느슨', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  await a.next('participant_joined');
  for (let i = 0; i < 10; i++) a.send({ type: 'profile_update', profile: img(fakeWebp(100 + i)) });
  await sleep(300);
  const imgs = b.inbox.filter((m) => m.type === 'profile_updated').length;
  assert.ok(imgs >= 3 && imgs <= 4, `이미지 프로필 전달 ${imgs}`);
  b.inbox.length = 0;
  for (let i = 0; i < 8; i++) a.send({ type: 'profile_update', profile: { ...PROFILE, name: `n${i}` } });
  await sleep(300);
  assert.equal(b.inbox.filter((m) => m.type === 'profile_updated').length, 8);
  a.close();
  b.close();
});

test('profile_update 만 큰 메시지 허용, 다른 타입은 8KB 초과 거부', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send(JSON.stringify({ type: 'chat', text: 'ok', pad: 'x'.repeat(9000) }));
  await b.none('chat');
  a.send({ type: 'ping' });
  await a.next('pong'); // 연결은 유지
  a.close();
  b.close();
});

test('채팅 재생 시각(videoTime): 선택 필드로 그대로 전달, 잘못된 값은 무시', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'chat', text: '이 장면', videoTime: 754.5 });
  assert.equal((await b.next('chat')).videoTime, 754.5);
  a.send({ type: 'chat', text: '시간 없음' });
  assert.equal('videoTime' in (await b.next('chat')), false);
  await sleep(1500);
  a.send({ type: 'chat', text: 'x', videoTime: -1 });
  a.send({ type: 'chat', text: 'x', videoTime: 'abc' });
  a.send({ type: 'chat', text: 'x', videoTime: 1e9 });
  await b.none('chat');
  a.close();
  b.close();
});

test('광고: 광고 보는 사람이 있으면 방이 멈추고, 광고가 끝나면 함께 재개된다(버퍼링 상한과 무관)', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 10, sentAt: 1 });
  await b.next('video');
  b.send({ type: 'buffering', isBuffering: true, reason: 'ad' });
  const s1 = await a.next('buffer_state');
  assert.deepEqual(s1.waitingIds, [b.userId]);
  assert.deepEqual(s1.adIds, [b.userId]);
  assert.equal(s1.video.playing, false);
  await sleep(700); // bufferWaitMs(400) 이후에도 광고 중이면 계속 기다린다
  b.send({ type: 'buffering', isBuffering: false });
  const s2 = await a.next('buffer_state');
  assert.deepEqual(s2.waitingIds, []);
  assert.equal(s2.video.playing, true);
  a.close();
  b.close();
});

test('광고 reason 검증: ad 외의 값은 거부', async () => {
  const { a } = await makeRoom();
  a.send({ type: 'buffering', isBuffering: true, reason: 'x' });
  await a.none('buffer_state');
  a.close();
});

test('광고: 광고 전환 중 먼저 전해진 0초 이동은 광고 보고 때 되돌려진다', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 100, sentAt: 1 });
  await b.next('video');
  b.send({ type: 'video', action: 'seek', time: 0, sentAt: 2 }); // 광고로 바뀌는 순간 b 의 영상이 0초가 됨
  const jumped = await a.next('video');
  assert.equal(jumped.time, 0);
  b.send({ type: 'buffering', isBuffering: true, reason: 'ad' });
  const s = await a.next('buffer_state');
  assert.ok(s.video.time >= 100 && s.video.time < 105, `time=${s.video.time}`);
  assert.equal(s.video.playing, false);
  a.close();
  b.close();
});

test('광고 보고: 진짜로 0초 근처로 간 것이 아니면(가까운 위치 이동) 되돌리지 않는다', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 100, sentAt: 1 });
  await b.next('video');
  b.send({ type: 'video', action: 'seek', time: 120, sentAt: 2 });
  await a.next('video');
  b.send({ type: 'buffering', isBuffering: true, reason: 'ad' });
  const s = await a.next('buffer_state');
  assert.ok(s.video.time >= 120, `time=${s.video.time}`);
  a.close();
  b.close();
});

test('광고: 0초 이동 + 0초 재생이 연달아 전해진 뒤 광고 보고가 와도 처음 상태로 되돌려진다', async () => {
  const { a, code } = await makeRoom();
  const { c: b } = await joinRoom(code);
  a.send({ type: 'video', action: 'play', time: 100, sentAt: 1 });
  await b.next('video');
  b.send({ type: 'video', action: 'seek', time: 0, sentAt: 2 });
  await a.next('video');
  b.send({ type: 'video', action: 'play', time: 0, sentAt: 3 });
  await a.next('video');
  b.send({ type: 'buffering', isBuffering: true, reason: 'ad' });
  const s = await a.next('buffer_state');
  assert.ok(s.video.time >= 100 && s.video.time < 106, `time=${s.video.time}`);
  b.send({ type: 'buffering', isBuffering: false });
  const resumed = await a.next('buffer_state');
  assert.ok(resumed.video.playing && resumed.video.time >= 100, JSON.stringify(resumed.video));
  a.close();
  b.close();
});

// ---- 반응 없는 방 자동 삭제(가짜 시계와 가짜 연결로 시간을 흘려 확인) ----
function fakeConn() {
  const conn = { sent: [], send: (m) => conn.sent.push(m), close() {}, userId: null, roomCode: null };
  return conn;
}

test('반응 없는 방은 idleTtlMs 뒤에 닫히고 참가자에게 알림', () => {
  let t = 0;
  const rm = new RoomManager({ idleTtlMs: 60_000, idleSweepMs: 3_600_000, now: () => t });
  const a = fakeConn();
  rm.create(a, 'user-aaaa-testtest', { secret: secretOf('user-aaaa-testtest') });
  const code = [...rm.rooms.keys()][0];
  t = 59_000;
  rm.closeIdleRooms();
  assert.equal(rm.rooms.size, 1, '기준 시간 전에는 유지');
  t = 61_000;
  rm.closeIdleRooms();
  assert.equal(rm.rooms.size, 0, '기준 시간이 지나면 닫힘');
  const err = a.sent.find((m) => m.type === 'error');
  assert.equal(err?.code, 'room_idle_closed');
  assert.match(err.message, /활동/);
  assert.equal(a.roomCode, null);
  rm.shutdown();
  assert.ok(code);
});

test('채팅/재생 같은 활동이 있으면 idle 시간이 다시 시작됨', () => {
  let t = 0;
  const rm = new RoomManager({ idleTtlMs: 60_000, idleSweepMs: 3_600_000, now: () => t });
  const a = fakeConn();
  rm.create(a, 'user-bbbb-testtest', { secret: secretOf('user-bbbb-testtest') });
  t = 50_000;
  rm.chat(a, '안녕', undefined);
  t = 100_000; // 마지막 활동(50초) 기준 50초 지남
  rm.closeIdleRooms();
  assert.equal(rm.rooms.size, 1, '채팅 뒤 새로 시작');
  rm.video(a, { action: 'play', time: 10, sentAt: t });
  t = 150_000;
  rm.syncReport(a, { time: 50, playing: true, sentAt: t }); // 재생 중 위치 보고도 활동
  t = 200_000;
  rm.closeIdleRooms();
  assert.equal(rm.rooms.size, 1, '재생 중 위치 보고도 활동으로 잡힘');
  t = 300_000;
  rm.closeIdleRooms();
  assert.equal(rm.rooms.size, 0, '활동이 멈추면 닫힘');
  rm.shutdown();
});

// ---------- 방 비밀번호 / 인원 제한 / 참가 시도 제한 ----------

async function makeRoomWith(opts) {
  const a = await new Client().open();
  a.send({ type: 'create_room', userId: a.userId, ...opts });
  const created = await a.next('room_created');
  const state = await a.next('room_state');
  return { a, code: created.roomCode, state };
}

test('비밀번호 방: 비밀번호 없이/틀리게 참가하면 거부, 맞으면 입장', async () => {
  const { a, code, state } = await makeRoomWith({ password: 'secret1' });
  assert.equal(state.hasPassword, true);
  assert.equal(JSON.stringify(state).includes('secret1'), false, '비밀번호는 내려보내지 않음');
  const c = await new Client().open();
  c.send({ type: 'join_room', roomCode: code, userId: c.userId });
  assert.equal((await c.next('error')).code, 'password_required');
  c.send({ type: 'join_room', roomCode: code, userId: c.userId, password: 'nope' });
  assert.equal((await c.next('error')).code, 'wrong_password');
  await a.none('participant_joined');
  c.send({ type: 'join_room', roomCode: code, userId: c.userId, password: 'secret1' });
  assert.equal((await c.next('room_state')).hasPassword, true);
  assert.equal((await a.next('participant_joined')).user.id, c.userId);
});

test('비밀번호 방: 이미 방에 있는 사람의 재접속은 비밀번호 없이 가능', async () => {
  const { a, code } = await makeRoomWith({ password: 'secret1' });
  const again = await new Client(a.userId).open();
  again.send({ type: 'join_room', roomCode: code, userId: a.userId });
  assert.equal((await again.next('room_state')).roomCode, code);
});

test('비밀번호 없는 방은 hasPassword=false, password 를 보내도 무시되지 않고 입장', async () => {
  const { code, state } = await makeRoomWith({});
  assert.equal(state.hasPassword, false);
  assert.equal(state.maxMembers, null);
  const c = await new Client().open();
  c.send({ type: 'join_room', roomCode: code, userId: c.userId, password: 'whatever' });
  await c.next('room_state');
});

test('인원 제한: 가득 차면 거부, 재접속은 자리를 차지하지 않음', async () => {
  const { a, code, state } = await makeRoomWith({ maxMembers: 2 });
  assert.equal(state.maxMembers, 2);
  const { c: b } = await joinRoom(code);
  const c = await new Client().open();
  c.send({ type: 'join_room', roomCode: code, userId: c.userId });
  const full = await c.next('error');
  assert.equal(full.code, 'room_full');
  assert.equal(full.max, 2, '번역 문구에 쓸 최대 인원을 함께 보낸다');
  const again = await new Client(b.userId).open();
  again.send({ type: 'join_room', roomCode: code, userId: b.userId });
  await again.next('room_state');
  b.close();
  a.close();
});

test('잘못된 방 옵션은 무시된다', async () => {
  const c = await new Client().open();
  for (const bad of [{ password: 'abc' }, { password: 'x'.repeat(33) }, { password: '비밀번호1234' }, { password: 'pass word1' }, { password: 'pass!word1' }, { maxMembers: 1 }, { maxMembers: 99 }, { maxMembers: '5' }]) {
    c.send({ type: 'create_room', userId: c.userId, ...bad });
  }
  await c.none('room_created');
  c.close();
});

test('참가 실패가 잦으면 IP 별로 잠시 차단', () => {
  let t = 0;
  const rm = new RoomManager({ joinFailLimit: 3, joinFailWindowMs: 60_000, idleSweepMs: 3_600_000, now: () => t });
  const host = fakeConn();
  rm.create(host, 'user-aaaa-testtest', { password: 'secret1', secret: secretOf('user-aaaa-testtest') });
  const code = [...rm.rooms.keys()][0];
  const guess = () => {
    const g = fakeConn();
    g.ip = '1.2.3.4';
    return g;
  };
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const g = guess();
    rm.join(g, i % 2 ? 'ZZZZZZ' : code, `user-guess${i}-testtest`, i % 2 ? undefined : 'wrong', undefined, secretOf(`user-guess${i}-testtest`));
    codes.push(g.sent.find((m) => m.type === 'error').code);
  }
  assert.deepEqual(codes, ['wrong_password', 'room_not_found', 'wrong_password', 'too_many_attempts', 'too_many_attempts']);
  const other = fakeConn();
  other.ip = '5.6.7.8';
  rm.join(other, code, 'user-other-testtest', 'secret1', undefined, secretOf('user-other-testtest'));
  assert.ok(other.sent.some((m) => m.type === 'room_state'), '다른 IP 는 영향 없음');
  t = 61_000;
  const later = guess();
  rm.join(later, code, 'user-later-testtest', 'secret1', undefined, secretOf('user-later-testtest'));
  assert.ok(later.sent.some((m) => m.type === 'room_state'), '시간이 지나면 풀림');
  rm.shutdown();
});

test('방장이 방 옵션을 바꾼다: 비밀번호 설정/변경/해제, 최대 인원', async () => {
  const { a, code } = await makeRoomWith({});
  const { c: b } = await joinRoom(code);
  await a.next('participant_joined');
  // 설정: 모두에게 알림(비밀번호 내용은 없음), 이미 있는 사람은 그대로
  a.send({ type: 'set_room_options', password: 'newpass1', maxMembers: 3 });
  const opt = await b.next('room_options');
  assert.deepEqual({ ...opt }, { type: 'room_options', hasPassword: true, maxMembers: 3, passwordChanged: true, fromId: a.userId });
  assert.equal(JSON.stringify(opt).includes('newpass1'), false);
  await a.next('room_options');
  // 새로 오는 사람은 새 비밀번호가 필요
  const c = await new Client().open();
  c.send({ type: 'join_room', roomCode: code, userId: c.userId });
  assert.equal((await c.next('error')).code, 'password_required');
  c.send({ type: 'join_room', roomCode: code, userId: c.userId, password: 'newpass1' });
  await c.next('room_state');
  // 인원을 현재(3)보다 줄여도 있는 사람은 유지, 새로 오는 사람만 막힘
  a.send({ type: 'set_room_options', maxMembers: 2 });
  const opt2 = await b.next('room_options');
  assert.equal(opt2.passwordChanged, false);
  assert.equal(opt2.maxMembers, 2);
  const d = await new Client().open();
  d.send({ type: 'join_room', roomCode: code, userId: d.userId, password: 'newpass1' });
  assert.equal((await d.next('error')).code, 'room_full');
  // 해제
  a.send({ type: 'set_room_options', password: null, maxMembers: null });
  const opt3 = await b.next('room_options');
  assert.deepEqual([opt3.hasPassword, opt3.maxMembers], [false, null]);
  d.send({ type: 'join_room', roomCode: code, userId: d.userId });
  await d.next('room_state');
});

test('방 옵션은 방장만 바꿀 수 있고, 잘못된 값은 무시된다', async () => {
  const { a, code } = await makeRoomWith({ password: 'secret1' });
  const b = await new Client().open();
  b.send({ type: 'join_room', roomCode: code, userId: b.userId, password: 'secret1' });
  await b.next('room_state');
  b.send({ type: 'set_room_options', password: null });
  await a.none('room_options');
  for (const bad of [{}, { password: 'abc' }, { password: '비밀번호1234' }, { maxMembers: 1 }, { maxMembers: 21 }, { maxMembers: '5' }, { password: 1234 }]) {
    a.send({ type: 'set_room_options', ...bad });
  }
  await a.none('room_options');
  // 비밀번호는 그대로
  const c = await new Client().open();
  c.send({ type: 'join_room', roomCode: code, userId: c.userId });
  assert.equal((await c.next('error')).code, 'password_required');
});

test('기본 닉네임: 클라이언트 언어(lang)에 따라 게스트/Guest, 잘못된 값은 게스트', async () => {
  const en = await makeRoomWith({ lang: 'en' });
  assert.match(en.state.participants[0].name, /^Guest\d{4}$/);
  const bad = await new Client().open();
  bad.send({ type: 'join_room', roomCode: en.code, userId: bad.userId, lang: 'fr' });
  const st = await bad.next('room_state');
  assert.match(st.participants.find((p) => p.id === bad.userId).name, /^게스트\d{4}$/);
  const ko = await new Client().open();
  ko.send({ type: 'join_room', roomCode: en.code, userId: ko.userId, lang: 'en' });
  const st2 = await ko.next('room_state');
  assert.match(st2.participants.find((p) => p.id === ko.userId).name, /^Guest\d{4}$/);
  en.a.close(); bad.close(); ko.close();
});


// ---- 남용 방지: 연결 수 / 방 수 상한 (이슈 #39)
async function limitedServer(opts) {
  const srv = createServer({ port: 0, host: '127.0.0.1', ...opts });
  const p = await srv.listen();
  const open = () =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}`);
      const msgs = [];
      const closed = new Promise((r) => ws.once('close', (code) => r(code)));
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
      ws.once('open', () => resolve({ ws, msgs, closed }));
      ws.once('error', reject);
    });
  return { srv, open };
}

test('IP 당 동시 연결 수 상한: 넘으면 too_many_connections 를 알리고 닫는다, 하나 닫으면 다시 가능', async () => {
  const { srv, open } = await limitedServer({ maxConnPerIp: 2 });
  try {
    const a = await open();
    const b = await open();
    const c = await open();
    assert.equal(await c.closed, 1013);
    assert.equal(c.msgs[0].type, 'error');
    assert.equal(c.msgs[0].code, 'too_many_connections');
    assert.equal(a.ws.readyState, WebSocket.OPEN, '이미 열린 연결은 그대로');
    a.ws.close();
    await a.closed;
    await sleep(50);
    const d = await open();
    await sleep(100);
    assert.equal(d.ws.readyState, WebSocket.OPEN);
    assert.equal(d.msgs.length, 0);
    b.ws.close();
    d.ws.close();
  } finally {
    await srv.close();
  }
});

test('서버 전체 연결 수 상한', async () => {
  const { srv, open } = await limitedServer({ maxConnections: 2, maxConnPerIp: 100 });
  try {
    const a = await open();
    const b = await open();
    const c = await open();
    assert.equal(await c.closed, 1013);
    assert.equal(c.msgs[0].code, 'too_many_connections');
    a.ws.close();
    b.ws.close();
  } finally {
    await srv.close();
  }
});

test('IP 당 분당 방 만들기 횟수 상한: 넘으면 too_many_rooms, 방은 만들어지지 않는다', async () => {
  const { srv, open } = await limitedServer({ createRoomPerMin: 2 });
  try {
    const a = await open();
    for (let i = 0; i < 3; i++) a.ws.send(JSON.stringify({ type: 'create_room', userId: `ratelimit-user-${i}`, secret: secretOf(`ratelimit-user-${i}`) }));
    await sleep(200);
    assert.equal(a.msgs.filter((m) => m.type === 'room_created').length, 2);
    assert.equal(a.msgs.filter((m) => m.code === 'too_many_rooms').length, 1);
    assert.equal(srv.rooms.rooms.size, 2);
    a.ws.close();
  } finally {
    await srv.close();
  }
});

test('서버 전체 방 수 상한: 넘으면 server_full, 방이 닫히면 다시 만들 수 있다', async () => {
  const { srv, open } = await limitedServer({ maxRooms: 1, createRoomPerMin: 100 });
  try {
    const a = await open();
    const b = await open();
    a.ws.send(JSON.stringify({ type: 'create_room', userId: 'fullserver-user-a', secret: secretOf('fullserver-user-a') }));
    await sleep(100);
    assert.equal(a.msgs.some((m) => m.type === 'room_created'), true);
    b.ws.send(JSON.stringify({ type: 'create_room', userId: 'fullserver-user-b', secret: secretOf('fullserver-user-b') }));
    await sleep(100);
    assert.equal(b.msgs.find((m) => m.type === 'error')?.code, 'server_full');
    assert.equal(b.msgs.some((m) => m.type === 'room_created'), false);
    a.ws.send(JSON.stringify({ type: 'leave_room' }));
    await sleep(100);
    // 방에서 나가도 비어 있는 방은 잠시 남는다: 전체 방 수는 방이 실제로 삭제될 때 줄어든다
    for (const code of [...srv.rooms.rooms.keys()]) srv.rooms.rooms.delete(code);
    b.ws.send(JSON.stringify({ type: 'create_room', userId: 'fullserver-user-b', secret: secretOf('fullserver-user-b') }));
    await sleep(100);
    assert.equal(b.msgs.some((m) => m.type === 'room_created'), true);
    a.ws.close();
    b.ws.close();
  } finally {
    await srv.close();
  }
});

// ---- 서버 재시작 대비: 방 복구와 재시작 알림
test('방 복구: create_room 에 roomCode/mode/옵션을 주면 같은 코드로 다시 만든다, 이미 있으면 room_exists', async () => {
  const a = await new Client().open();
  a.send({ type: 'create_room', userId: a.userId, roomCode: 'rst234', restoreToken: app.rooms.issueRestoreToken('RST234'), mode: 'host_only', maxMembers: 3, password: 'secret1' });
  const created = await a.next('room_created');
  assert.equal(created.roomCode, 'RST234', '소문자로 보내도 대문자로 만든다');
  const state = await a.next('room_state');
  assert.equal(state.mode, 'host_only');
  assert.equal(state.maxMembers, 3);
  assert.equal(state.hasPassword, true);
  assert.equal(state.hostId, a.userId);

  // 같은 코드로 또 복구하려 하면(다른 사람이 먼저 복구한 경우) 에러, 방은 그대로
  const b = await new Client().open();
  b.send({ type: 'create_room', userId: b.userId, roomCode: 'RST234', restoreToken: app.rooms.issueRestoreToken('RST234') });
  assert.equal((await b.next('error')).code, 'room_exists');
  await b.none('room_created');
  // 비밀번호는 복구된 방에서도 지켜진다
  b.send({ type: 'join_room', roomCode: 'RST234', userId: b.userId });
  assert.equal((await b.next('error')).code, 'password_required');
  b.send({ type: 'join_room', roomCode: 'RST234', userId: b.userId, password: 'secret1' });
  assert.equal((await b.next('room_state')).roomCode, 'RST234');
  a.close();
  b.close();
});

test('방 복구: 잘못된 코드/모드는 무시된다', async () => {
  const a = await new Client().open();
  a.send({ type: 'create_room', userId: a.userId, roomCode: 'xx', restoreToken: app.rooms.issueRestoreToken('XX') });
  a.send({ type: 'create_room', userId: a.userId, mode: 'nope' });
  await a.none('room_created', 250);
  a.close();
});

test('재시작 알림: announceRestart 는 모두에게 server_restarting 을 보내고 1012 로 닫는다', async () => {
  const { srv, open } = await limitedServer({});
  try {
    const a = await open();
    const b = await open();
    srv.announceRestart();
    assert.equal(await a.closed, 1012);
    assert.equal(await b.closed, 1012);
    assert.equal(a.msgs[0].type, 'server_restarting');
    assert.equal(b.msgs[0].type, 'server_restarting');
  } finally {
    await srv.close();
  }
});

// ---- 배포 전 보안 점검
async function joinRoomWith(code, opts) {
  const c = await new Client().open();
  c.send({ type: 'join_room', roomCode: code, userId: c.userId, ...opts });
  return { c, state: await c.next('room_state') };
}

test('보안: 방에 공개된 userId 로 재접속해도 secret 이 다르면 거절(방장 가로채기 방지)', async () => {
  const { a, code } = await makeRoomWith({ password: 'secret1' });
  const { c: guest, state } = await joinRoomWith(code, { password: 'secret1' });
  assert.equal(state.hostId, a.userId); // 방 안의 누구나 방장의 userId 를 안다
  const atk = await new Client(a.userId).open();
  atk.send({ type: 'join_room', roomCode: code, userId: a.userId, secret: 'attacker-secret-attacker-secret-0000' });
  assert.equal((await atk.next('error')).code, 'identity_mismatch');
  await a.none('error'); // 원래 방장의 연결은 끊기지 않는다
  guest.send({ type: 'set_permission', mode: 'host_only' });
  const real = await new Client(a.userId).open(); // 진짜 방장은 자기 secret 으로 재접속
  real.send({ type: 'join_room', roomCode: code, userId: a.userId });
  assert.equal((await real.next('room_state')).hostId, a.userId);
});

test('보안: secret 없는/형식이 틀린 create_room, join_room 은 무시', async () => {
  const c = await new Client().open();
  c.send(JSON.stringify({ type: 'create_room', userId: c.userId }));
  c.send(JSON.stringify({ type: 'create_room', userId: c.userId, secret: 'short' }));
  await c.none('room_created');
  c.close();
});

test('보안: 한 방의 인원은 최대 인원을 정하지 않아도 50명까지', () => {
  const rm = new RoomManager({ idleSweepMs: 3_600_000 });
  const host = fakeConn();
  rm.create(host, 'user-host-testtest', { secret: secretOf('host') });
  const code = [...rm.rooms.keys()][0];
  let full;
  for (let i = 1; i < 60 && !full; i++) {
    const g = fakeConn();
    rm.join(g, code, `user-g${i}-testtest`, undefined, undefined, secretOf(`g${i}`));
    full = g.sent.find((m) => m.type === 'error');
  }
  assert.equal(full.code, 'room_full');
  assert.equal(full.max, 50);
  rm.shutdown();
});

test('보안: 확장이 아닌 Origin 의 WebSocket 은 거절, EXTENSION_ID 를 정하면 그 확장만 허용', async () => {
  const status = (p, origin) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}`, origin ? { headers: { Origin: origin } } : {});
      ws.once('open', () => (ws.close(), resolve(101)));
      ws.once('unexpected-response', (_q, res) => resolve(res.statusCode));
      ws.once('error', () => {});
    });
  const { srv } = await limitedServer({});
  const pinned = createServer({ port: 0, host: '127.0.0.1', extensionId: 'b'.repeat(32) });
  const p2 = await pinned.listen();
  try {
    const p = srv.server.address().port;
    assert.equal(await status(p, 'https://evil.example'), 403);
    assert.equal(await status(p, EXT_ORIGIN), 101);
    assert.equal(await status(p), 101, 'Origin 이 없는 브라우저 밖 클라이언트는 막지 않는다');
    assert.equal(await status(p2, EXT_ORIGIN), 403);
    assert.equal(await status(p2, `chrome-extension://${'b'.repeat(32)}`), 101);
  } finally {
    await srv.close();
    await pinned.close();
  }
});

// ---- 방 복구 토큰: 방 코드만 아는 사람이 복구(방장 차지)하는 것을 막는다
test('방 복구 토큰: 방 멤버는 room_state 로 받고, 서버가 재시작돼도(같은 키) 그 토큰으로 복구된다', async () => {
  const { a, code, state } = await makeRoom();
  assert.match(state.restoreToken, /^\d+\.[0-9a-f]{32}$/);
  const b = await new Client().open();
  b.send({ type: 'create_room', userId: b.userId, roomCode: code, restoreToken: state.restoreToken }); // 방이 아직 있어서 room_exists
  assert.equal((await b.next('error')).code, 'room_exists');
  // 재시작 흉내: 같은 키의 새 서버는 옛 방을 모르지만 토큰은 확인할 수 있다
  const key = 'k'.repeat(32);
  const old = new RoomManager({ restoreKey: key, idleSweepMs: 3_600_000 });
  const host = fakeConn();
  old.create(host, 'user-aaaa-testtest', { secret: secretOf('user-aaaa-testtest') });
  const token = host.sent.find((m) => m.type === 'room_state').restoreToken;
  const code2 = host.sent.find((m) => m.type === 'room_created').roomCode;
  old.shutdown();
  const fresh = new RoomManager({ restoreKey: key, idleSweepMs: 3_600_000 });
  const again = fakeConn();
  fresh.create(again, 'user-aaaa-testtest', { secret: secretOf('user-aaaa-testtest'), roomCode: code2, restoreToken: token });
  assert.equal(again.sent.find((m) => m.type === 'room_created')?.roomCode, code2);
  fresh.shutdown();
  a.close();
  b.close();
});

test('방 복구 토큰: 없거나 위조/다른 방/다른 키/오래된 토큰이면 restore_denied, 방은 만들어지지 않는다', () => {
  let t = 1_000_000_000_000;
  const rm = new RoomManager({ restoreKey: 'k'.repeat(32), restoreTtlMs: 60_000, idleSweepMs: 3_600_000, now: () => t });
  const good = rm.issueRestoreToken('ABCDEF');
  const try_ = (restoreToken, roomCode = 'ABCDEF') => {
    const c = fakeConn();
    c.ip = `9.9.9.${Math.floor(Math.random() * 200)}`;
    rm.create(c, 'user-zzzz-testtest', { secret: secretOf('user-zzzz-testtest'), roomCode, restoreToken });
    return c.sent.find((m) => m.type === 'error')?.code ?? (c.sent.some((m) => m.type === 'room_created') ? 'created' : 'nothing');
  };
  assert.equal(try_(undefined), 'restore_denied');
  assert.equal(try_(`${Math.floor(t / 1000)}.${'0'.repeat(32)}`), 'restore_denied', '위조');
  assert.equal(try_(good, 'ZZZZZZ'), 'restore_denied', '다른 방 코드의 토큰');
  const other = new RoomManager({ restoreKey: 'x'.repeat(32), idleSweepMs: 3_600_000, now: () => t });
  assert.equal(try_(other.issueRestoreToken('ABCDEF')), 'restore_denied', '다른 서버 키');
  other.shutdown();
  assert.equal(rm.rooms.size, 0);
  assert.equal(try_(good), 'created');
  rm.rooms.clear();
  t += 61_000;
  assert.equal(try_(good), 'restore_denied', '오래된 토큰');
  rm.shutdown();
});

test('방 복구 토큰: roomCode 가 있는데 토큰 형식이 없으면 메시지를 무시한다', async () => {
  const a = await new Client().open();
  a.send({ type: 'create_room', userId: a.userId, roomCode: 'ABCDEF' });
  a.send({ type: 'create_room', userId: a.userId, roomCode: 'ABCDEF', restoreToken: 'nope' });
  await a.none('room_created');
  await a.none('error');
  a.close();
});

test('재시작 알림 뒤에는 새 연결을 받지 않는다(재접속이 죽어가는 서버에 붙지 않게)', async () => {
  const { srv, open } = await limitedServer({});
  const a = await open();
  srv.announceRestart();
  await a.closed;
  await assert.rejects(() => open(), /ECONNREFUSED|ECONNRESET/);
  await srv.close();
});

test('room_state 에 서버 실행 식별값(serverId)이 있고, 서버마다 다르다', async () => {
  const a = await new Client().open();
  a.send({ type: 'create_room', userId: a.userId, secret: 's'.repeat(43) });
  const id1 = (await a.next('room_state')).serverId;
  assert.match(id1, /^[0-9a-f]{12}$/);
  const other = createServer({ port: 0, host: '127.0.0.1', createRoomPerMin: 1000 });
  const p = await other.listen();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${p}`);
    const state = await new Promise((resolve, reject) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'room_state') resolve(m);
      });
      ws.once('open', () => ws.send(JSON.stringify({ type: 'create_room', userId: 'serverid-test-user', secret: 's'.repeat(43) })));
      ws.once('error', reject);
    });
    assert.notEqual(state.serverId, id1, '다른 서버 실행은 다른 값');
    ws.close();
  } finally {
    await other.close();
  }
  a.close();
});

test('GET /health 에 serverId 가 있고 room_state 의 serverId 와 같다', async () => {
  const body = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.match(body.serverId, /^[0-9a-f]{12}$/);
  const a = await new Client().open();
  a.send({ type: 'create_room', userId: a.userId, secret: 's'.repeat(43) });
  assert.equal((await a.next('room_state')).serverId, body.serverId);
  a.close();
});
