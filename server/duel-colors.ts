import type { RGB } from '../shared/color.ts';

export interface DuelColor {
  id: string;
  color: RGB;
  clue: string;
}

// Original, short prompts: neither player knows the target before reveal.
// The selection spans hue, lightness and saturation, including neutrals.
export const DUEL_COLORS: readonly DuelColor[] = [
  { id: 'ember', color: [232, 76, 46], clue: 'Искра внутри тлеющего угля, когда в камине почти погас огонь.' },
  { id: 'tomato', color: [190, 39, 48], clue: 'Спелый помидор в полуденном свете.' },
  { id: 'rose-petal', color: [242, 153, 174], clue: 'Лепесток садовой розы на белой скатерти.' },
  { id: 'raspberry', color: [155, 37, 91], clue: 'Сок раздавленной малины на пальцах.' },
  { id: 'clay', color: [174, 92, 68], clue: 'Глиняный кувшин после обжига.' },
  { id: 'peach', color: [255, 181, 132], clue: 'Мякоть персика под тонкой кожицей.' },
  { id: 'candle', color: [255, 219, 128], clue: 'Пламя свечи сквозь матовое стекло.' },
  { id: 'honey', color: [215, 152, 38], clue: 'Густой мёд в стеклянной банке на солнце.' },
  { id: 'lemon', color: [242, 226, 64], clue: 'Свежая цедра лимона на кухонной доске.' },
  { id: 'straw', color: [194, 181, 103], clue: 'Сухая солома в поле после уборки урожая.' },
  { id: 'spring-leaf', color: [140, 200, 79], clue: 'Молодой лист сразу после весеннего дождя.' },
  { id: 'fern', color: [41, 105, 64], clue: 'Папоротник в глубокой тени леса.' },
  { id: 'olive', color: [111, 123, 58], clue: 'Незрелая оливка на ветке.' },
  { id: 'mint', color: [144, 224, 189], clue: 'Лист мяты под холодной водой.' },
  { id: 'sea-glass', color: [63, 169, 155], clue: 'Округлый кусочек стекла, найденный на берегу.' },
  { id: 'lagoon', color: [39, 194, 210], clue: 'Мелкая вода тропической лагуны сверху.' },
  { id: 'rain-window', color: [105, 151, 166], clue: 'Дождливое небо за запотевшим окном.' },
  { id: 'deep-water', color: [25, 80, 130], clue: 'Вода под кораблём там, где дна уже не видно.' },
  { id: 'denim', color: [64, 105, 174], clue: 'Выцветшая джинсовая куртка.' },
  { id: 'electric', color: [71, 83, 225], clue: 'Светящийся экран игровой приставки в темноте.' },
  { id: 'lavender', color: [174, 151, 217], clue: 'Пучок лаванды на подоконнике в сумерках.' },
  { id: 'plum', color: [92, 56, 124], clue: 'Кожица спелой сливы под кухонной лампой.' },
  { id: 'orchid', color: [194, 95, 187], clue: 'Орхидея на витрине цветочного магазина.' },
  { id: 'cotton-candy', color: [239, 183, 215], clue: 'Сладкая вата на вечерней ярмарке.' },
  { id: 'ink', color: [31, 38, 61], clue: 'Чернила в закрытой перьевой ручке.' },
  { id: 'charcoal', color: [54, 55, 59], clue: 'Угольный карандаш на листе бумаги.' },
  { id: 'fog', color: [183, 194, 199], clue: 'Густой утренний туман над озером.' },
  { id: 'porcelain', color: [239, 235, 219], clue: 'Старая фарфоровая чашка при дневном свете.' },
  { id: 'sand', color: [203, 179, 145], clue: 'Мокрый песок чуть выше линии прибоя.' },
  { id: 'cocoa', color: [102, 65, 51], clue: 'Порошок какао на деревянной ложке.' },
  { id: 'snow-shadow', color: [213, 225, 241], clue: 'Тень на снегу в ясный зимний день.' },
  { id: 'night-sky', color: [29, 37, 91], clue: 'Небо сразу после исчезновения последних полос заката.' },
];

export const DUEL_ROUNDS = 5;
