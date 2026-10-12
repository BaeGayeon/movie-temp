import { randomInt } from 'node:crypto';
import { S2C, ERR } from './protocol.js';

// 헷갈리는 문자(0/O, 1/I)를 뺀 영숫자
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// conn: { send(obj), close?(), userId, roomCode } — WebSocket 과 분리해 테스트하기 쉽게 한다.
export class RoomManager {
  constructor({ graceMs = 10_000, emptyTtlMs = 5 * 60_000, now = () => Date.now() } = {}) {
    this.graceMs = graceMs; // 연결이 끊긴 참가자를 유지하는 시간(재접속 대기)
    this.emptyTtlMs = emptyTtlMs; // 모두 나간 방을 삭제하기까지의 시간
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
