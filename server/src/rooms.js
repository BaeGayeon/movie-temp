import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { S2C, ERR, VIDEO_ACTION_SYNC, DEFAULT_COLORS, DEFAULT_AVATAR_EMOJI } from './protocol.js';

const AD_ROLLBACK_MS = 6000; // 광고 보고 직전 이 시간 안의 본인 이벤트는 광고 전환 중 생긴 것으로 보고 되돌린다

// 같은 사람이 짧은 시간에 이어서 보낸 이벤트 묶음(seek 0 -> play 0 처럼)은 "묶음이 시작되기 전" 상태를 남겨 둔다.
const SNAPSHOT_BURST_MS = 2000;
function keepSnapshot(room, userId, at) {
  const prev = room.prevVideo;
  if (prev && prev.by === userId && at - prev.at < SNAPSHOT_BURST_MS) return;
  room.prevVideo = { video: { ...room.video }, by: userId, at };
}

// 헷갈리는 문자(0/O, 1/I)를 뺀 영숫자
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// 방 비밀번호는 해시(scrypt + 무작위 salt)로만 메모리에 보관한다(평문 보관/로그 금지).
function hashPassword(password) {
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(password, salt, 32) };
}
function checkPassword(stored, password) {
  return typeof password === 'string' && timingSafeEqual(stored.hash, scryptSync(password, stored.salt, 32));
}

// conn: { send(obj), close?(), userId, roomCode } — WebSocket 과 분리해 테스트하기 쉽게 한다.
export class RoomManager {
  constructor({
    graceMs = 10_000,
    emptyTtlMs = 5 * 60_000,
    idleTtlMs = 60 * 60_000, // 참가자가 있어도 이만큼 아무 활동이 없으면 방을 닫는다
    idleSweepMs = 60_000, // 위 시간을 확인하는 주기
    bufferWaitMs = 15_000, // 버퍼링 대기 상한
    adWaitMs = 10 * 60_000, // 광고 대기 상한(광고는 길 수 있다)
    resumeDelayMs = 500, // 모두 준비된 뒤 함께 재개하기까지의 여유
    joinFailLimit = 10, // 연결 주소(IP) 당 이 횟수만큼 참가에 실패(없는 방/틀린 비밀번호)하면 잠시 차단
    joinFailWindowMs = 60_000,
    now = () => Date.now(),
  } = {}) {
    this.graceMs = graceMs; // 연결이 끊긴 참가자를 유지하는 시간(재접속 대기)
    this.emptyTtlMs = emptyTtlMs; // 모두 나간 방을 삭제하기까지의 시간
    this.idleTtlMs = idleTtlMs;
    this.bufferWaitMs = bufferWaitMs;
    this.adWaitMs = adWaitMs;
    this.resumeDelayMs = resumeDelayMs;
    this.now = now;
    this.joinFailLimit = joinFailLimit;
    this.joinFailWindowMs = joinFailWindowMs;
    this.joinFails = new Map(); // ip -> { count, resetAt }
    this.rooms = new Map();
    this.idleTimer = setInterval(() => this.closeIdleRooms(), idleSweepMs);
    this.idleTimer.unref?.();
  }

