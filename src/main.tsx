import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { maxChroma, oklabToRgb, rgbCss, rgbToOklab, wheelToRgb, type RGB } from '../shared/color.ts';
import { AVATARS, type RoomSettings, type RoomView } from '../shared/types.ts';
import { ResultsScene, revealDuration } from './ResultsScene.tsx';
import { LobbyPanel } from './LobbyPanel.tsx';
import { DescriberAward } from './DescriberAward.tsx';
import './styles.css';
import './refresh.css';

const socket = io({ autoConnect: false, reconnection: true });
type Ack = { ok: true; code?: string; token?: string } | { ok: false; error: string };
const roomCodeFromPath = () => /^\/room\/([A-Z2-9]{8})\/?$/i.exec(window.location.pathname)?.[1]?.toUpperCase() ?? '';
const initialPicker = { L: 0.72, hue: 0.9, radius: 0.78 };
function pickerFromRgb(color: RGB) {
  const [L, a, b] = rgbToOklab(color);
  const hue = (Math.atan2(b, a) + 2 * Math.PI) % (2 * Math.PI);
  return { L, hue, radius: Math.min(1, Math.hypot(a, b) / Math.max(0.0001, maxChroma(L, hue))) };
}

function emit(event: string, payload?: unknown): Promise<Ack> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve({ ok: false, error: 'Сервер не ответил. Повторите попытку.' }), 7000);
    const ack = (result: Ack) => { window.clearTimeout(timeout); resolve(result); };
    if (payload === undefined) socket.emit(event, ack);
    else socket.emit(event, payload, ack);
  });
}

function ColorWheel({ value, onChange, disabled = false }: {
  value: { L: number; hue: number; radius: number };
  onChange: (value: { L: number; hue: number; radius: number }) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 280;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(size, size);
    const boundaries = Array.from({ length: 720 }, (_, index) => maxChroma(value.L, index / 720 * 2 * Math.PI));
    const center = size / 2;
    const radius = center - 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5 - center) / radius;
        const dy = (center - y - 0.5) / radius;
        const r = Math.hypot(dx, dy);
        const index = (y * size + x) * 4;
        if (r > 1) { image.data[index + 3] = 0; continue; }
        const hue = (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI);
        const chroma = r * boundaries[Math.floor(hue / (2 * Math.PI) * 720) % 720];
        const [red, green, blue] = oklabToRgb([value.L, chroma * Math.cos(hue), chroma * Math.sin(hue)]);
        image.data[index] = red;
        image.data[index + 1] = green;
        image.data[index + 2] = blue;
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [value.L]);

  const select = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2);
    const y = (bounds.height / 2 - event.clientY + bounds.top) / (bounds.height / 2);
    onChange({ ...value, hue: (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI), radius: Math.min(1, Math.hypot(x, y)) });
  };
  const selected = wheelToRgb(value.L, value.hue, value.radius);
  return <div className={`picker ${disabled ? 'picker--disabled' : ''}`}>
    <div className="wheel-frame" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); select(event); }}
      onPointerMove={(event) => { if (event.buttons) select(event); }}>
      <canvas ref={canvasRef} width={size} height={size} aria-label="Цветовой круг Oklab" />
      <span className="wheel-pointer" style={{ left: `${50 + 49 * value.radius * Math.cos(value.hue)}%`, top: `${50 - 49 * value.radius * Math.sin(value.hue)}%`, background: rgbCss(selected) }} />
    </div>
    <label className="slider-label" htmlFor="lightness">Светлота <strong>{Math.round(value.L * 100)}%</strong></label>
    <input id="lightness" type="range" min="10" max="95" value={Math.round(value.L * 100)} disabled={disabled}
      onChange={(event) => onChange({ ...value, L: Number(event.target.value) / 100 })} />
    <div className="picker-preview"><span className="swatch" style={{ background: rgbCss(selected) }} /> <span>Ваш выбор</span><strong>{selected.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}</strong></div>
  </div>;
}

