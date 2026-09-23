import { useEffect, useMemo, useRef, useState } from 'react';
import { rgbCss, rgbToOklab, type Oklab, type RGB } from '../shared/color.ts';
import type { GuessResult } from '../shared/types.ts';

const INTRO_MS = 1700;
const TARGET_MS = 3000;
const GUESS_MS = 2100;
const OUTRO_MS = 2900;
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const point = ([L, a, b]: Oklab) => ({ x: a * 2.45, y: b * 2.45, z: (L - 0.5) * 1.7 });

type SceneStep = { kind: 'intro' | 'target' | 'guess' | 'overview'; index: number; progress: number };

export function revealDuration(count: number): number {
  return INTRO_MS + TARGET_MS + count * GUESS_MS + OUTRO_MS;
}

function sceneStep(elapsed: number, count: number): SceneStep {
  if (elapsed < INTRO_MS) return { kind: 'intro', index: -1, progress: elapsed / INTRO_MS };
  if (elapsed < INTRO_MS + TARGET_MS) return { kind: 'target', index: -1, progress: (elapsed - INTRO_MS) / TARGET_MS };
  const guessElapsed = elapsed - INTRO_MS - TARGET_MS;
  if (guessElapsed < count * GUESS_MS) return { kind: 'guess', index: Math.floor(guessElapsed / GUESS_MS), progress: (guessElapsed % GUESS_MS) / GUESS_MS };
  return { kind: 'overview', index: count, progress: Math.min(1, (guessElapsed - count * GUESS_MS) / OUTRO_MS) };
}

interface Particle { lab: Oklab; rgb: RGB; edge: boolean }
const particles: Particle[] = [];
// A regular sRGB lattice bends into the actual Oklab gamut, including its interior.
for (let r = 0; r <= 12; r++) for (let g = 0; g <= 12; g++) for (let b = 0; b <= 12; b++) {
  const rgb: RGB = [Math.round(r * 255 / 12), Math.round(g * 255 / 12), Math.round(b * 255 / 12)];
  const edge = [r, g, b].filter((n) => n === 0 || n === 12).length >= 2;
  if (edge || (r % 2 === 0 && g % 2 === 0 && b % 2 === 0)) particles.push({ rgb, lab: rgbToOklab(rgb), edge });
}