  // 활동(재생/정지/이동, 재생 중 위치 보고, 채팅, 리액션, 입퇴장 등)이 idleTtlMs 동안 없는 방을 닫는다.
  // 영상이 재생 중이면 참가자가 위치 보고를 계속 보내므로 활동으로 잡힌다(정지한 채 방치된 방만 닫힌다).
  closeIdleRooms() {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.participants.size === 0 || now - room.lastActivityAt < this.idleTtlMs) continue;
      for (const p of room.participants.values()) {
        clearTimeout(p.graceTimer);
        p.conn?.send({ type: S2C.ERROR, code: ERR.ROOM_IDLE_CLOSED, message: '오랫동안 아무 활동이 없어서 방이 닫혔어요.' });
        if (p.conn) p.conn.roomCode = null;
      }
      clearTimeout(room.emptyTimer);
      clearTimeout(room.waitTimer);
      this.rooms.delete(room.code);
    }
  }

  create(conn, userId, { password, maxMembers, lang } = {}) {
    this.leave(conn);
    const room = {
      code: this.#newCode(),
      hostId: null,
      mode: 'everyone',
      video: { playing: false, time: 0, updatedAt: this.now() },
      participants: new Map(),
      profiles: new Map(), // userId -> { name, avatar, color } (재입장 시 유지)
      seq: 0,
      emptyTimer: null,
      lastActivityAt: this.now(),
      waiting: new Set(), // 버퍼링/광고 중이라 모두가 기다리는 userId
      adIds: new Set(), // waiting 중 광고를 보고 있는 userId
      autoPaused: false, // 버퍼링 때문에 서버가 멈춘 상태인지
      waitTimer: null,
      lastSyncAt: 0,
      password: password ? hashPassword(password) : null, // { salt, hash }. 평문은 보관하지 않는다
      maxMembers: maxMembers ?? null,
    };
    this.rooms.set(room.code, room);
    this.#attach(room, conn, userId, lang);
    conn.send({ type: S2C.ROOM_CREATED, roomCode: room.code, hostId: room.hostId });
    conn.send(this.#stateMsg(room));
  }

  #joinBlocked(ip) {
    const e = ip && this.joinFails.get(ip);
    return !!e && e.resetAt > this.now() && e.count >= this.joinFailLimit;
  }

  #joinFailed(ip) {
    if (!ip) return;
    const now = this.now();
    let e = this.joinFails.get(ip);
    if (!e || e.resetAt <= now) {
      for (const [k, v] of this.joinFails) if (v.resetAt <= now) this.joinFails.delete(k);
      e = { count: 0, resetAt: now + this.joinFailWindowMs };
      this.joinFails.set(ip, e);
    }
    e.count++;
  }

  join(conn, roomCode, userId, password, lang) {
    const reject = (code, message, extra) => conn.send({ type: S2C.ERROR, code, message, ...extra });
    if (this.#joinBlocked(conn.ip)) {
      reject(ERR.TOO_MANY_ATTEMPTS, '참가 시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.');
      return;
    }
    const room = this.rooms.get(roomCode);
    if (!room) {
      this.#joinFailed(conn.ip);
      reject(ERR.ROOM_NOT_FOUND, '존재하지 않는 방이에요.');
      return;
    }
    // 이미 방에 있는 사람의 재접속은 비밀번호/인원 검사를 하지 않는다
    if (!room.participants.has(userId)) {
      if (room.password) {
        if (password === undefined) {
          reject(ERR.PASSWORD_REQUIRED, '비밀번호가 필요한 방이에요.');
          return;
        }
        if (!checkPassword(room.password, password)) {
          this.#joinFailed(conn.ip);
          reject(ERR.WRONG_PASSWORD, '비밀번호가 맞지 않아요.');
          return;
        }
      }
      if (room.maxMembers && room.participants.size >= room.maxMembers) {
        reject(ERR.ROOM_FULL, `방이 가득 찼어요 (최대 ${room.maxMembers}명).`, { max: room.maxMembers });
        return;
      }
    }
    if (conn.roomCode && (conn.roomCode !== roomCode || conn.userId !== userId)) this.leave(conn);
    const { isNew, participant } = this.#attach(room, conn, userId, lang);
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
    keepSnapshot(room, p.id, at); // 직후에 광고였다고 보고되면 되돌리기 위해
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
      conn.send({ type: S2C.ERROR, code: ERR.NOT_ALLOWED, reason: 'countdown', message: '방장만 카운트다운을 시작할 수 있어요.' });
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
      // 광고가 시작되면서 영상이 바뀌는 순간의 이벤트(0초로 이동 등)가 광고 감지보다 먼저 방에 전해졌을 수 있다.
      // 같은 사람이 직전 몇 초 안에 보낸 상태가 있으면 그 이전 상태로 되돌린다.
      const prev = room.prevVideo;
      if (
        msg.reason === 'ad' && prev?.by === p.id && now - prev.at < AD_ROLLBACK_MS && !room.autoPaused &&
        room.video.time < 5 && prev.video.time - room.video.time > 30 // 한참 뒤였다가 갑자기 0~5초로 된 경우만(진짜 조작은 건드리지 않는다)
      ) {
        room.video = { ...room.prevVideo.video };
      }
      room.prevVideo = null;
      if (!room.autoPaused) {
        if (!room.video.playing) return; // 재생 중이 아니면 기다릴 필요 없음
        const time = msg.time ?? this.#currentTime(room, now);
        room.video = { playing: false, time, updatedAt: now };
        room.autoPaused = true;
      }
      room.waiting.add(p.id);
      const ad = msg.reason === 'ad';
      if (ad) room.adIds.add(p.id);
      // 광고가 끼면 상한을 광고용으로 늘린다(버퍼링용 짧은 타이머가 광고 중에 방을 풀어 버리지 않도록)
      if (!room.waitTimer || ad) {
        clearTimeout(room.waitTimer);
        room.waitTimer = setTimeout(() => this.#giveUpWaiting(room), room.adIds.size ? this.adWaitMs : this.bufferWaitMs);
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
    keepSnapshot(room, p.id, now);
    room.video = { playing: true, time: msg.time, updatedAt: now };
    this.#broadcast(
      room,
      { type: S2C.VIDEO, action: VIDEO_ACTION_SYNC, time: msg.time, sentAt: msg.sentAt, fromId: p.id, serverAt: now },
      p.id,
    );
  }

  // 프로필 등록/변경: 방 전체(본인 포함)에 전파
  profileUpdate(conn, profile) {
    const found = this.#find(conn);
    if (!found) return;
    const { room, p } = found;
    // 이미지 프로필은 크기가 커서 방 전체에 증폭 전파되므로 더 엄격히 제한(이모지는 느슨하게)
    const image = profile.avatar.kind === 'image' && profile.avatar.value !== p.avatar?.value; // 같은 사진으로 색만 바꾸는 건 일반 한도
    if (!(image ? this.#take(p, 'profileImage', 3, 0.2) : this.#take(p, 'profile', 10, 2))) return;
    Object.assign(p, profile);
    room.profiles.set(p.id, profile);
    this.#broadcast(room, { type: S2C.PROFILE_UPDATED, user: pub(p) });
  }

  // 채팅: 메시지에는 userId 만 붙이고 방 전체(본인 포함)에 전파. 사용자당 빈도 제한.
  chat(conn, text, videoTime, replyTo) {
    const found = this.#find(conn);
    if (!found || !this.#take(found.p, 'chat', 5, 1.5)) return; // 버스트 5개, 평균 초당 1.5개
    // id: 답장이 가리킬 수 있도록 서버가 메시지마다 붙인다(8자리 16진수)
    const msg = { type: S2C.CHAT, id: randomBytes(4).toString('hex'), userId: found.p.id, text, sentAt: this.now() };
    if (videoTime !== undefined) msg.videoTime = videoTime; // 보낸 시점의 재생 위치(초)
    if (replyTo !== undefined) msg.replyTo = replyTo; // 답장 대상 메시지 id
    this.#broadcast(found.room, msg);
  }

  typing(conn, isTyping) {
    const found = this.#find(conn);
    if (!found || !this.#take(found.p, 'typing', 5, 2)) return;
    this.#broadcast(found.room, { type: S2C.TYPING, userId: found.p.id, isTyping }, found.p.id);
  }

  // 이모지 리액션: 사용자당 초당 3회 제한(도배 방지), 본인 포함 전체에 전파
  reaction(conn, emoji) {
    const found = this.#find(conn);
    if (!found || !this.#take(found.p, 'reaction', 3, 3)) return;
    this.#broadcast(found.room, { type: S2C.REACTION, userId: found.p.id, emoji });
  }

  setPermission(conn, mode) {
    const found = this.#find(conn);
    if (!found) return;
    const { room, p } = found;
    if (p.id !== room.hostId || room.mode === mode) return;
    room.mode = mode;
    this.#broadcast(room, { type: S2C.MODE_CHANGED, mode });
  }

  // 방장이 비밀번호/최대 인원을 바꾼다. 이미 방에 있는 사람은 그대로 두고, 새로 들어오는 사람부터 적용된다. 방장이 아니면 무시.
  setOptions(conn, { password, maxMembers }) {
    const found = this.#find(conn);
    if (!found) return;
    const { room, p } = found;
    if (p.id !== room.hostId) return;
    const passwordChanged = password !== undefined;
    if (passwordChanged) room.password = password === null ? null : hashPassword(password);
    if (maxMembers !== undefined) room.maxMembers = maxMembers;
    room.lastActivityAt = this.now();
    this.#broadcast(room, {
      type: S2C.ROOM_OPTIONS,
      hasPassword: !!room.password,
      maxMembers: room.maxMembers,
      passwordChanged,
      fromId: p.id,
    });
  }

  shutdown() {
    clearInterval(this.idleTimer);
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
    if (!p || p.conn !== conn) return null;
    room.lastActivityAt = this.now();
    return { room, p };
  }

  // 토큰 버킷: 허용되면 true. capacity=버스트, perSec=초당 보충량
  #take(p, key, capacity, perSec) {
    const now = this.now();
    const b = (p.limits[key] ??= { tokens: capacity, at: now });
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * perSec);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  #currentTime(room, now) {
    const v = room.video;
    return v.playing ? v.time + Math.max(0, now - v.updatedAt) / 1000 : v.time;
  }

  #bufferMsg(room) {
    return { type: S2C.BUFFER_STATE, waitingIds: [...room.waiting], adIds: [...room.adIds], video: { ...room.video } };
  }

  #clearWait(room) {
    clearTimeout(room.waitTimer);
    room.waitTimer = null;
    room.waiting.clear();
    room.adIds.clear();
    room.autoPaused = false;
  }

  #dropWaiting(room, id) {
    room.adIds.delete(id);
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
    room.adIds.clear();
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

  #attach(room, conn, userId, lang) {
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
      const seq = ++room.seq;
      if (!room.profiles.has(userId)) {
        const color = DEFAULT_COLORS[(seq - 1) % DEFAULT_COLORS.length];
        room.profiles.set(userId, {
          name: `${lang === 'en' ? 'Guest' : '게스트'}${randomInt(1000, 10000)}`,
          avatar: { kind: 'emoji', value: DEFAULT_AVATAR_EMOJI, bg: color },
          color,
        });
      }
      p = { id: userId, ...room.profiles.get(userId), joinSeq: seq, conn, graceTimer: null, limits: {} };
      room.participants.set(userId, p);
    }
    conn.userId = userId;
    conn.roomCode = room.code;
    room.lastActivityAt = this.now();
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
      hasPassword: !!room.password, // 비밀번호/해시는 절대 내려보내지 않는다
      maxMembers: room.maxMembers,
      participants: [...room.participants.values()].sort((a, b) => a.joinSeq - b.joinSeq).map(pub),
      video: { ...room.video },
      waitingIds: [...room.waiting],
      adIds: [...room.adIds],
      serverNow: this.now(), // 클라이언트가 경과 시간을 보정하는 데 사용
    };
  }

  #broadcast(room, msg, exceptId = null) {
    for (const p of room.participants.values()) {
      if (p.conn && p.id !== exceptId) p.conn.send(msg);
    }
  }
}

const pub = (p) => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color });
