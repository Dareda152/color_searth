import type { RoomSettings, RoomView } from '../shared/types.ts';

export function LobbyPanel({ view, settings, onSettingsChange, isHost, busy, action }: {
  view: RoomView;
  settings: RoomSettings;
  onSettingsChange: (settings: RoomSettings) => void;
  isHost: boolean;
  busy: boolean;
  action: (event: string, payload?: unknown) => void;
}) {
  const duel = settings.mode === 'duel';
  const connected = view.players.filter((player) => player.connected).length;
  const saved = JSON.stringify(settings) === JSON.stringify(view.settings);
  const canStart = duel ? connected === 2 : connected >= 3;

  return <div className="panel lobby-panel">
    <div className="section-heading"><span className="section-icon">✳</span><div><h2>Настройки партии</h2><p>{duel ? 'Для дуэли нужны ровно два игрока.' : 'Для классической игры нужны минимум три игрока.'}</p></div></div>
    <div className="mode-picker" role="group" aria-label="Режим игры">
      <button className={`mode-option ${!duel ? 'selected' : ''}`} disabled={!isHost} onClick={() => onSettingsChange({ ...settings, mode: 'classic' })}>
        <span>✦ КЛАССИКА</span><strong>Объясни свой цвет</strong><small>Каждый по очереди даёт подсказку. Количество раундов равно числу игроков.</small>
      </button>
      <button className={`mode-option ${duel ? 'selected' : ''}`} disabled={!isHost} onClick={() => onSettingsChange({ ...settings, mode: 'duel' })}>
        <span>⚔ ДУЭЛЬ 1 × 1</span><strong>Одна подсказка для двоих</strong><small>Пять цветов из базы. Оба угадывают одновременно, побеждает сумма очков.</small>
      </button>
    </div>
    <div className="settings-grid"><div className="setting"><label>Время на ответ <strong>{settings.timerSeconds} с</strong></label><input type="range" min="30" max="180" step="15" disabled={!isHost} value={settings.timerSeconds} onChange={(event) => onSettingsChange({ ...settings, timerSeconds: Number(event.target.value) })} /><small>Таймер начнётся после публикации подсказки.</small></div>
      {!duel && <div className="setting"><label>Доля приглушённых цветов <strong>{settings.grayPercent}%</strong></label><input type="range" min="0" max="100" step="5" disabled={!isHost} value={settings.grayPercent} onChange={(event) => onSettingsChange({ ...settings, grayPercent: Number(event.target.value) })} /><small>Остальные цвета будут более насыщенными.</small></div>}
      <div className="setting"><label>Строгость оценки <strong>{settings.strictness} / 5</strong></label><input type="range" min="1" max="5" step="1" disabled={!isHost} value={settings.strictness} onChange={(event) => onSettingsChange({ ...settings, strictness: Number(event.target.value) })} /><small>Пример: при расстоянии 0,1 — {Math.round(5000 * Math.exp(-0.1 / [0.24, 0.19, 0.15, 0.11, 0.08][settings.strictness - 1]))} очков.</small></div></div>
    {isHost ? <div className="lobby-actions"><button className="button secondary" disabled={busy || saved} onClick={() => action('settings', settings)}>Сохранить настройки</button><button className="button primary" disabled={busy || !canStart || !saved} onClick={() => action('start')}>{duel ? 'Начать дуэль →' : 'Начать игру →'}</button></div> : <div className="notice">Хозяин комнаты настроит и запустит партию.</div>}
  </div>;
}
