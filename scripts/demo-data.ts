/**
 * Сценарий демонстрационных данных.
 *
 * Синтетика, но не случайная. Демо должно показывать движок риска в
 * работе, а для этого в данных обязаны присутствовать те самые явления,
 * которые движок умеет замечать: перегруженная команда, залежавшийся
 * блокер, дрейф скоупа, критическая цепочка. Случайный генератор дал бы
 * правдоподобную серость, в которой ни один фактор не сработал бы
 * заметно, и демонстрация выродилась бы в «смотрите, всё зелёное».
 *
 * Поэтому сценарий написан руками и детерминирован: одни и те же данные
 * при каждом запуске. Скриншоты в README не разъезжаются между прогонами,
 * а расхождение расчёта с ожидаемым означает изменение в движке, а не
 * невезение с числами.
 *
 * Даты заданы смещением в днях от дня загрузки, а не календарём. Демо,
 * засеянное абсолютными датами, через месяц показывает просроченные
 * релизы и «критический риск» там, где его нет.
 *
 * Предметная область — платежи, но все названия вымышлены. Ни один
 * контрагент, продукт или внутренний проект не назван.
 */

export type TeamKey = 'fe' | 'be' | 'qa' | 'an';

export const TEAMS: { key: TeamKey; name: string; kind: string; weeklyHours: number }[] = [
  { key: 'fe', name: 'Фронтенд', kind: 'frontend', weeklyHours: 120 },
  { key: 'be', name: 'Бэкенд', kind: 'backend', weeklyHours: 160 },
  { key: 'qa', name: 'Тестирование', kind: 'qa', weeklyHours: 80 },
  { key: 'an', name: 'Аналитика', kind: 'analytics', weeklyHours: 40 },
];

/** Участники. Владелец демо-организации заводится отдельно, при загрузке. */
export const PEOPLE: {
  key: string;
  name: string;
  team: TeamKey;
  role: 'admin' | 'manager' | 'lead' | 'viewer';
  allocation?: number;
}[] = [
  { key: 'sokolova', name: 'Марина Соколова', team: 'fe', role: 'lead' },
  { key: 'kuznetsov', name: 'Артём Кузнецов', team: 'fe', role: 'viewer' },
  { key: 'orlov', name: 'Дмитрий Орлов', team: 'be', role: 'lead' },
  { key: 'volkova', name: 'Елена Волкова', team: 'be', role: 'viewer' },
  { key: 'gushchin', name: 'Павел Гущин', team: 'be', role: 'viewer', allocation: 60 },
  { key: 'lebedeva', name: 'Ирина Лебедева', team: 'qa', role: 'lead' },
  { key: 'titov', name: 'Сергей Титов', team: 'qa', role: 'viewer' },
  { key: 'belova', name: 'Ольга Белова', team: 'an', role: 'manager' },
];

export const PROJECTS: { key: string; name: string }[] = [
  { key: 'PAY', name: 'Платёжное ядро' },
  { key: 'CHK', name: 'Чекаут' },
  { key: 'RPT', name: 'Отчётность и сверки' },
];

export type TaskSpec = {
  key: string;
  title: string;
  team: TeamKey;
  status: 'backlog' | 'in_progress' | 'review' | 'testing' | 'done' | 'cancelled';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  estimateH: number;
  spentH?: number;
  assignee?: string;
  /** Сколько дней назад задача заблокирована. Из этого движок выводит давность. */
  blockedDaysAgo?: number;
  /** Смещение от старта релиза, если задача добавлена уже после него. */
  addedAfterStartDays?: number;
};

export type ReleaseSpec = {
  key: string;
  project: string;
  name: string;
  status: 'planned' | 'active' | 'released' | 'postponed' | 'cancelled';
  /** Смещение планового дня релиза от сегодня. */
  plannedIn: number;
  startedDaysAgo?: number;
  releasedDaysAgo?: number;
  tasks: TaskSpec[];
  /** Зависимости внутри релиза: [кто блокирует, кого блокирует]. */
  deps?: [string, string][];
};

