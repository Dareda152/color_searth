export function DescriberAward({ avatar, nickname, points }: { avatar: string; nickname: string; points: number }) {
  return <div className="describer-award">
    <div className="describer-award-icon">{avatar}</div>
    <div className="describer-award-copy"><span>ОЧКИ ВЕДУЩЕГО</span><strong>{nickname}</strong><small>Средний балл всех угадывающих в этом раунде</small></div>
    <div className="describer-award-points"><span>+</span>{points.toLocaleString('ru-RU')}</div>
  </div>;
}
