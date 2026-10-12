import { randomInt } from 'node:crypto';
import { S2C, ERR, VIDEO_ACTION_SYNC } from './protocol.js';

// 헷갈리는 문자(0/O, 1/I)를 뺀 영숫자
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// conn: { send(obj), close?(), userId, roomCode } — WebSocket 과 분리해 테스트하기 쉽게 한다.
export class RoomManager {
  constructor({
    graceMs = 10_000,
    emptyTtlMs = 5 * 60_000,
    bufferWaitMs = 15_000, // 버퍼링 대기 상한
    resumeDelayMs = 500, // 모두 준비된 뒤 함께 재개하기까지의 여유
    now = () => Date.now(),
  } = {}) {
    this.graceMs = graceMs; // 연결이 끊긴 참가자를 유지하는 시간(재접속 대기)
    this.emptyTtlMs = emptyTtlMs; // 모두 나간 방을 삭제하기까지의 시간
    this.bufferWaitMs = bufferWaitMs;
    this.resumeDelayMs = resumeDelayMs;
    this.now = now;
    this.rooms = new Map();
  }

  create(conn, userId) {
    this.leave(conn);
    const room = {
      code: this.#newCode(),
      hostId: null,
      mode: 'everyone',
      video: { playing: false, time: 0, updatedAt: this.now() },
      participants: new Map(),
      names: new Map(), // userId -> 이름 (재입장 시 유지)
      seq: 0,
      emptyTimer: null,
      waiting: new Set(), // 버퍼링 중인 userId
      autoPaused: false, // 버퍼링 때문에 서버가 멈춘 상태인지
      waitTimer: null,
      lastSyncAt: 0,
    };
    this.rooms.set(room.code, room);
    this.#attach(room, conn, userId);
    conn.send({ type: S2C.ROOM_CREATED, roomCode: room.code, hostId: room.hostId });
    conn.send(this.#stateMsg(room));
  }

  join(conn, roomCode, userId) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      conn.send({ type: S2C.ERROR, code: ERR.ROOM_NOT_FOUND, message: '존재하지 않는 방이에요.' });
      return;
    }
    if (conn.roomCode && (conn.roomCode !== roomCode || conn.userId !== userId)) this.leave(conn);
    const { isNew, participant } = this.#attach(room, conn, userId);
    if (isNew) {
      this.#broadcast(room, { type: S2C.PARTICIPANT_JOINED, user: pub(participant) }, userId);
    }
    conn.send(this.#stateMsg(room));
  }

  leave(conn) {
    const room = this.rooms.get(conn.roomCode);
    conn.roomCode = null;
    if (!room) return;
    const p = room.participants.get(conn.userId);
    if (p && p.conn === conn) this.#remove(room, p);
  }

  // 연결이 끊김: 바로 내보내지 않고 graceMs 동안 재접속을 기다린다.
  disconnect(conn) {
    const room = this.rooms.get(conn.roomCode);
    conn.roomCode = null;
    if (!room) return;
    const p = room.participants.get(conn.userId);
    if (!p || p.conn !== conn) return; // 이미 다른 연결로 교체됨
    p.conn = null;
    this.#dropWaiting(room, p.id);
    p.graceTimer = setTimeout(() => this.#remove(room, p), this.graceMs);
    p.graceTimer.unref?.();
  }

  video(conn, msg) {
    const found = this.#find(conn);
    if (!found) return;
    const { room, p } = found;
    if (room.mode === 'host_only' && p.id !== room.hostId) {
      conn.send({ type: S2C.ERROR, code: ERR.NOT_ALLOWED, message: '방장만 조작할 수 있어요.' });
      return;
    }
    const at = this.now();
    // 재생/일시정지는 사용자의 직접 조작이 우선이라 자동 재개하지 않는다.
    // 시크는 재생 여부를 바꾸지 않는다(버퍼링 중인 사람의 시크는 데이터가 도착한 뒤에야 보고되기도 함).
    if (msg.action !== 'seek') room.autoPaused = false;
    room.video = {
      playing: msg.action === 'seek' ? room.video.playing : msg.action === 'play',
      time: msg.time,
      updatedAt: at,
    };
    this.#broadcast(
      room,
      { type: S2C.VIDEO, action: msg.action, time: msg.time, sentAt: msg.sentAt, fromId: p.id, serverAt: at },
      p.id,
    );
  }

