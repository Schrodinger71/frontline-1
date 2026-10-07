'use strict';
/* ============================================================
   ОБЩИЙ МИР: карта, типы частей, утилиты.
   Фронт вертикальный: Запад (n) слева, Восток (s) справа —
   карта повёрнута на 90° относительно первой версии, поэтому
   WW (300) теперь короткая ось (разделяет стороны), WH (440) —
   длинная, вдоль которой тянется линия фронта.
   Используется и сервером (require), и браузером (<script> —
   тогда просто вешает имена в window, как и всё остальное здесь).
   ============================================================ */
(function (g) {
  const WW = 300, WH = 440;
  const SIM_DT = 1;
  const N = 'n', S = 's';
  const COL = { n: '#6cc3ff', s: '#ff5b47' };
  const SIDE_NAME = { n: 'Запад', s: 'Восток' };

  const KINDS = {
    inf:  { n: 'Пехота',           sh: 'ПЕХ', air: 0, sp: 12,  hp: 110, atk: 8,  rng: 2.8, cap: 1.4, vis: 8,  arm: 1,   vs: 'g' },
    mot:  { n: 'Мотопехота',       sh: 'МП',  air: 0, sp: 42,  hp: 95,  atk: 11, rng: 3.6, cap: 1.1, vis: 9,  arm: 1.1, vs: 'g' },
    tnk:  { n: 'Танки',            sh: 'ТАН', air: 0, sp: 34,  hp: 190, atk: 26, rng: 5.8, cap: .4,  vis: 10, arm: 2.2, vs: 'g' },
    art:  { n: 'Артиллерия',       sh: 'АРТ', air: 0, sp: 22,  hp: 70,  atk: 20, rng: 28,  cap: 0,   vis: 12, arm: .9,  vs: 'g', splash: 4 },
    aa:   { n: 'ПВО',              sh: 'ПВО', air: 0, sp: 24,  hp: 80,  atk: 16, rng: 14,  cap: 0,   vis: 16, arm: 1,   vs: 'a' },
    ew:   { n: 'РЭБ «Туман»',      sh: 'РЭБ', air: 0, sp: 20,  hp: 65,  atk: 2,  rng: 4,   cap: 0,   vis: 14, arm: .8,  vs: 'g', jam: 20 },
    hel:  { n: 'Вертолёт',         sh: 'ВП',  air: 1, sp: 190, hp: 70,  atk: 18, rng: 5,   cap: 0,   vis: 18, arm: .7,  vs: 'b', fuel: 2400 },
    jet:  { n: 'Штурмовик',        sh: 'ШТ',  air: 1, sp: 720, hp: 55,  atk: 34, rng: 8,   cap: 0,   vis: 22, arm: .6,  vs: 'b', fuel: 900, strike: 1 },
    uav:  { n: 'Разведдрон',       sh: 'БПЛА',air: 1, sp: 130, hp: 22,  atk: 3,  rng: 2,   cap: 0,   vis: 38, arm: .3,  vs: 'g', fuel: 3600 },
    atkd: { n: 'Ударный дрон',     sh: 'УД',  air: 1, sp: 95,  hp: 18,  atk: 28, rng: 1.2, cap: 0,   vis: 12, arm: .25, vs: 'g', fuel: 1800, kamikaze: 1 }
  };

  /* фиктивные обозначения образцов техники — чисто флёр для карточки части */
  const MODEL = {
    inf: 'штурмовая группа', mot: 'БТР «Шмель»', tnk: 'Т-9 «Молот»', art: 'САУ «Гром»',
    aa: 'ЗРК «Стрела-Ф»', ew: 'РЭБ «Туман»', hel: 'Ми «Коршун»', jet: 'Су «Вихрь»',
    uav: 'БПЛА «Сова»', atkd: 'дрон «Оса»'
  };

  const CS_N = ['Сокол','Ясень','Клён','Буран','Омега','Рассвет','Тигр','Коршун','Волна','Ручей','Утёс','Иней',
    'Гранит','Полюс','Вереск','Заря','Орбита','Кедр','Айсберг','Пихта','Маяк','Зенит-З','Купол','Скала'];
  const CS_S = ['Шторм','Ястреб','Зенит','Пепел','Клин','Набат','Гроза','Филин','Камень','Степь','Барс','Искра',
    'Факел','Вулкан','Орион','Жара','Самум','Кобра','Горизонт','Феникс','Циклон','Рубин','Гюрза','Закат'];

  /* точки — город/узел: id, имя, город?, координаты, вес (значимость), владелец при старте */
  const POINT_DEF = [
    { id: 'velsk', n: 'Вельск', city: 1, x: 42,  y: 210, w: 3,   owner: N },
    { id: 'gorn',  n: 'Горное', city: 1, x: 58,  y: 78,  w: 2,   owner: N },
    { id: 'lip',   n: 'Липовка', city: 1, x: 64,  y: 340, w: 2,   owner: N },
    { id: 'yary',  n: 'Яры', city: 0, x: 96,  y: 150, w: 1.2, owner: N },
    { id: 'kam',   n: 'Каменка', city: 1, x: 108, y: 268, w: 1.6, owner: N },
    { id: 'vys',   n: 'Высота 214', city: 0, x: 142, y: 92,  w: 1.4, owner: N },
    { id: 'brod',  n: 'Броды', city: 1, x: 148, y: 210, w: 2.2, owner: N },
    { id: 'olh',   n: 'Ольховка', city: 0, x: 152, y: 330, w: 1.3, owner: S },
    { id: 'most',  n: 'Мост', city: 0, x: 168, y: 154, w: 1.5, owner: S },
    { id: 'raz',   n: 'Разъезд', city: 0, x: 176, y: 392, w: 1.1, owner: S },
    { id: 'step',  n: 'Степное', city: 1, x: 198, y: 250, w: 1.8, owner: S },
    { id: 'zar',   n: 'Заречье', city: 1, x: 228, y: 86,  w: 2,   owner: S },
    { id: 'kras',  n: 'Красногор', city: 1, x: 262, y: 210, w: 3,   owner: S },
    { id: 'ugol',  n: 'Угольный', city: 1, x: 244, y: 360, w: 2,   owner: S }
  ];

  /* ---------- экономика: бюджет, закупка, зоны высадки (как в Wargame) ---------- */
  const PRICE = { inf: 40, mot: 70, tnk: 150, art: 110, aa: 100, ew: 90, hel: 220, jet: 260, uav: 60, atkd: 90 };
  const START_BUDGET = 1000;
  const DEPLOY_SEC = 75;           /* секунды на расстановку (реальное время, не игровое) */
  const BASE_INCOME = 2;           /* очки/сек даже без городов */
  const INCOME_PER_WEIGHT = .7;    /* очки/сек за каждую единицу веса удержанного города */
  /* бонус роли: наступающий получает больше стартового бюджета, обороняющийся — больше дохода */
  const ROLE_BUDGET_MUL = { attacker: 1.4, defender: 1, both: 1 };
  const ROLE_INCOME_MUL = { attacker: 1, defender: 1.25, both: 1 };
  /* зона высадки — где можно покупать части при расстановке (вся высота карты, своя половина по x) */
  const DEPLOY_ZONE = { n: { x0: 4, x1: 140 }, s: { x0: 160, x1: WW - 4 } };
  /* состав закупок бота — какой тип покупать чаще (эстетика состава армии) */
  const BOT_MIX = ['inf', 'inf', 'mot', 'mot', 'tnk', 'tnk', 'art', 'aa', 'ew', 'hel', 'uav', 'atkd', 'inf', 'tnk'];

  const TRAITS = ['решительный', 'осторожный', 'методичный', 'нервный', 'упрямый'];
  const GEN_FIRST = ['Иван', 'Пётр', 'Олег', 'Семён', 'Андрей', 'Глеб', 'Виктор', 'Макар'];
  const GEN_LAST = ['Воронцов', 'Гром', 'Садовский', 'Крылов', 'Бурый', 'Жилин', 'Остапенко', 'Леднёв'];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp = (a, b, t) => a + (b - a) * t;
  function mulberry(a) {
    return () => {
      let t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pick(rnd, list) { return list[Math.floor((rnd ? rnd() : Math.random()) * list.length)]; }

  const api = {
    WW, WH, SIM_DT, N, S, COL, SIDE_NAME, KINDS, MODEL, CS_N, CS_S, POINT_DEF,
    PRICE, START_BUDGET, DEPLOY_SEC, BASE_INCOME, INCOME_PER_WEIGHT,
    ROLE_BUDGET_MUL, ROLE_INCOME_MUL, DEPLOY_ZONE, BOT_MIX,
    TRAITS, GEN_FIRST, GEN_LAST,
    clamp, dist, lerp, mulberry, pick
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(g, api);
})(typeof window !== 'undefined' ? window : globalThis);
