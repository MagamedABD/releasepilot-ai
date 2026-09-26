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

export const RELEASES: ReleaseSpec[] = [
  RELEASE_REFUNDS,
  RELEASE_CHECKOUT,
  RELEASE_RECONCILIATION,
  RELEASE_ANTIFRAUD,
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
