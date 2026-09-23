import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { oklabDistance, oklabToRgb, randomTarget, rgbToOklab, scoreGuess, type RGB } from '../shared/color.ts';
import { GameStore } from '../server/game.ts';

test('Oklab conversion stays close to sRGB and scores fall with distance', () => {
  const samples: RGB[] = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [20, 180, 220], [167, 102, 204]];
  for (const sample of samples) {
    const restored = oklabToRgb(rgbToOklab(sample));
    assert.ok(restored.every((channel, index) => Math.abs(channel - sample[index]) <= 1));
  }
  const target: RGB = [255, 0, 0];
  assert.equal(scoreGuess(target, target, 3), 5000);
  assert.ok(oklabDistance(target, [240, 10, 10]) < oklabDistance(target, [0, 0, 255]));
  assert.ok(scoreGuess(target, [240, 10, 10], 3) > scoreGuess(target, [0, 0, 255], 3));
  assert.ok(scoreGuess(target, [0, 0, 255], 1) > scoreGuess(target, [0, 0, 255], 5));
  for (let i = 0; i < 100; i += 1) assert.ok(randomTarget(10).every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255));
});

test('room runs all starting players once, includes late guesses, hides target and saves history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'color-searth-test-'));
  try {
    const file = join(dir, 'rooms.json');
    const store = new GameStore(file);
    const { room, player: host } = store.create('Аня', '🦊', 'socket-1');
    const bob = store.join(room.code, 'Борис', '🐙', 'socket-2').player;
    const cat = store.join(room.code, 'Катя', '🦉', 'socket-3').player;
    assert.throws(() => store.start(room, bob.id), /хозяину/);
    store.updateSettings(room, host.id, { timerSeconds: 30, grayPercent: 0, strictness: 3 });
    store.start(room, host.id);
    assert.equal(room.roster.length, 3);
    const speakers = new Set<string>();
    for (let round = 0; round < 3; round += 1) {
      const speaker = room.roster[room.roundIndex];
      speakers.add(speaker);
      const target = room.target!;
      assert.deepEqual(store.view(room, speaker).target, target);
      const other = [host.id, bob.id, cat.id].find((id) => id !== speaker)!;
      assert.equal(store.view(room, other).target, null);
      assert.throws(() => store.submitClue(room, speaker, 'rgb(255, 0, 0)'), /коды/);
      store.submitClue(room, speaker, 'Летний закат над рекой');
      assert.equal(store.view(room, other).target, null);
      if (round === 0) {
        const late = store.join(room.code, 'Дина', '🐸', 'socket-4').player;
        assert.ok(room.eligible.has(late.id));
        assert.ok(!room.roster.includes(late.id));
      }
      for (const id of room.eligible) store.submitGuess(room, id, target);
      assert.equal(room.phase, 'reveal');
      assert.equal(room.describerPoints, 5000);
      assert.ok(room.results?.every((result) => result.points === 5000));
      store.next(room, host.id);
    }
    assert.equal(speakers.size, 3);
    assert.equal(room.phase, 'finished');
    assert.equal(room.history.length, 1);
    const reloaded = new GameStore(file);
    assert.equal(reloaded.rooms.get(room.code)?.history.length, 1);
    assert.equal(reloaded.rooms.get(room.code)?.phase, 'lobby');
    store.newGame(room, host.id);
    assert.equal(room.phase, 'lobby');
    assert.ok([...room.players.values()].every((player) => player.score === 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an expired round scores the last selected color even without confirmation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'color-searth-timeout-'));
  try {
    const store = new GameStore(join(dir, 'rooms.json'));
    const { room, player: host } = store.create('Аня', '🦊', 'socket-1');
    store.join(room.code, 'Борис', '🐙', 'socket-2');
    store.join(room.code, 'Катя', '🦉', 'socket-3');
    store.updateSettings(room, host.id, { timerSeconds: 30, grayPercent: 10, strictness: 3 });
    store.start(room, host.id);
    store.submitClue(room, room.roster[0], 'Цвет осеннего утра');
    const firstGuesser = [...room.eligible][0];
    const lastColor: RGB = [19, 87, 173];
    store.updateDraft(room, firstGuesser, [1, 2, 3]);
    store.updateDraft(room, firstGuesser, lastColor);
    assert.deepEqual(store.view(room, firstGuesser).selfDraft, lastColor);
    assert.equal(store.view(room, room.roster[0]).selfDraft, null);
    assert.ok(store.view(room, firstGuesser).players.every((player) => !player.hasGuessed));
    room.deadline = Date.now() - 1;
    assert.throws(() => store.submitGuess(room, firstGuesser, [1, 2, 3]), /Время вышло/);
    assert.equal(room.phase, 'reveal');
    const result = room.results?.find((entry) => entry.playerId === firstGuesser);
    assert.deepEqual(result?.color, lastColor);
    assert.equal(result?.points, scoreGuess(room.target!, lastColor, 3));
    assert.equal(result?.autoSubmitted, true);
    assert.ok(room.results?.every((entry) => entry.color !== null && entry.points > 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
