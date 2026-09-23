import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Server, type Socket } from 'socket.io';
import { GameStore, type GameRoom } from './game.ts';

type Ack = (result: { ok: true; code?: string; token?: string } | { ok: false; error: string }) => void;

const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1');
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true }));
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 10_000 });
const store = new GameStore(resolve(root, 'data', 'rooms.json'));
store.onChange = (room) => {
  for (const player of room.players.values()) {
    if (player.connected) io.to(player.socketId).emit('state', store.view(room, player.id));
  }
};

function actor(socket: Socket): { room: GameRoom; playerId: string } {
  const code = socket.data.code as string | undefined;
  const playerId = socket.data.playerId as string | undefined;
  const room = code && store.rooms.get(code);
  if (!room || !playerId || store.playerFor(room, playerId)?.socketId !== socket.id) {
    throw new Error('Сначала войдите в комнату.');
  }
  return { room, playerId };
}

function run(ack: Ack | undefined, operation: () => { code?: string; token?: string } | void): void {
  try {
    const result = operation() || {};
    ack?.({ ok: true, ...result });
  } catch (error) {
    ack?.({ ok: false, error: error instanceof Error ? error.message : 'Неизвестная ошибка.' });
  }
}

const attempts = new Map<string, number[]>();
function limitEntry(socket: Socket): void {
  const cloudflareIp = socket.handshake.headers['cf-connecting-ip'];
  const ip = typeof cloudflareIp === 'string' ? cloudflareIp : socket.handshake.address;
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 30) throw new Error('Слишком много попыток входа. Подождите минуту.');
  recent.push(now);
  attempts.set(ip, recent);
}

io.on('connection', (socket) => {
  socket.on('create_room', (payload: { nickname?: unknown; avatar?: unknown }, ack?: Ack) => run(ack, () => {
    limitEntry(socket);
    if (socket.data.code) throw new Error('Вы уже находитесь в комнате.');
    const { room, player } = store.create(payload?.nickname, payload?.avatar, socket.id);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    socket.emit('state', store.view(room, player.id));
    return { code: room.code, token: player.token };
  }));

  socket.on('join_room', (payload: { code?: unknown; nickname?: unknown; avatar?: unknown }, ack?: Ack) => run(ack, () => {
    limitEntry(socket);
    if (socket.data.code) throw new Error('Вы уже находитесь в комнате.');
    const { room, player } = store.join(payload?.code, payload?.nickname, payload?.avatar, socket.id);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    socket.emit('state', store.view(room, player.id));
    return { code: room.code, token: player.token };
  }));

  socket.on('resume', (payload: { code?: unknown; token?: unknown }, ack?: Ack) => run(ack, () => {
    if (socket.data.code) throw new Error('Вы уже находитесь в комнате.');
    const { room, player } = store.resume(payload?.code, payload?.token, socket.id);
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    socket.emit('state', store.view(room, player.id));
    return { code: room.code, token: player.token };
  }));

  socket.on('settings', (value: unknown, ack?: Ack) => run(ack, () => {
    const { room, playerId } = actor(socket);
    store.updateSettings(room, playerId, value);
  }));
  socket.on('start', (ack?: Ack) => run(ack, () => {
    const { room, playerId } = actor(socket);
    store.start(room, playerId);
  }));
  socket.on('clue', (value: unknown, ack?: Ack) => run(ack, () => {
    const { room, playerId } = actor(socket);
    store.submitClue(room, playerId, value);
  }));
  socket.on('guess', (value: unknown, ack?: Ack) => run(ack, () => {
    const { room, playerId } = actor(socket);
    store.submitGuess(room, playerId, value);
  }));
  socket.on('draft_guess', (value: unknown) => {
    try {
      const { room, playerId } = actor(socket);
      store.updateDraft(room, playerId, value);
    } catch { /* A late or invalid draft never interrupts the round. */ }
  });
  socket.on('skip', (ack?: Ack) => run(ack, () => {
    const { room, playerId } = actor(socket);
    store.skipDisconnectedDescriber(room, playerId);
  }));
  socket.on('next', (ack?: Ack) => run(ack, () => {
    const { room, playerId } = actor(socket);
    store.next(room, playerId);
  }));
  socket.on('new_game', (ack?: Ack) => run(ack, () => {
    const { room, playerId } = actor(socket);
    store.newGame(room, playerId);
  }));
  socket.on('disconnect', () => {
    if (socket.data.code && socket.data.playerId) store.disconnect(socket.data.code, socket.data.playerId, socket.id);
  });
});

async function main(): Promise<void> {
  if (process.argv.includes('--dev')) {
    const { createServer: createViteServer } = await import('vite');
    const react = (await import('@vitejs/plugin-react')).default;
    const vite = await createViteServer({
      configFile: false, root, plugins: [react()], appType: 'custom',
      server: { middlewareMode: true, hmr: { server: httpServer } },
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      try {
        const html = readFileSync(resolve(root, 'index.html'), 'utf8');
        res.status(200).type('html').send(await vite.transformIndexHtml(req.originalUrl, html));
      } catch (error) { next(error); }
    });
  } else {
    app.use(express.static(resolve(root, 'dist')));
    app.use((_req, res) => res.sendFile(resolve(root, 'dist', 'index.html')));
  }
  httpServer.listen(port, host, () => console.log(`Цветосфера: http://${host}:${port}`));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