  // 방장이 카운트다운 시작: 서버가 startAt(서버 시각)을 정하고, 방 상태를 "startAt 에 재생 시작"으로 저장한다.
  // 카운트다운 중 입장한 사람도 room_state 의 video.updatedAt(미래 시각)으로 같은 순간에 시작한다.
  countdown(conn, seconds) {
    const found = this.#find(conn);
    if (!found) return;
    const { room, p } = found;
    if (p.id !== room.hostId) {
      conn.send({ type: S2C.ERROR, code: ERR.NOT_ALLOWED, message: '방장만 카운트다운을 시작할 수 있어요.' });
      return;
    }
    const now = this.now();
    const time = this.#currentTime(room, now);
    const startAt = now + seconds * 1000;
    const hadWaiting = room.waiting.size > 0;
    this.#clearWait(room);
    room.video = { playing: true, time, updatedAt: startAt };
    if (hadWaiting) this.#broadcast(room, this.#bufferMsg(room));
    this.#broadcast(room, { type: S2C.COUNTDOWN, startAt, time });
  }

  // 한 명이 버퍼링 중이면 방 전체를 멈추고, 모두 준비되면 함께 재개한다(상한 bufferWaitMs).
  buffering(conn, msg) {
    const found = this.#find(conn);
    if (!found) return;
    const { room, p } = found;
    const now = this.now();
    if (msg.isBuffering) {
      if (room.waiting.has(p.id)) return;
      if (!room.autoPaused) {
        if (!room.video.playing) return; // 재생 중이 아니면 기다릴 필요 없음
        const time = msg.time ?? this.#currentTime(room, now);
        room.video = { playing: false, time, updatedAt: now };
        room.autoPaused = true;
      }
      room.waiting.add(p.id);
      if (!room.waitTimer) {
        room.waitTimer = setTimeout(() => this.#giveUpWaiting(room), this.bufferWaitMs);
        room.waitTimer.unref?.();
      }
      this.#broadcast(room, this.#bufferMsg(room));
    } else {
      this.#dropWaiting(room, p.id);
    }
  }

  // 방장의 실제 재생 위치로 기준점을 갱신하고 다른 참가자에게 알린다(클라이언트가 부드럽게 보정).
  syncReport(conn, msg) {
    const found = this.#find(conn);
    if (!found) return;
    const { room, p } = found;
    const now = this.now();
    if (p.id !== room.hostId || !msg.playing) return;
    if (!room.video.playing || room.autoPaused || now < room.video.updatedAt) return;
    if (now - room.lastSyncAt < 2000) return;
    room.lastSyncAt = now;
    room.video = { playing: true, time: msg.time, updatedAt: now };
    this.#broadcast(
      room,
      { type: S2C.VIDEO, action: VIDEO_ACTION_SYNC, time: msg.time, sentAt: msg.sentAt, fromId: p.id, serverAt: now },
      p.id,
    );
  }

  setPermission(conn, mode) {
    const found = this.#find(conn);
    if (!found) return;
    const { room, p } = found;
    if (p.id !== room.hostId || room.mode === mode) return;
    room.mode = mode;
    this.#broadcast(room, { type: S2C.MODE_CHANGED, mode });
  }

  shutdown() {
    for (const room of this.rooms.values()) {
      clearTimeout(room.emptyTimer);
      clearTimeout(room.waitTimer);
      for (const p of room.participants.values()) clearTimeout(p.graceTimer);
    }
    this.rooms.clear();
  }

  // ---- 내부 ----

