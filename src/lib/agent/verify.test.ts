import { describe, expect, it } from 'vitest';

import { collectNumbers, unsupportedNumbers, verifyAnswer } from './verify';

describe('сбор чисел из результатов инструментов', () => {
  it('доли добавляются и процентами', () => {
    // Движок отдаёт вероятность как 0.38, а в ответе она обязана
    // выглядеть как «38%» — иначе правильный ответ считался бы выдуманным.
    const known = collectNumbers({ probability_on_time: 0.38 });
    expect(known.has('0.38')).toBe(true);
    expect(known.has('38')).toBe(true);
  });

  it('округления считаются своими', () => {
    const known = collectNumbers({ risk_score: 27.75 });
    expect(known.has('27.75')).toBe(true);
    expect(known.has('27.8')).toBe(true);
    expect(known.has('28')).toBe(true);
  });

  it('обходит вложенность и массивы', () => {
    const known = collectNumbers({ teams: [{ load: 1.35 }, { load: 0.8 }] });
    expect(known.has('1.35')).toBe(true);
    expect(known.has('0.8')).toBe(true);
    // Доля меньше единицы добавляется и процентом.
    expect(known.has('80')).toBe(true);
  });

  /*
    Загрузка 1.35 процентом в известные значения не добавляется, и это
    не упущение. Добавлять ко всякому числу его сотни значило бы
    пополнять список допустимых значений мусором — «84.24» принесло бы
    «8424». Обратное приведение делается при проверке текста: «135%»
    сверяется с 1.35, и ответ проходит.
  */
  it('загрузка больше единицы узнаётся при проверке, а не при сборе', () => {
    const known = collectNumbers({ load: 1.35 });
    expect(known.has('135')).toBe(false);
    expect(unsupportedNumbers('Загрузка QA 135%', known)).toEqual([]);
  });

  it('бесконечность не попадает в известные значения', () => {
    // Её и в ответе быть не может: наружу она уходит как null.
    expect(collectNumbers({ load: Infinity }).size).toBe(0);
  });
});

describe('поиск чисел, которых не давали', () => {
  const known = collectNumbers({ risk_score: 84.24, probability: 0.38, load: 1.35 });

  it('пропускает числа из результатов, в любом виде', () => {
    const text = 'Риск 84.24, вероятность 38%, загрузка QA 135%. Округлённо риск 84.';
    expect(unsupportedNumbers(text, known)).toEqual([]);
  });

  it('ловит выдуманный процент', () => {
    expect(unsupportedNumbers('Вероятность около 60%', known)).toEqual(['60%']);
  });

  it('ловит выдуманную дробь', () => {
    expect(unsupportedNumbers('Скор примерно 71.5', known)).toEqual(['71.5']);
  });

  /*
    Граница эвристики, названная прямо. Целые без процента не
    проверяются: в ответе это даты, количества задач и номера пунктов, и
    сверять их значило бы завалить лог ложными срабатываниями — после
    чего его перестали бы читать.
  */
  it('целые числа не проверяются — это осознанный пропуск', () => {
    expect(unsupportedNumbers('Осталось 7 задач к 24 сентября', known)).toEqual([]);
  });

  it('запятая как дробный разделитель понимается', () => {
    expect(unsupportedNumbers('Скор 84,24', known)).toEqual([]);
  });
});

describe('сверка ответа целиком', () => {
  it('ответ по числам из инструментов проходит', () => {
    const results = [
      { metrics: { riskScore: 84.24, readinessPct: 72.5 } },
      { forecast: { probabilityOnTime: 0.38 } },
    ];
    const check = verifyAnswer(
      'Риск 84.24 — high. Готовность 72.5%, вероятность выпуска в срок 38%.',
      results,
    );
    expect(check.unsupported).toEqual([]);
    expect(check.checked).toBeGreaterThan(0);
  });

  it('ответ без инструментов не проходит ни с одним числом-метрикой', () => {
    // Именно этот случай проверка и ищет: модель ответила, не спросив.
    const check = verifyAnswer('Риск около 70.5, успеем с вероятностью 80%', []);
    expect(check.unsupported).toEqual(['70.5', '80%']);
  });
});