/**
 * Релиз под срывом. Здесь собраны все шесть факторов разом — это
 * витрина движка и главный экран для скриншотов.
 *
 * Что заложено намеренно:
 *   • PAY-302 заблокирована неделю и держит четыре задачи — залежавшийся
 *     блокер плюс длинная критическая цепочка;
 *   • тестированию оставили work сверх недельной ёмкости — перегруз;
 *   • четыре задачи добавлены после старта — дрейф скоупа;
 *   • отпуск лида тестирования приходится ровно на дни перед релизом.
 */
const RELEASE_REFUNDS: ReleaseSpec = {
  key: 'PAY-2.14',
  project: 'PAY',
  name: '2.14 — Возвраты по быстрым платежам',
  status: 'active',
  plannedIn: 9,
  startedDaysAgo: 12,
  tasks: [
    { key: 'PAY-301', title: 'Инициация возврата по QR-коду', team: 'be', status: 'done', priority: 'P1', estimateH: 16, spentH: 18, assignee: 'orlov' },
    { key: 'PAY-302', title: 'Подтверждение возврата на стороне банка', team: 'be', status: 'in_progress', priority: 'P0', estimateH: 24, spentH: 12, assignee: 'orlov', blockedDaysAgo: 7 },
    { key: 'PAY-303', title: 'Частичный возврат суммы', team: 'be', status: 'backlog', priority: 'P1', estimateH: 20, assignee: 'volkova' },
    { key: 'PAY-304', title: 'Идемпотентность операций возврата', team: 'be', status: 'in_progress', priority: 'P0', estimateH: 12, spentH: 6, assignee: 'volkova' },
    { key: 'PAY-305', title: 'Выгрузка реестра возвратов', team: 'be', status: 'backlog', priority: 'P2', estimateH: 14, assignee: 'gushchin' },
    { key: 'PAY-306', title: 'Экран статуса возврата', team: 'fe', status: 'in_progress', priority: 'P1', estimateH: 10, spentH: 4, assignee: 'sokolova' },
    { key: 'PAY-307', title: 'Форма частичного возврата', team: 'fe', status: 'backlog', priority: 'P1', estimateH: 12, assignee: 'kuznetsov' },
    { key: 'PAY-308', title: 'Показ ошибок возврата пользователю', team: 'fe', status: 'backlog', priority: 'P2', estimateH: 6, assignee: 'kuznetsov' },
    { key: 'PAY-309', title: 'Тест-план по возвратам', team: 'qa', status: 'done', priority: 'P2', estimateH: 8, spentH: 8, assignee: 'lebedeva' },
    { key: 'PAY-310', title: 'Регресс платёжного ядра', team: 'qa', status: 'backlog', priority: 'P0', estimateH: 32, assignee: 'lebedeva' },
    { key: 'PAY-311', title: 'Автотесты сценариев возврата', team: 'qa', status: 'in_progress', priority: 'P1', estimateH: 24, spentH: 6, assignee: 'titov' },
    { key: 'PAY-312', title: 'Нагрузочное тестирование возвратов', team: 'qa', status: 'backlog', priority: 'P1', estimateH: 16, assignee: 'titov' },
    { key: 'PAY-313', title: 'Сверка возвратов с выпиской эквайера', team: 'an', status: 'backlog', priority: 'P2', estimateH: 10, assignee: 'belova' },
    { key: 'PAY-314', title: 'Мониторинг доли неуспешных возвратов', team: 'an', status: 'backlog', priority: 'P2', estimateH: 8, assignee: 'belova' },
    { key: 'PAY-315', title: 'Возврат по истёкшей карте', team: 'be', status: 'backlog', priority: 'P1', estimateH: 18, assignee: 'volkova', addedAfterStartDays: 5 },
    { key: 'PAY-316', title: 'Уведомление клиенту о возврате', team: 'be', status: 'backlog', priority: 'P2', estimateH: 12, assignee: 'gushchin', addedAfterStartDays: 6 },
    { key: 'PAY-317', title: 'История возвратов в личном кабинете', team: 'fe', status: 'backlog', priority: 'P2', estimateH: 14, assignee: 'sokolova', addedAfterStartDays: 7 },
    { key: 'PAY-318', title: 'Проверки антифрода на возвратах', team: 'be', status: 'backlog', priority: 'P1', estimateH: 16, assignee: 'orlov', addedAfterStartDays: 8 },
  ],
  deps: [
    ['PAY-301', 'PAY-302'],
    ['PAY-302', 'PAY-303'],
    ['PAY-302', 'PAY-304'],
    ['PAY-302', 'PAY-307'],
    ['PAY-302', 'PAY-311'],
    ['PAY-304', 'PAY-310'],
    ['PAY-311', 'PAY-312'],
  ],
};

