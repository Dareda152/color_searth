import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { oklabDistance, randomTarget, scoreGuess, wheelToRgb, type RGB } from '../shared/color.ts';
import { AVATARS, type FinishedGame, type GuessResult, type Phase, type RoomSettings, type RoomView } from '../shared/types.ts';
import { DUEL_COLORS, DUEL_ROUNDS, type DuelColor } from './duel-colors.ts';

interface Player {
  id: string;
  token: string;
  nickname: string;
  avatar: string;
  joinedAt: number;
  socketId: string;
  connected: boolean;
  score: number;
}

interface Room {
  code: string;
  hostId: string | null;
  players: Map<string, Player>;
  settings: RoomSettings;
  phase: Phase;
  roster: string[];
  duelDeck: DuelColor[];
  participants: Set<string>;
  roundIndex: number;
  target: RGB | null;
  clue: string | null;
  guesses: Map<string, RGB>;
  drafts: Map<string, RGB>;
  eligible: Set<string>;
  deadline: number | null;
  timer: NodeJS.Timeout | null;
  results: GuessResult[] | null;
  describerPoints: number | null;
  skipped: boolean;
  phaseStartedAt: number;
  history: FinishedGame[];
}

interface SavedRoom {
  code: string;
  settings: RoomSettings;
  history: FinishedGame[];
}