function App() {
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<RoomView | null>(null);
  const [code, setCode] = useState(roomCodeFromPath);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clue, setClue] = useState('');
  const [settings, setSettings] = useState<RoomSettings>({ mode: 'classic', timerSeconds: 90, grayPercent: 10, strictness: 3 });
  const [picker, setPicker] = useState(initialPicker);
  const [now, setNow] = useState(Date.now());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [animationAt, setAnimationAt] = useState<number | null>(null);

  useEffect(() => {
    const connect = async () => {
      setConnected(true);
      const currentCode = roomCodeFromPath();
      const token = currentCode && localStorage.getItem(`color-searth-token-${currentCode}`);
      if (currentCode && token) {
        const result = await emit('resume', { code: currentCode, token });
        if (!result.ok) { localStorage.removeItem(`color-searth-token-${currentCode}`); setView(null); }
      }
    };
    const disconnect = () => setConnected(false);
    const state = (next: RoomView) => { setView(next); setError(''); };
    socket.on('connect', connect);
    socket.on('disconnect', disconnect);
    socket.on('state', state);
    socket.connect();
    return () => { socket.off('connect', connect); socket.off('disconnect', disconnect); socket.off('state', state); socket.disconnect(); };
  }, []);

  useEffect(() => { if (view) setSettings(view.settings); }, [view?.settings.mode, view?.settings.timerSeconds, view?.settings.grayPercent, view?.settings.strictness]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    setClue('');
    setPicker(view?.phase === 'guess' && view.selfDraft ? pickerFromRgb(view.selfDraft) : initialPicker);
  }, [view?.code, view?.roundNumber]);
  useEffect(() => { setAnimationAt(null); }, [view?.phaseStartedAt]);

  const action = useCallback(async (event: string, payload?: unknown) => {
    setBusy(true);
    setError('');
    const result = await emit(event, payload);
    setBusy(false);
    if (!result.ok) setError(result.error);
    return result;
  }, []);

  const enter = async (create: boolean) => {
    const event = create ? 'create_room' : 'join_room';
    const result = await action(event, create ? { nickname, avatar } : { code, nickname, avatar });
    if (result.ok && result.code && result.token) {
      localStorage.setItem(`color-searth-token-${result.code}`, result.token);
      history.replaceState(null, '', `/room/${result.code}`);
      setCode(result.code);
    }
  };

  const self = view?.players.find((player) => player.id === view.selfId);
  const describer = view?.players.find((player) => player.id === view.describerId);
  const isHost = !!self?.isHost;
  const secondsLeft = view?.deadline ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : 0;
  const selectedRgb = useMemo(() => wheelToRgb(picker.L, picker.hue, picker.radius), [picker]);
  const accentRgb = useMemo(() => wheelToRgb(Math.max(0.7, picker.L), picker.hue, Math.max(0.55, picker.radius)), [picker]);
  const accentStyle = {
    '--accent': rgbCss(selectedRgb),
    '--accent-ink': rgbCss(accentRgb),
    '--accent-rgb': selectedRgb.join(' '),
  } as React.CSSProperties;
  const selectColor = (next: typeof picker) => {
    setPicker(next);
    socket.emit('draft_guess', wheelToRgb(next.L, next.hue, next.radius));
  };
  const duel = (view?.phase === 'lobby' ? settings.mode : view?.settings.mode) === 'duel';
  const guessers = view?.players.filter((player) => player.connected && (duel ? player.inCurrentGame : player.id !== view.describerId)) ?? [];
  const answeredCount = guessers.filter((player) => player.hasGuessed).length;
  const sceneOrigin = animationAt ?? view?.phaseStartedAt ?? now;
  const sceneDone = !!view && now - sceneOrigin >= revealDuration(view.results?.length ?? 0);
  const finalBoard = view?.history[0]?.leaderboard ?? [];
  const finalDuration = 1600 + finalBoard.length * 800;
  const finalElapsed = now - sceneOrigin;
  const finalShown = Math.min(finalBoard.length, Math.max(0, Math.floor((finalElapsed - 750) / 800) + 1));
  const copyInvite = async () => {
    if (!view) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/room/${view.code}`); }
    catch { setError('Не удалось скопировать ссылку. Код комнаты можно отправить вручную.'); }
  };

  return <div className="site-shell" style={accentStyle}>
    <header className="topbar"><div className="brand"><span className="brand-mark" />ЦВЕТОСФЕРА<span className="brand-index">/ COLOR SYSTEM 01</span></div><span className="topbar-note">СЛОВА / ОТТЕНКИ / ТОЧНОСТЬ</span><span className={`connection ${connected ? 'online' : ''}`}>{connected ? '● В СЕТИ' : '○ НЕТ СВЯЗИ'}</span></header>
    {!view ? <main className="welcome layout">
      <section className="welcome-copy"><div className="eyebrow">ИНТЕРАКТИВНЫЙ ЦВЕТОВОЙ ЭКСПЕРИМЕНТ / 001</div><div className="hero-orbit"><div className="hero-cross hero-cross-x" /><div className="hero-cross hero-cross-y" /><div className="hero-core"><span>COLOR / PERCEPTION</span><h1>Один цвет.<br /><em>Тысяча слов.</em></h1><p>Опиши оттенок. Найди его по чужой подсказке. Попади как можно ближе.</p></div><span className="orbit-point orbit-point-a" /><span className="orbit-point orbit-point-b" /></div><div className="feature-row"><span>01 / ОПИСЫВАЙ</span><span>02 / ВЫБИРАЙ</span><span>03 / СРАВНИВАЙ</span></div></section>
      <section className="entry-card panel"><div className="entry-heading"><span>ПОДКЛЮЧЕНИЕ / 01</span><span>↗</span></div><h2>Начать игру</h2><p>Создай комнату или присоединись по коду.</p><label>ИМЯ ИГРОКА<input maxLength={20} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="Ваше имя" /></label><div className="field-label">АВАТАР</div><div className="avatar-grid">{AVATARS.map((item) => <button key={item} className={avatar === item ? 'avatar selected' : 'avatar'} onClick={() => setAvatar(item)} aria-label={`Аватар ${item}`}>{item}</button>)}</div><label>КОД КОМНАТЫ <small>ДЛЯ ВХОДА</small><input maxLength={8} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXXXXXX" /></label><div className="entry-actions"><button className="button primary" disabled={!connected || busy} onClick={() => enter(false)}>Войти по коду ↗</button><button className="button secondary" disabled={!connected || busy} onClick={() => enter(true)}>Создать комнату +</button></div>{error && <div className="error">{error}</div>}</section>
    </main> : <main className="layout game-layout">
      <section className="game-main">
        <div className="room-heading"><div><div className="eyebrow">КОМНАТА {view.code}</div><h1>{view.phase === 'lobby' ? 'Собираем компанию' : view.phase === 'finished' ? (duel ? 'Дуэль завершена' : 'Партия завершена') : `${duel ? 'Дуэль' : 'Раунд'} ${view.roundNumber} / ${view.totalRounds}`}</h1></div><button className="button ghost invite" onClick={copyInvite}>↗ Скопировать приглашение</button></div>
        {!connected && <div className="notice">Соединение прервано. Пытаемся подключиться снова…</div>}
        {view.phase === 'lobby' && <LobbyPanel view={view} settings={settings} onSettingsChange={setSettings} isHost={isHost} busy={busy} action={action} />}
        {view.phase === 'clue' && <div className="panel round-panel"><div className="round-kicker">ХОД ВЕДУЩЕГО <span>{describer?.avatar} {describer?.nickname}</span></div>{self?.isDescriber ? <><h2>Опишите этот цвет</h2><div className="secret-color" style={{ background: view.target ? rgbCss(view.target) : undefined }}><span>Этот оттенок видите только вы</span></div><p className="hint">Образ, предмет или настроение помогут лучше прямого названия цвета. Названия цветов и цветовые коды запрещены.</p><textarea maxLength={140} value={clue} onChange={(event) => setClue(event.target.value)} placeholder="Например: свет через листву в пасмурный день…" /><div className="form-footer"><span>{Array.from(clue).length} / 140</span><button className="button primary" disabled={busy || !clue.trim()} onClick={() => action('clue', clue)}>Показать подсказку →</button></div></> : <><div className="waiting-orb" /><h2>Ждём описание цвета</h2><p>Когда ведущий отправит подсказку, появится круг и запустится таймер.</p>{isHost && describer && !describer.connected && <button className="button secondary" onClick={() => action('skip')}>Пропустить ход отключившегося игрока</button>}</>}{now - view.phaseStartedAt < 2600 && <div className="round-intro"><span>НОВЫЙ РАУНД</span><strong>{view.roundNumber} <small>/ {view.totalRounds}</small></strong><p>{describer?.avatar} {describer?.nickname} описывает цвет</p><div className="round-intro-line" /></div>}</div>}
        {view.phase === 'guess' && <div className="panel round-panel"><div className="round-kicker">{duel ? 'ПОДСКАЗКА ДУЭЛИ' : `ПОДСКАЗКА ОТ ${describer?.nickname?.toUpperCase()}`} <span className="countdown">◷ {secondsLeft} с</span></div><blockquote>{view.clue}</blockquote><div className="guess-progress"><div><strong>{answeredCount} / {guessers.length}</strong><span>ответили</span></div><div className="guess-progress-track"><span style={{ width: `${guessers.length ? answeredCount / guessers.length * 100 : 0}%` }} /></div><div className="guess-progress-avatars">{guessers.map((player) => <span title={`${player.nickname}: ${player.hasGuessed ? 'ответил' : 'выбирает цвет'}`} className={player.hasGuessed ? 'done' : ''} key={player.id}>{player.avatar}<i>{player.hasGuessed ? '✓' : '·'}</i></span>)}</div></div>{duel && !self?.inCurrentGame ? <div className="submitted"><h2>Вы наблюдаете за дуэлью</h2><p>Присоединиться к игре можно в следующей партии.</p></div> : self?.isDescriber ? <><div className="secret-color compact" style={{ background: view.target ? rgbCss(view.target) : undefined }} /><p>Вы уже описали цвет. Ждём ответы остальных игроков.</p></> : self?.hasGuessed ? <div className="submitted"><span>✓</span><h2>Ответ принят</h2><p>Результаты появятся после ответов всех игроков или окончания времени.</p></div> : <><p className="hint">Найдите оттенок на круге и установите светлоту. Выбранный цвет засчитается, даже если не нажать кнопку до конца времени.</p><ColorWheel value={picker} onChange={selectColor} /><button className="button primary guess-button" disabled={busy || secondsLeft <= 0} onClick={() => action('guess', selectedRgb)}>Зафиксировать ответ →</button></>}{now - view.phaseStartedAt < 1700 && <div className="round-intro guess-intro"><span>{duel ? 'ЦВЕТОВАЯ ДУЭЛЬ' : `РАУНД ${view.roundNumber} ИЗ ${view.totalRounds}`}</span><strong>◉</strong><p>Подсказка открыта — выбирайте цвет</p><div className="round-intro-line" /></div>}</div>}
        {view.phase === 'reveal' && <div className="panel round-panel reveal-panel"><div className="round-kicker">ИТОГИ РАУНДА {view.roundNumber}</div>{view.skipped ? <><h2>Раунд пропущен</h2><p>Ведущий отключился до публикации подсказки. Очки не начислены.</p></> : <><ResultsScene target={view.target!} results={view.results ?? []} startedAt={view.phaseStartedAt} replayAt={animationAt} /><div className={`reveal-details ${sceneDone ? 'visible' : ''}`}>{!duel && describer && <DescriberAward avatar={describer.avatar} nickname={describer.nickname} points={view.describerPoints ?? 0} />}<div className="answer-hero"><span className="answer-swatch" style={{ background: view.target ? rgbCss(view.target) : undefined }} /><div><span>Подсказка</span><strong>«{view.clue}»</strong></div></div><div className="results-list">{view.results?.map((result) => <div className="result-row" key={result.playerId}><span className="result-avatar">{result.avatar}</span><span className="result-name">{result.nickname}{result.autoSubmitted ? <small>Засчитано по таймеру</small> : null}</span><span className="result-color" style={{ background: result.color ? rgbCss(result.color) : 'transparent' }} /> <span className="result-distance">{result.distance === null ? 'Нет ответа' : `Δ ${result.distance.toFixed(3)}`}</span><strong>+{result.points}</strong></div>)}</div></div></>}{!view.skipped && <button className="button ghost replay-button" onClick={() => setAnimationAt(Date.now())}>↺ Повторить показ</button>}{!sceneDone && !view.skipped && <button className="button ghost skip-button" onClick={() => setAnimationAt(Date.now() - revealDuration(view.results?.length ?? 0))}>Показать всё сразу</button>}{isHost ? <button className="button primary next-button" disabled={busy || (!sceneDone && !view.skipped)} onClick={() => action('next')}>{view.roundNumber === view.totalRounds ? 'Показать победителя →' : 'Следующий раунд →'}</button> : <div className="notice">Следующий раунд запустит хозяин комнаты.</div>}</div>}
        {view.phase === 'finished' && <div className="panel finish-panel"><div className="eyebrow">ФИНАЛЬНЫЙ РЕЙТИНГ</div><h2>{finalShown < finalBoard.length ? 'Кто победил?' : view.history[0]?.winners.join(' и ') || 'Игра окончена'}</h2><p>От последнего места к первому — каждый балл на виду.</p><div className="podium">{[...finalBoard].reverse().map((player, reverseIndex) => { const visible = reverseIndex < finalShown; const rank = finalBoard.length - reverseIndex; return <div className={`podium-row ${visible ? 'visible' : ''} ${rank === 1 ? 'winner' : ''}`} key={`${player.nickname}-${rank}`}><span className="podium-rank">{visible ? rank : '·'}</span><span className="podium-avatar">{visible ? player.avatar : ''}</span><span className="podium-name">{visible ? player.nickname : ''}</span><div className="podium-meter"><span style={{ width: visible ? `${Math.max(3, player.score / Math.max(1, finalBoard[0]?.score ?? 1) * 100)}%` : '0%' }} /></div><strong>{visible ? player.score.toLocaleString('ru-RU') : '—'}</strong></div>; })}</div><div className="finish-actions"><button className="button ghost" onClick={() => setAnimationAt(Date.now())}>↺ Повторить итог</button>{finalElapsed < finalDuration && <button className="button ghost" onClick={() => setAnimationAt(Date.now() - finalDuration)}>Показать всё сразу</button>}{isHost && <button className="button primary" disabled={busy || finalElapsed < finalDuration} onClick={() => action('new_game')}>Новая партия →</button>}</div></div>}
        {error && <div className="error global-error">{error}</div>}
        <section className="history-section"><button className="history-toggle" onClick={() => setHistoryOpen(!historyOpen)}>История партий <span>{historyOpen ? '−' : '+'}</span></button>{historyOpen && (view.history.length ? <div className="history-list">{view.history.map((game) => <div className="history-game" key={game.id}><strong>{game.winners.join(' и ')}</strong><small>{new Date(game.finishedAt).toLocaleString('ru-RU')}</small><span>{game.leaderboard.map((player) => `${player.nickname} ${player.score}`).join(' · ')}</span></div>)}</div> : <p className="muted">Пока нет завершённых партий.</p>)}</section>
      </section>
      <aside className="sidebar"><div className="panel players-panel"><div className="sidebar-title"><h3>ИГРОКИ</h3><span>{view.players.filter((player) => player.connected).length} В СЕТИ</span></div><div className="player-list">{view.players.map((player) => { const showScore = view.phase !== 'reveal' || sceneDone || view.skipped; const finalRank = finalBoard.findIndex((entry) => entry.nickname === player.nickname); const finalVisible = view.phase !== 'finished' || finalRank < 0 || finalBoard.length - finalRank <= finalShown; return <div className={`player-row ${player.id === view.selfId ? 'you' : ''} ${view.phase === 'guess' && player.hasGuessed ? 'answered' : ''}`} key={player.id}><span className="player-avatar">{player.avatar}</span><span className="player-info"><strong>{player.nickname}{player.id === view.selfId ? ' · вы' : ''}</strong><small>{!player.connected ? 'Не в сети' : view.phase === 'guess' && player.hasGuessed ? 'Ответ зафиксирован' : duel && !player.inCurrentGame && view.phase !== 'lobby' ? 'Зритель' : player.isDescriber && view.phase !== 'lobby' ? 'Ведущий' : player.isHost ? 'Хозяин' : 'В игре'}</small></span>{view.phase === 'guess' && player.hasGuessed ? <span className="answered-check">✓</span> : null}<span className="player-score">{showScore && finalVisible ? player.score.toLocaleString('ru-RU') : '•••'}</span></div>; })}</div></div></aside>
    </main>}
    <footer><span>ЦВЕТОСФЕРА / 2026</span><span>ЦВЕТА СТАНОВЯТСЯ БЛИЖЕ, КОГДА О НИХ ГОВОРЯТ</span><span>OKLAB / RGB</span></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
