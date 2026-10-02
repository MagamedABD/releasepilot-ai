/**
 * Сверка чисел в ответе агента с теми, что ему давали (FR-25).
 *
 * Инвариант «агент не считает» держится промптом, а промпт — это просьба.
 * Эта проверка — единственное место, где её исполнение видно: числа из
 * ответа ищутся среди значений, пришедших из инструментов, и ненайденное
 * пишется в лог.
 *
 * Проверка эвристическая, и честно сказать, где её границы.
 *
 * Проверяются только числа, похожие на метрику: проценты и числа с
 * дробной частью. Целые без знака процента не проверяются вовсе — в
 * ответе это даты, количества задач и ссылки на пункты, и попытка
 * сверять их дала бы поток ложных срабатываний, из-за которого лог
 * перестали бы читать. То есть проверка пропустит выдуманное «три
 * задачи» и поймает выдуманные «38%» и «27.75». Второе опаснее: именно
 * доли и скоры выглядят посчитанными.
 *
 * Расхождение не прерывает ответ и не показывается пользователю. Ответ
 * уже отдан стримом, а главное — поймать систематическую ошибку (сменили
 * формат результата, и модель начала округлять) важнее, чем выиграть
 * отдельный случай.
 */

/** Числа из результата инструмента — во всех видах, в каких их напишут. */
export function collectNumbers(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    add(into, value);
    /*
      Доли добавляются ещё и процентами. Движок отдаёт вероятность как
      0.38, а в ответе она обязана выглядеть как «38%» — без этого
      правильный ответ считался бы выдуманным.
    */
    if (value > 0 && value <= 1) add(into, value * 100);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, into);
    return into;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, into);
    return into;
  }
  return into;
}

function add(into: Set<string>, value: number): void {
  // Округления добавляются вместе с точным значением: «27.75» менеджеру
  // пишут как «27.8» и как «28», и оба варианта правдивы.
  for (const digits of [2, 1, 0]) {
    into.add(normalize(value.toFixed(digits)));
  }
}

/** «27.80» → «27.8», «28.0» → «28», «0,5» → «0.5». */
function normalize(text: string): string {
  const dotted = text.replace(',', '.');
  if (!dotted.includes('.')) return dotted;
  return dotted.replace(/0+$/, '').replace(/\.$/, '');
}

/** Числа похожие на метрику: процент или дробь. */
const CANDIDATE = /(\d+(?:[.,]\d+)?)\s*%|(\d+[.,]\d+)/g;

export function unsupportedNumbers(text: string, known: Set<string>): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const raw = match[1] ?? match[2];
    const value = normalize(raw);
    if (known.has(value)) continue;
    // Процент пишут и долей: «загрузка 1.35» и «загрузка 135%» — одно
    // и то же число, пришедшее из одного поля.
    const asShare = normalize((Number(value) / 100).toFixed(4));
    if (known.has(asShare)) continue;
    found.push(match[0].trim());
  }
  return found;
}

export type VerificationResult = {
  /** Числа ответа, которых не было ни в одном результате инструмента. */
  unsupported: string[];
  checked: number;
};

export function verifyAnswer(text: string, toolResults: unknown[]): VerificationResult {
  const known = new Set<string>();
  for (const result of toolResults) collectNumbers(result, known);
  const unsupported = unsupportedNumbers(text, known);
  return { unsupported, checked: known.size };
}