/** Релиз в умеренном состоянии: работа идёт, один свежий блокер. */
const RELEASE_CHECKOUT: ReleaseSpec = {
  key: 'CHK-3.0',
  project: 'CHK',
  name: '3.0 — Новый чекаут',
  status: 'active',
  plannedIn: 25,
  startedDaysAgo: 5,
  tasks: [
    { key: 'CHK-201', title: 'Каркас страницы оплаты', team: 'fe', status: 'in_progress', priority: 'P1', estimateH: 24, spentH: 10, assignee: 'sokolova' },
    { key: 'CHK-202', title: 'Выбор способа оплаты', team: 'fe', status: 'in_progress', priority: 'P1', estimateH: 16, spentH: 6, assignee: 'kuznetsov' },
    { key: 'CHK-203', title: 'Сохранённые карты', team: 'fe', status: 'backlog', priority: 'P2', estimateH: 18, assignee: 'kuznetsov' },
    { key: 'CHK-204', title: 'Адаптация под мобильные экраны', team: 'fe', status: 'backlog', priority: 'P2', estimateH: 12, assignee: 'sokolova' },
    { key: 'CHK-205', title: 'API заказа и корзины', team: 'be', status: 'in_progress', priority: 'P1', estimateH: 20, spentH: 8, assignee: 'orlov' },
    { key: 'CHK-206', title: 'Токенизация карт', team: 'be', status: 'backlog', priority: 'P0', estimateH: 24, assignee: 'volkova' },
    { key: 'CHK-207', title: 'Редирект-сценарий 3-D Secure', team: 'be', status: 'in_progress', priority: 'P0', estimateH: 20, spentH: 4, assignee: 'gushchin', blockedDaysAgo: 2 },
    { key: 'CHK-208', title: 'Трассировка и логи оплаты', team: 'be', status: 'backlog', priority: 'P2', estimateH: 10, assignee: 'gushchin' },
    { key: 'CHK-209', title: 'Тест-план чекаута', team: 'qa', status: 'done', priority: 'P2', estimateH: 6, spentH: 6, assignee: 'lebedeva' },
    { key: 'CHK-210', title: 'Автотесты оплаты картой', team: 'qa', status: 'backlog', priority: 'P1', estimateH: 20, assignee: 'titov' },
    { key: 'CHK-211', title: 'Проверка доступности форм', team: 'qa', status: 'backlog', priority: 'P2', estimateH: 8, assignee: 'titov' },
    { key: 'CHK-212', title: 'Метрики воронки оплаты', team: 'an', status: 'backlog', priority: 'P2', estimateH: 10, assignee: 'belova' },
  ],
  deps: [
    ['CHK-205', 'CHK-201'],
    ['CHK-201', 'CHK-202'],
    ['CHK-206', 'CHK-207'],
    ['CHK-207', 'CHK-210'],
  ],
};