  #find(conn) {
    const room = this.rooms.get(conn.roomCode);
    const p = room?.participants.get(conn.userId);
    return p && p.conn === conn ? { room, p } : null;
  }

  #currentTime(room, now) {
    const v = room.video;
    return v.playing ? v.time + Math.max(0, now - v.updatedAt) / 1000 : v.time;
  }

  #bufferMsg(room) {
    return { type: S2C.BUFFER_STATE, waitingIds: [...room.waiting], video: { ...room.video } };
  }

  #clearWait(room) {
    clearTimeout(room.waitTimer);
    room.waitTimer = null;
    room.waiting.clear();
    room.autoPaused = false;
  }

  #dropWaiting(room, id) {
    if (!room.waiting.delete(id)) return;
    if (room.waiting.size > 0) {
      this.#broadcast(room, this.#bufferMsg(room));
      return;
    }
    this.#resume(room);
  }

  #giveUpWaiting(room) {
    room.waitTimer = null;
    if (room.waiting.size === 0) return;
    room.waiting.clear();
    this.#resume(room);
  }

  // 모두 준비됨(또는 대기 상한): 약간의 여유를 두고 같은 순간에 재개
  #resume(room) {
    clearTimeout(room.waitTimer);
    room.waitTimer = null;
    if (room.autoPaused) {
      room.autoPaused = false;
      room.video = {
        playing: true,
        time: room.video.time,
        updatedAt: this.now() + this.resumeDelayMs,
      };
    }
    this.#broadcast(room, this.#bufferMsg(room));
  }

  #newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  #attach(room, conn, userId) {
    let p = room.participants.get(userId);
    const isNew = !p;
    if (p) {
      clearTimeout(p.graceTimer);
      p.graceTimer = null;
      const old = p.conn;
      if (old && old !== conn) {
        old.roomCode = null;
        old.send({ type: S2C.ERROR, code: ERR.REPLACED, message: '다른 곳에서 접속해서 연결을 종료해요.' });
        old.close?.();
      }
      p.conn = conn;
    } else {
      if (!room.names.has(userId)) room.names.set(userId, `게스트${randomInt(1000, 10000)}`);
      p = { id: userId, name: room.names.get(userId), joinSeq: ++room.seq, conn, graceTimer: null };
      room.participants.set(userId, p);
    }
    conn.userId = userId;
    conn.roomCode = room.code;
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
    if (!room.hostId) room.hostId = userId;
    return { isNew, participant: p };
  }

  #remove(room, p) {
    clearTimeout(p.graceTimer);
    if (room.participants.get(p.id) !== p) return;
    room.participants.delete(p.id);
    this.#dropWaiting(room, p.id);
    this.#broadcast(room, { type: S2C.PARTICIPANT_LEFT, user: pub(p) });
    if (room.hostId === p.id) {
      // 가장 먼저 들어온 사람(연결 중인 사람 우선)에게 위임
      const rest = [...room.participants.values()].sort((a, b) => a.joinSeq - b.joinSeq);
      const next = rest.find((x) => x.conn) ?? rest[0];
      room.hostId = next ? next.id : null;
      if (next) this.#broadcast(room, { type: S2C.HOST_CHANGED, hostId: room.hostId });
    }
    if (room.participants.size === 0) {
      room.emptyTimer = setTimeout(() => {
        if (room.participants.size === 0) this.rooms.delete(room.code);
      }, this.emptyTtlMs);
      room.emptyTimer.unref?.();
    }
  }

  #stateMsg(room) {
    return {
      type: S2C.ROOM_STATE,
      roomCode: room.code,
      hostId: room.hostId,
      mode: room.mode,
      participants: [...room.participants.values()].sort((a, b) => a.joinSeq - b.joinSeq).map(pub),
      video: { ...room.video },
      waitingIds: [...room.waiting],
      serverNow: this.now(), // 클라이언트가 경과 시간을 보정하는 데 사용
    };
  }

  #broadcast(room, msg, exceptId = null) {
    for (const p of room.participants.values()) {
      if (p.conn && p.id !== exceptId) p.conn.send(msg);
    }
  }
}

const pub = (p) => ({ id: p.id, name: p.name });
