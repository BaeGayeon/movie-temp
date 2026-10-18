import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createServer } from '../src/index.js';
import { RoomManager } from '../src/rooms.js';

const app = createServer({ port: 0, host: '127.0.0.1', graceMs: 200, emptyTtlMs: 200, bufferWaitMs: 400, resumeDelayMs: 100 });
let port;
before(async () => {
  port = await app.listen();
});
after(() => app.close());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let uid = 0;
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
  send(m) {
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

test('GET /health', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
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
  assert.deepEqual(Object.keys(ca).sort(), ['sentAt', 'text', 'type', 'userId']);

  a.send({ type: 'chat', text: '   ' });
  a.send({ type: 'chat', text: 'x'.repeat(2001) });
  a.send({ type: 'chat', text: 123 });
  a.send({ type: 'chat', text: 'a\u0007b' }); // 제어문자
  await b.none('chat');
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
  rm.create(a, 'user-aaaa-testtest');
  const code = [...rm.rooms.keys()][0];
  t = 59_000;
  rm.closeIdleRooms();
  assert.equal(rm.rooms.size, 1, '기준 시간 전에는 유지');
  t = 61_000;
  rm.closeIdleRooms();
  assert.equal(rm.rooms.size, 0, '기준 시간이 지나면 닫힘');
  const err = a.sent.find((m) => m.type === 'error');
  assert.equal(err?.code, 'room_not_found');
  assert.match(err.message, /활동/);
  assert.equal(a.roomCode, null);
  rm.shutdown();
  assert.ok(code);
});

test('채팅/재생 같은 활동이 있으면 idle 시간이 다시 시작됨', () => {
  let t = 0;
  const rm = new RoomManager({ idleTtlMs: 60_000, idleSweepMs: 3_600_000, now: () => t });
  const a = fakeConn();
  rm.create(a, 'user-bbbb-testtest');
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