/** Релиз, который ещё не начинали. Нужен, чтобы показать спокойное состояние. */
const RELEASE_RECONCILIATION: ReleaseSpec = {
  key: 'RPT-1.7',
  project: 'RPT',
  name: '1.7 — Автоматическая сверка реестров',
  status: 'planned',
  plannedIn: 40,
  tasks: [
    { key: 'RPT-101', title: 'Схема хранения реестров', team: 'be', status: 'backlog', priority: 'P2', estimateH: 16, assignee: 'volkova' },
    { key: 'RPT-102', title: 'Разбор реестра эквайера', team: 'be', status: 'backlog', priority: 'P1', estimateH: 20, assignee: 'volkova' },
    { key: 'RPT-103', title: 'Алгоритм сопоставления операций', team: 'be', status: 'backlog', priority: 'P1', estimateH: 24, assignee: 'orlov' },
    { key: 'RPT-104', title: 'Отчёт о расхождениях', team: 'an', status: 'backlog', priority: 'P2', estimateH: 12, assignee: 'belova' },
    { key: 'RPT-105', title: 'Экран сверки', team: 'fe', status: 'backlog', priority: 'P2', estimateH: 18, assignee: 'kuznetsov' },
    { key: 'RPT-106', title: 'Выгрузка результатов в таблицу', team: 'fe', status: 'backlog', priority: 'P3', estimateH: 8, assignee: 'kuznetsov' },
    { key: 'RPT-107', title: 'Подготовка тестовых реестров', team: 'qa', status: 'backlog', priority: 'P2', estimateH: 10, assignee: 'titov' },
    { key: 'RPT-108', title: 'Автотесты сопоставления', team: 'qa', status: 'backlog', priority: 'P2', estimateH: 12, assignee: 'titov' },
  ],
  deps: [
    ['RPT-101', 'RPT-102'],
    ['RPT-102', 'RPT-103'],
    ['RPT-103', 'RPT-104'],
  ],
};

/** Выпущенный релиз. Без истории не на чем показывать тренды (FR-39). */
const RELEASE_ANTIFRAUD: ReleaseSpec = {
  key: 'PAY-2.13',
  project: 'PAY',
  name: '2.13 — Правила антифрода',
  status: 'released',
  plannedIn: -14,
  startedDaysAgo: 40,
  releasedDaysAgo: 13,
  tasks: [
    { key: 'PAY-201', title: 'Конструктор правил', team: 'be', status: 'done', priority: 'P1', estimateH: 32, spentH: 36, assignee: 'orlov' },
    { key: 'PAY-202', title: 'Версионирование наборов правил', team: 'be', status: 'done', priority: 'P2', estimateH: 16, spentH: 14, assignee: 'volkova' },
    { key: 'PAY-203', title: 'Проверка правил в режиме наблюдения', team: 'be', status: 'done', priority: 'P1', estimateH: 20, spentH: 22, assignee: 'gushchin' },
    { key: 'PAY-204', title: 'Экран управления правилами', team: 'fe', status: 'done', priority: 'P1', estimateH: 24, spentH: 26, assignee: 'sokolova' },
    { key: 'PAY-205', title: 'Журнал срабатываний', team: 'fe', status: 'done', priority: 'P2', estimateH: 14, spentH: 12, assignee: 'kuznetsov' },
    { key: 'PAY-206', title: 'Регресс антифрода', team: 'qa', status: 'done', priority: 'P0', estimateH: 24, spentH: 28, assignee: 'lebedeva' },
    { key: 'PAY-207', title: 'Автотесты правил', team: 'qa', status: 'done', priority: 'P1', estimateH: 18, spentH: 18, assignee: 'titov' },
    { key: 'PAY-208', title: 'Отчёт по ложным срабатываниям', team: 'an', status: 'done', priority: 'P2', estimateH: 12, spentH: 10, assignee: 'belova' },
    { key: 'PAY-209', title: 'Пороговые значения по сегментам', team: 'an', status: 'done', priority: 'P2', estimateH: 10, spentH: 11, assignee: 'belova' },
    { key: 'PAY-210', title: 'Документация для поддержки', team: 'be', status: 'done', priority: 'P3', estimateH: 8, spentH: 6, assignee: 'orlov' },
  ],
};