const DEFAULT_SETTINGS: RoomSettings = { mode: 'classic', timerSeconds: 90, grayPercent: 10, strictness: 3 };
const DEFAULT_GUESS = wheelToRgb(0.68, 0.25, 0.7);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BLOCKED_CODE = /(?:#[0-9a-f]{3,8}\b|0x[0-9a-f]{6,8}\b|\b(?:rgb|rgba|hsl|hsla|oklab|oklch)\s*\()/i;

export class GameStore {
  rooms = new Map<string, Room>();
  onChange: (room: Room) => void = () => {};

  constructor(private readonly filePath: string) {
    if (existsSync(filePath)) {
      const saved = JSON.parse(readFileSync(filePath, 'utf8')) as SavedRoom[];
      for (const entry of saved) this.rooms.set(entry.code, this.emptyRoom(entry.code, entry.settings, entry.history));
    }
  }

  private emptyRoom(code: string, settings = DEFAULT_SETTINGS, history: FinishedGame[] = []): Room {
    return {
      code, hostId: null, players: new Map(), settings: { ...DEFAULT_SETTINGS, ...settings }, phase: 'lobby', roster: [], duelDeck: [], participants: new Set(),
      roundIndex: 0, target: null, clue: null, guesses: new Map(), drafts: new Map(), eligible: new Set(), deadline: null,
      timer: null, results: null, describerPoints: null, skipped: false, phaseStartedAt: Date.now(), history,
    };
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const records: SavedRoom[] = [...this.rooms.values()].map(({ code, settings, history }) => ({ code, settings, history }));
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(records, null, 2));
    renameSync(tmpPath, this.filePath);
  }

  private emit(room: Room): void { this.onChange(room); }

  create(nickname: unknown, avatar: unknown, socketId: string): { room: Room; player: Player } {
    let code: string;
    do {
      code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = this.emptyRoom(code);
    this.rooms.set(code, room);
    const player = this.addPlayer(room, nickname, avatar, socketId);
    room.hostId = player.id;
    this.persist();
    this.emit(room);
    return { room, player };
  }

  join(codeValue: unknown, nickname: unknown, avatar: unknown, socketId: string): { room: Room; player: Player } {
    const code = String(codeValue ?? '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new Error('Комната не найдена. Проверьте код.');
    const player = this.addPlayer(room, nickname, avatar, socketId);
    if (!room.hostId || !room.players.get(room.hostId)?.connected) room.hostId = player.id;
    if (room.phase !== 'lobby' && room.settings.mode === 'classic') room.participants.add(player.id);
    if (room.phase === 'guess' && room.settings.mode === 'classic') {
      room.eligible.add(player.id);
      room.drafts.set(player.id, DEFAULT_GUESS);
    }
    this.emit(room);
    return { room, player };
  }

  resume(codeValue: unknown, tokenValue: unknown, socketId: string): { room: Room; player: Player } {
    const room = this.rooms.get(String(codeValue ?? '').trim().toUpperCase());
    const player = room && [...room.players.values()].find((entry) => entry.token === tokenValue);
    if (!room || !player) throw new Error('Сессия не найдена. Войдите в комнату заново.');
    player.socketId = socketId;
    player.connected = true;
    if (!room.hostId || !room.players.get(room.hostId)?.connected) room.hostId = player.id;
    this.emit(room);
    return { room, player };
  }

  private addPlayer(room: Room, nicknameValue: unknown, avatarValue: unknown, socketId: string): Player {
    const nickname = String(nicknameValue ?? '').trim().replace(/\s+/g, ' ');
    if (Array.from(nickname).length < 2 || Array.from(nickname).length > 20) throw new Error('Никнейм: от 2 до 20 символов.');
    if (![...AVATARS].includes(avatarValue as typeof AVATARS[number])) throw new Error('Выберите аватар из списка.');
    if ([...room.players.values()].some((entry) => entry.nickname.toLocaleLowerCase('ru') === nickname.toLocaleLowerCase('ru'))) {
      throw new Error('Такой никнейм уже занят в этой комнате.');
    }
    const player: Player = {
      id: randomUUID(), token: randomBytes(24).toString('hex'), nickname, avatar: avatarValue as string,
      joinedAt: Date.now(), socketId, connected: true, score: 0,
    };
    room.players.set(player.id, player);
    return player;
  }

  disconnect(code: string, playerId: string, socketId: string): void {
    const room = this.rooms.get(code);
    const player = room?.players.get(playerId);
    if (!room || !player || player.socketId !== socketId) return;
    player.connected = false;
    this.emit(room);
    if (room.hostId === playerId) {
      setTimeout(() => {
        if (room.hostId !== playerId || player.connected) return;
        const replacement = [...room.players.values()].filter((entry) => entry.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
        if (replacement) room.hostId = replacement.id;
        this.emit(room);
      }, 15_000);
    }
  }

  updateSettings(room: Room, actorId: string, value: unknown): void {
    this.requireHost(room, actorId);
    if (room.phase !== 'lobby') throw new Error('Настройки меняются перед началом партии.');
    if (!value || typeof value !== 'object') throw new Error('Неверные настройки.');
    const input = value as Partial<RoomSettings>;
    const mode = input.mode ?? room.settings.mode;
    if ((mode !== 'classic' && mode !== 'duel') ||
        !Number.isInteger(input.timerSeconds) || input.timerSeconds! < 30 || input.timerSeconds! > 180 ||
        !Number.isInteger(input.grayPercent) || input.grayPercent! < 0 || input.grayPercent! > 100 ||
        !Number.isInteger(input.strictness) || input.strictness! < 1 || input.strictness! > 5) {
      throw new Error('Проверьте значения настроек.');
    }
    room.settings = { mode, timerSeconds: input.timerSeconds!, grayPercent: input.grayPercent!, strictness: input.strictness! };
    this.persist();
    this.emit(room);
  }

  start(room: Room, actorId: string): void {
    this.requireHost(room, actorId);
    if (room.phase !== 'lobby') throw new Error('Партия уже идёт.');
    const active = [...room.players.values()].filter((player) => player.connected);
    if (room.settings.mode === 'duel' && active.length !== 2) throw new Error('Для дуэли нужны ровно два игрока.');
    if (room.settings.mode === 'classic' && active.length < 3) throw new Error('Для начала нужны минимум три игрока.');
    for (const player of room.players.values()) player.score = 0;
    room.roster = active.map((player) => player.id);
    for (let i = room.roster.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [room.roster[i], room.roster[j]] = [room.roster[j], room.roster[i]];
    }
    room.participants = new Set(room.roster);
    room.duelDeck = room.settings.mode === 'duel' ? [...DUEL_COLORS] : [];
    for (let i = room.duelDeck.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [room.duelDeck[i], room.duelDeck[j]] = [room.duelDeck[j], room.duelDeck[i]];
    }
    room.roundIndex = 0;
    this.beginRound(room);
  }

  private beginRound(room: Room): void {
    room.phase = 'clue';
    room.phaseStartedAt = Date.now();
    room.target = room.settings.mode === 'duel' ? room.duelDeck[room.roundIndex].color : randomTarget(room.settings.grayPercent);
    room.clue = null;
    room.guesses = new Map();
    room.drafts = new Map();
    room.eligible = new Set();
    room.deadline = null;
    room.results = null;
    room.describerPoints = null;
    room.skipped = false;
    if (room.settings.mode === 'duel') {
      room.clue = room.duelDeck[room.roundIndex].clue;
      this.beginGuessing(room, room.roster);
    } else this.emit(room);
  }

  submitClue(room: Room, actorId: string, value: unknown): void {
    if (room.settings.mode !== 'classic' || room.phase !== 'clue' || room.roster[room.roundIndex] !== actorId) throw new Error('Сейчас не ваш ход описания.');
    const clue = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!clue || Array.from(clue).length > 140) throw new Error('Подсказка должна содержать от 1 до 140 символов.');
    if (BLOCKED_CODE.test(clue)) throw new Error('Цветовые коды в подсказке запрещены.');
    room.clue = clue;
    this.beginGuessing(room, [...room.players.values()].filter((player) => player.connected && player.id !== actorId).map((player) => player.id));
  }

  private beginGuessing(room: Room, eligibleIds: string[]): void {
    room.phase = 'guess';
    room.phaseStartedAt = Date.now();
    room.eligible = new Set(eligibleIds);
    for (const id of room.eligible) room.drafts.set(id, DEFAULT_GUESS);
    room.deadline = Date.now() + room.settings.timerSeconds * 1000;
    room.timer = setTimeout(() => this.reveal(room), room.settings.timerSeconds * 1000);
    this.emit(room);
  }

  submitGuess(room: Room, actorId: string, value: unknown): void {
    if (room.phase !== 'guess' || !room.eligible.has(actorId) || room.guesses.has(actorId)) throw new Error('Ответ сейчас недоступен.');
    if (room.deadline === null || Date.now() >= room.deadline) {
      this.reveal(room);
      throw new Error('Время вышло.');
    }
    room.guesses.set(actorId, this.validateColor(value));
    this.emit(room);
    if ([...room.eligible].every((id) => room.guesses.has(id))) this.reveal(room);
  }

  updateDraft(room: Room, actorId: string, value: unknown): void {
    if (room.phase !== 'guess' || !room.eligible.has(actorId) || room.guesses.has(actorId)) return;
    if (room.deadline === null || Date.now() >= room.deadline) return;
    room.drafts.set(actorId, this.validateColor(value));
  }

  private validateColor(value: unknown): RGB {
    if (!Array.isArray(value) || value.length !== 3 || !value.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) {
      throw new Error('Неверный цвет.');
    }
    return value as RGB;
  }

  private reveal(room: Room): void {
    if (room.phase !== 'guess' || !room.target) return;
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.phase = 'reveal';
    room.phaseStartedAt = Date.now();
    room.deadline = null;
    const results: GuessResult[] = [];
    for (const playerId of room.eligible) {
      const player = room.players.get(playerId)!;
      const color = room.guesses.get(playerId) ?? room.drafts.get(playerId) ?? null;
      const points = color ? scoreGuess(room.target, color, room.settings.strictness) : 0;
      player.score += points;
      results.push({ playerId, nickname: player.nickname, avatar: player.avatar, color,
        distance: color ? oklabDistance(room.target, color) : null, points,
        autoSubmitted: !room.guesses.has(playerId) });
    }
    results.sort((a, b) => b.points - a.points);
    room.results = results;
    if (room.settings.mode === 'classic') {
      const describer = room.players.get(room.roster[room.roundIndex]);
      room.describerPoints = results.length ? Math.round(results.reduce((sum, result) => sum + result.points, 0) / results.length) : 0;
      if (describer) describer.score += room.describerPoints;
    } else room.describerPoints = null;
    this.emit(room);
  }

  skipDisconnectedDescriber(room: Room, actorId: string): void {
    this.requireHost(room, actorId);
    const describer = room.players.get(room.roster[room.roundIndex]);
    if (room.settings.mode !== 'classic' || room.phase !== 'clue' || describer?.connected) throw new Error('Пропустить можно только ход отключившегося ведущего.');
    room.skipped = true;
    room.phase = 'reveal';
    room.phaseStartedAt = Date.now();
    room.results = [];
    room.describerPoints = 0;
    room.target = null;
    this.emit(room);
  }

  next(room: Room, actorId: string): void {
    this.requireHost(room, actorId);
    if (room.phase !== 'reveal') throw new Error('Раунд ещё не завершён.');
    room.roundIndex += 1;
    if (room.roundIndex < (room.settings.mode === 'duel' ? DUEL_ROUNDS : room.roster.length)) {
      this.beginRound(room);
      return;
    }
    room.phase = 'finished';
    room.phaseStartedAt = Date.now();
    const leaderboard = [...room.participants].map((id) => room.players.get(id)!).filter(Boolean)
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
      .map(({ nickname, avatar, score }) => ({ nickname, avatar, score }));
    const top = leaderboard[0]?.score ?? 0;
    const winners = leaderboard.filter((player) => player.score === top).map((player) => player.nickname);
    room.history.unshift({ id: randomUUID(), finishedAt: new Date().toISOString(), winners, leaderboard });
    this.persist();
    this.emit(room);
  }

  newGame(room: Room, actorId: string): void {
    this.requireHost(room, actorId);
    if (room.phase !== 'finished') throw new Error('Текущая партия ещё идёт.');
    room.phase = 'lobby';
    room.phaseStartedAt = Date.now();
    room.roster = [];
    room.duelDeck = [];
    room.participants = new Set();
    room.roundIndex = 0;
    room.target = null;
    room.clue = null;
    room.results = null;
    room.describerPoints = null;
    room.skipped = false;
    for (const player of room.players.values()) player.score = 0;
    this.emit(room);
  }

  view(room: Room, selfId: string): RoomView {
    const describerId = room.settings.mode === 'duel' ? null : room.roster[room.roundIndex] ?? null;
    const totalRounds = room.settings.mode === 'duel' ? DUEL_ROUNDS : room.roster.length;
    const revealed = room.phase === 'reveal' || room.phase === 'finished';
    return {
      code: room.code, selfId, phase: room.phase, settings: room.settings,
      players: [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((player) => ({
        id: player.id, nickname: player.nickname, avatar: player.avatar, connected: player.connected,
        score: player.score, isHost: room.hostId === player.id, isDescriber: describerId === player.id,
        hasGuessed: room.guesses.has(player.id), inCurrentGame: room.roster.includes(player.id),
      })),
      roundNumber: room.phase === 'lobby' ? 0 : Math.min(room.roundIndex + 1, totalRounds),
      totalRounds: room.phase === 'lobby' ? 0 : totalRounds, describerId,
      target: revealed || (room.phase !== 'lobby' && describerId === selfId) ? room.target : null,
      clue: room.clue, deadline: room.deadline,
      phaseStartedAt: room.phaseStartedAt,
      selfDraft: room.phase === 'guess' ? room.drafts.get(selfId) ?? null : null,
      results: revealed ? room.results : null, describerPoints: revealed ? room.describerPoints : null,
      skipped: room.skipped, history: room.history,
    };
  }

  playerFor(room: Room, id: string): Player | undefined { return room.players.get(id); }

  private requireHost(room: Room, actorId: string): void {
    if (room.hostId !== actorId) throw new Error('Это действие доступно хозяину комнаты.');
  }
}

export type GameRoom = Room;