export function ResultsScene({ target, results, startedAt, replayAt }: {
  target: RGB;
  results: GuessResult[];
  startedAt: number;
  replayAt: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const ordered = useMemo(() => [...results].sort((a, b) => a.points - b.points || a.nickname.localeCompare(b.nickname, 'ru')), [results]);
  const origin = replayAt ?? startedAt;
  const duration = revealDuration(ordered.length);
  const step = sceneStep(elapsed, ordered.length);
  const current = step.kind === 'guess' ? ordered[step.index] : null;
  const revealedCount = step.kind === 'overview' ? ordered.length : step.kind === 'guess' ? step.index + 1 : 0;

  useEffect(() => {
    let handle = 0;
    let last = 0;
    const frame = (time: number) => {
      if (time - last >= 32) { setElapsed(Math.min(duration, Math.max(0, Date.now() - origin))); last = time; }
      handle = requestAnimationFrame(frame);
    };
    handle = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(handle);
  }, [duration, origin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bounds = host.getBoundingClientRect();
    const width = Math.max(300, bounds.width);
    const height = Math.max(330, bounds.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const targetPoint = point(rgbToOklab(target));
    const guessPoint = current?.color ? point(rgbToOklab(current.color)) : targetPoint;
    const transition = ease(step.progress / 0.38);
    const viewTarget = step.kind === 'target' ? ease(step.progress / 0.65) : step.kind === 'intro' ? 0 : step.kind === 'overview' ? 1 - ease(step.progress / 0.65) : 1;
    const attention = step.kind === 'guess' ? transition : 0;
    const focus = {
      x: mix(0, mix(targetPoint.x, (targetPoint.x + guessPoint.x) / 2, attention), viewTarget),
      y: mix(0, mix(targetPoint.y, (targetPoint.y + guessPoint.y) / 2, attention), viewTarget),
      z: mix(0, mix(targetPoint.z, (targetPoint.z + guessPoint.z) / 2, attention), viewTarget),
    };
    const base = Math.min(width / 2.35, height / 2.25);
    const zoom = mix(0.88, current ? 1.9 : 2.15, viewTarget);
    const yaw = -0.48 + Math.min(elapsed / 26000, 1) * 0.28;
    const elevation = 0.22;
    const project = (v: ReturnType<typeof point>) => {
      const px = v.x - focus.x, py = v.y - focus.y, pz = v.z - focus.z;
      const u = px * Math.cos(yaw) - py * Math.sin(yaw);
      const depth = px * Math.sin(yaw) + py * Math.cos(yaw);
      const vertical = pz * Math.cos(elevation) - depth * Math.sin(elevation);
      const perspective = 1 / (1 + depth * 0.13);
      return { x: width / 2 + u * base * zoom * perspective, y: height / 2 - vertical * base * zoom * perspective, depth };
    };

    const wash = ctx.createRadialGradient(width * .5, height * .5, 10, width * .5, height * .5, width * .65);
    wash.addColorStop(0, '#191c2d'); wash.addColorStop(1, '#0b0d16');
    ctx.fillStyle = wash; ctx.fillRect(0, 0, width, height);

    const dots = particles.map((particle) => ({ ...particle, at: project(point(particle.lab)) })).sort((a, b) => b.at.depth - a.at.depth);
    const opacity = step.kind === 'intro' ? mix(.05, .54, ease(step.progress)) : step.kind === 'overview' ? .58 : .4;
    for (const dot of dots) {
      if (dot.at.x < -10 || dot.at.x > width + 10 || dot.at.y < -10 || dot.at.y > height + 10) continue;
      const radius = (dot.edge ? 2.3 : 1.5) * (1 + (1 - dot.at.depth) * .16) * Math.min(1.4, zoom);
      ctx.beginPath(); ctx.arc(dot.at.x, dot.at.y, Math.max(.7, radius), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${dot.rgb.join(',')},${opacity * (dot.edge ? 1 : .5)})`;
      ctx.fill();
    }

    const drawMarker = (at: ReturnType<typeof project>, color: RGB, label: string, major: boolean, alpha = 1) => {
      const radius = major ? 11 : 8;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(at.x, at.y, radius + 10, 0, 2 * Math.PI);
      ctx.fillStyle = major ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.09)'; ctx.fill();
      ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = rgbCss(color); ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.font = '700 12px Manrope, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const lx = Math.min(width - textWidth - 19, Math.max(15, at.x + 16));
      const ly = Math.max(22, Math.min(height - 15, at.y - 20));
      ctx.fillStyle = 'rgba(9,10,18,.82)'; ctx.beginPath(); ctx.roundRect(lx - 8, ly - 16, textWidth + 16, 24, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, lx, ly);
      ctx.globalAlpha = 1;
    };
    if (step.kind !== 'intro') {
      const targetAt = project(targetPoint);
      if (current?.color) {
        const guessAt = project(guessPoint);
        ctx.beginPath(); ctx.moveTo(targetAt.x, targetAt.y); ctx.lineTo(guessAt.x, guessAt.y);
        ctx.setLineDash([4, 7]); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.globalAlpha = transition * .87; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        drawMarker(guessAt, current.color, current.nickname, false, transition);
      }
      if (step.kind === 'overview') for (const result of ordered) if (result.color) {
        const at = project(point(rgbToOklab(result.color)));
        ctx.beginPath(); ctx.moveTo(targetAt.x, targetAt.y); ctx.lineTo(at.x, at.y);
        ctx.setLineDash([3, 8]); ctx.lineWidth = 1.4; ctx.strokeStyle = '#ffffff8f'; ctx.stroke(); ctx.setLineDash([]);
        drawMarker(at, result.color, result.nickname, false, ease(step.progress));
      }
      drawMarker(targetAt, target, 'ЗАГАДАННЫЙ', true);
    }
    ctx.fillStyle = '#b7bfd3'; ctx.font = '600 11px Manrope, sans-serif';
    ctx.fillText('Oklab · L ↑   a ↗   b ↘', 18, height - 19);
  }, [target, ordered, elapsed, step.kind, step.index, step.progress, current]);

  const heading = step.kind === 'intro' ? 'Сопоставляем оттенки' : step.kind === 'target' ? 'Загаданный цвет' : step.kind === 'guess' ? current?.nickname ?? '' : 'Все ответы на карте цвета';
  const detail = step.kind === 'intro' ? 'Цветовой куб sRGB раскрывается в пространстве Oklab' : step.kind === 'target' ? 'Точка, к которой стремились все ответы' : step.kind === 'guess' ? current?.color ? `${current.avatar}  Δ ${current.distance?.toFixed(3)}  ·  +${current.points} очков${current.autoSubmitted ? ' · выбранный цвет засчитан по таймеру' : ''}` : `${current?.avatar}  ответа нет · 0 очков` : 'От самого далёкого ответа к самому близкому';
  return <div className="scene-wrap">
    <div className="scene-topline"><span className="scene-live"><i /> СРАВНЕНИЕ ЦВЕТОВ</span><span>{Math.min(revealedCount, ordered.length)} / {ordered.length} ответов</span></div>
    <div className="scene-canvas"><canvas ref={canvasRef} aria-label="Цветовой куб sRGB, преобразованный в Oklab, с ответами игроков" /><div className="scene-caption" key={`${step.kind}-${step.index}`}><span>{step.kind === 'guess' ? `ОТВЕТ ${step.index + 1} ИЗ ${ordered.length}` : 'ПРОСТРАНСТВО ЦВЕТА'}</span><h2>{heading}</h2><p>{detail}</p></div></div>
    <div className="scene-progress"><span style={{ width: `${Math.min(100, elapsed / duration * 100)}%` }} /></div>
  </div>;
}