/*
  ── История поставки ──────────────────────────────────────────────────────

  Пять выпущенных релизов сверх антифрода добавлены не для объёма, и у них
  три отдельные причины.

  Первая — порог прогноза. Монте-Карло включается от пяти завершённых
  релизов (`minReleasesForMonteCarlo`, FR-22), иначе отдаётся
  детерминированный фолбэк. С одним выпущенным релизом в демо главная
  функция системы была бы не видна: вместо вероятности проверяющий получал
  бы предупреждение о недостатке истории. Данные подгоняются под порог
  осознанно — порог описывает рабочую систему, а демо обязано её показывать.

  Вторая — калибровка. `estimatePessimism` подлежит уточнению по истории
  (ADR-001 §6), и уточнять его не на чем, если в базе нет пар «оценка —
  факт». Здесь такие пары есть, и перерасход в них неодинаков: 1.05 у
  релиза, вышедшего в срок, и 1.45 у вышедшего на неделю позже. По всей
  истории выходит около 1.18 — то есть команда тратит в среднем на 18%
  больше оценки. Это делает двойку в конфиге тем, чем она и заявлена:
  пессимистичным краем, а не средним значением.

  Третья — тренды (FR-39). Из шести выпущенных релизов трое вышли позже
  плана, и это важнее красивой картинки: демо, где в срок выходит всё,
  доказывало бы, что система не нужна.

  Связь перерасхода со сроком в данных есть, но она не жёсткая, и это тоже
  сделано намеренно. Два худших перерасхода (1.45 и 1.35) дали по неделе
  опоздания, релиз с точными оценками вышел в срок — а вот 2.10 перерасходовал
  треть часов и всё равно вышел на два дня раньше плана.

  Последний случай в данных нужен. Он показывает то, на чём держится весь
  прогноз: срок срывает не перерасход сам по себе, а перерасход, которому не
  хватило запаса по времени. У 2.10 на тридцать плановых дней ушло двадцать
  восемь — лишние часы уместились в календарь. Убери такой пример, и данные
  подсказывали бы, что часы и даты — одно и то же; тогда непонятно, зачем
  прогнозу вообще знать ёмкость команд.
*/

/** Точные оценки, выход в срок. Опорная точка: так бывает. */
const RELEASE_LIMITS: ReleaseSpec = {
  key: 'PAY-2.12',
  project: 'PAY',
  name: '2.12 — Лимиты и блокировки',
  status: 'released',
  plannedIn: -70,
  startedDaysAgo: 100,
  releasedDaysAgo: 70,
  tasks: [
    { key: 'PAY-121', title: 'Суточные лимиты по клиенту', team: 'be', status: 'done', priority: 'P1', estimateH: 18, spentH: 20, assignee: 'orlov' },
    { key: 'PAY-122', title: 'Блокировка по подозрению', team: 'be', status: 'done', priority: 'P0', estimateH: 14, spentH: 14, assignee: 'volkova' },
    { key: 'PAY-123', title: 'Ручная разблокировка оператором', team: 'be', status: 'done', priority: 'P2', estimateH: 20, spentH: 22, assignee: 'gushchin' },
    { key: 'PAY-124', title: 'Экран лимитов', team: 'fe', status: 'done', priority: 'P2', estimateH: 10, spentH: 10, assignee: 'kuznetsov' },
    { key: 'PAY-125', title: 'Проверки лимитов в тестах', team: 'qa', status: 'done', priority: 'P1', estimateH: 16, spentH: 16, assignee: 'titov' },
    { key: 'PAY-126', title: 'Сводка по блокировкам', team: 'an', status: 'done', priority: 'P3', estimateH: 8, spentH: 8, assignee: 'belova' },
  ],
};

