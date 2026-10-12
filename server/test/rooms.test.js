import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createServer } from '../src/index.js';

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
  c.send(JSON.stringify({ type: 'video', action: 'play', time: 1, sentAt: 1, pad: 'x'.repeat(5000) }));
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