/** Худший перерасход истории — и неделя опоздания вслед за ним. */
const RELEASE_LINKS: ReleaseSpec = {
  key: 'PAY-2.11',
  project: 'PAY',
  name: '2.11 — Платёжные ссылки',
  status: 'released',
  plannedIn: -95,
  startedDaysAgo: 125,
  releasedDaysAgo: 88,
  tasks: [
    { key: 'PAY-111', title: 'Генерация платёжной ссылки', team: 'be', status: 'done', priority: 'P1', estimateH: 20, spentH: 30, assignee: 'orlov' },
    { key: 'PAY-112', title: 'Срок жизни и отзыв ссылки', team: 'be', status: 'done', priority: 'P1', estimateH: 16, spentH: 24, assignee: 'volkova' },
    { key: 'PAY-113', title: 'Страница оплаты по ссылке', team: 'fe', status: 'done', priority: 'P1', estimateH: 14, spentH: 20, assignee: 'sokolova' },
    { key: 'PAY-114', title: 'Настройки ссылки в кабинете', team: 'fe', status: 'done', priority: 'P2', estimateH: 18, spentH: 26, assignee: 'kuznetsov' },
    { key: 'PAY-115', title: 'Регресс оплаты по ссылке', team: 'qa', status: 'done', priority: 'P0', estimateH: 12, spentH: 16, assignee: 'lebedeva' },
    { key: 'PAY-116', title: 'Автотесты истечения срока', team: 'qa', status: 'done', priority: 'P1', estimateH: 10, spentH: 14, assignee: 'titov' },
    { key: 'PAY-117', title: 'Статистика переходов по ссылкам', team: 'an', status: 'done', priority: 'P2', estimateH: 8, spentH: 12, assignee: 'belova' },
  ],
};

/** Вышел на два дня раньше плана при заметном перерасходе часов. */
const RELEASE_RECURRING: ReleaseSpec = {
  key: 'PAY-2.10',
  project: 'PAY',
  name: '2.10 — Рекуррентные платежи',
  status: 'released',
  plannedIn: -120,
  startedDaysAgo: 150,
  releasedDaysAgo: 122,
  tasks: [
    { key: 'PAY-101', title: 'Подписки и расписание списаний', team: 'be', status: 'done', priority: 'P1', estimateH: 24, spentH: 32, assignee: 'orlov' },
    { key: 'PAY-102', title: 'Повторная попытка списания', team: 'be', status: 'done', priority: 'P0', estimateH: 16, spentH: 22, assignee: 'volkova' },
    { key: 'PAY-103', title: 'Отмена подписки клиентом', team: 'be', status: 'done', priority: 'P1', estimateH: 20, spentH: 26, assignee: 'gushchin' },
    { key: 'PAY-104', title: 'Экран управления подписками', team: 'fe', status: 'done', priority: 'P1', estimateH: 12, spentH: 16, assignee: 'sokolova' },
    { key: 'PAY-105', title: 'Сценарии списаний в тестах', team: 'qa', status: 'done', priority: 'P0', estimateH: 18, spentH: 22, assignee: 'lebedeva' },
    { key: 'PAY-106', title: 'Отчёт по неуспешным списаниям', team: 'an', status: 'done', priority: 'P2', estimateH: 10, spentH: 12, assignee: 'belova' },
    { key: 'PAY-107', title: 'Уведомления о списании', team: 'be', status: 'done', priority: 'P2', estimateH: 8, spentH: 10, assignee: 'orlov' },
  ],
};

/** Второй проект в истории: без него тренд выглядел бы свойством PAY. */
const RELEASE_ONE_CLICK: ReleaseSpec = {
  key: 'CHK-1.9',
  project: 'CHK',
  name: '1.9 — Оплата в один шаг',
  status: 'released',
  plannedIn: -50,
  startedDaysAgo: 80,
  releasedDaysAgo: 43,
  tasks: [
    { key: 'CHK-101', title: 'Оплата сохранённой картой без ввода кода', team: 'fe', status: 'done', priority: 'P1', estimateH: 22, spentH: 30, assignee: 'sokolova' },
    { key: 'CHK-102', title: 'Согласие на хранение карты', team: 'fe', status: 'done', priority: 'P1', estimateH: 18, spentH: 26, assignee: 'kuznetsov' },
    { key: 'CHK-103', title: 'Подтверждение платежа без редиректа', team: 'be', status: 'done', priority: 'P0', estimateH: 14, spentH: 18, assignee: 'gushchin' },
    { key: 'CHK-104', title: 'Откат на полную форму при отказе', team: 'be', status: 'done', priority: 'P1', estimateH: 16, spentH: 22, assignee: 'volkova' },
    { key: 'CHK-105', title: 'Регресс сценариев оплаты', team: 'qa', status: 'done', priority: 'P0', estimateH: 12, spentH: 16, assignee: 'lebedeva' },
    { key: 'CHK-106', title: 'Конверсия быстрой оплаты', team: 'an', status: 'done', priority: 'P2', estimateH: 10, spentH: 12, assignee: 'belova' },
  ],
};

/** Единственный релиз, уложившийся в оценку. Так тоже бывает, и это видно. */
const RELEASE_EXPORTS: ReleaseSpec = {
  key: 'RPT-1.6',
  project: 'RPT',
  name: '1.6 — Ежедневные выгрузки',
  status: 'released',
  plannedIn: -30,
  startedDaysAgo: 60,
  releasedDaysAgo: 33,
  tasks: [
    { key: 'RPT-091', title: 'Расписание выгрузок', team: 'be', status: 'done', priority: 'P2', estimateH: 16, spentH: 14, assignee: 'volkova' },
    { key: 'RPT-092', title: 'Формат файла выгрузки', team: 'be', status: 'done', priority: 'P2', estimateH: 12, spentH: 12, assignee: 'orlov' },
    { key: 'RPT-093', title: 'Доставка в хранилище', team: 'be', status: 'done', priority: 'P1', estimateH: 14, spentH: 13, assignee: 'gushchin' },
    { key: 'RPT-094', title: 'Экран истории выгрузок', team: 'fe', status: 'done', priority: 'P3', estimateH: 10, spentH: 10, assignee: 'kuznetsov' },
    { key: 'RPT-095', title: 'Проверка полноты выгрузки', team: 'qa', status: 'done', priority: 'P2', estimateH: 8, spentH: 8, assignee: 'titov' },
  ],
};

export const RELEASES: ReleaseSpec[] = [
  RELEASE_REFUNDS,
  RELEASE_CHECKOUT,
  RELEASE_RECONCILIATION,
  RELEASE_ANTIFRAUD,
  RELEASE_EXPORTS,
  RELEASE_ONE_CLICK,
  RELEASE_LIMITS,
  RELEASE_LINKS,
  RELEASE_RECURRING,
];

/**
 * Отсутствия. Отпуск лида тестирования намеренно попадает на дни перед
 * релизом возвратов: это делает перегруз тестирования не абстрактным
 * числом, а объяснимым фактом (US-08).
 */
export const ABSENCES: { person: string; fromIn: number; toIn: number; reason: string }[] = [
  { person: 'lebedeva', fromIn: 3, toIn: 10, reason: 'Отпуск' },
  { person: 'gushchin', fromIn: -2, toIn: 2, reason: 'Больничный' },
];

/** Окно, на которое раскладывается ёмкость команд: от -3 до +7 недель. */
export const CAPACITY_WEEKS = { from: -3, to: 7 };
