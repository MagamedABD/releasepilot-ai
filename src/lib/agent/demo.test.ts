import { describe, expect, it } from 'vitest';

import { RISK_CONFIG } from '@/domain/config';
import { canonicalScenario } from '@/domain/fixtures';
import { forecastRelease } from '@/domain/forecast';
import { calculateRelease } from '@/domain/risk';
import { toApiForecast } from '@/lib/api/forecast';
import { toApiMetrics } from '@/lib/api/metrics';
import { SUGGESTED_QUESTIONS } from '@/lib/ui/agent';

import { classifyQuestion, composeAnswer, INTENT_TOOLS, type TaskNames } from './demo';
import { verifyAnswer } from './verify';

const names: TaskNames = new Map([
  ['t1', { key: 'PAY-302', title: 'Подтверждение возврата' }],
  ['t2', { key: 'PAY-310', title: 'Регресс платёжного ядра' }],
]);

/** Обзор, как его отдаёт инструмент: метрики с прогнозом, через слой API. */
function overview() {
  const snap = canonicalScenario();
  const forecast = forecastRelease(snap, RISK_CONFIG, { completedReleases: 6 });
  const metrics = calculateRelease(snap, RISK_CONFIG, {
    probabilityOnTime: forecast.probabilityOnTime,
  });
  return { metrics: toApiMetrics(metrics), forecast: toApiForecast(forecast) };
}

describe('разбор вопроса', () => {
  it('подсказки на экране попадают каждая в свой вид вопроса', () => {
    // Подсказки — первое, что нажмут на защите. Попади две из них в один
    // и тот же ответ, демо выглядело бы так, будто ассистент не слушает.
    const intents = SUGGESTED_QUESTIONS.map(classifyQuestion);
    expect(new Set(intents).size).toBe(SUGGESTED_QUESTIONS.length);
    expect(intents).toEqual(['overview', 'bottleneck', 'forecast', 'suggest']);
  });

  /*
    «Перенеси» — просьба изменить, «что перенести» — вопрос. Первое
    сохраняет сценарий, второе только считает. Перепутать — значит
    записать в базу предложение, о котором человек не просил.
  */
  it('просьба изменить отличается от вопроса, что изменить', () => {
    expect(classifyQuestion('Перенеси эти задачи в следующий релиз')).toBe('propose');
    expect(classifyQuestion('Что перенести, чтобы риск стал ниже?')).toBe('suggest');
    expect(classifyQuestion('Оформи предложение')).toBe('propose');
  });

  it('непонятный вопрос получает обзор, а не отказ', () => {
    expect(classifyQuestion('Расскажи что-нибудь')).toBe('overview');
  });

  it('у каждого вида вопроса есть инструменты', () => {
    for (const tools of Object.values(INTENT_TOOLS)) expect(tools.length).toBeGreaterThan(0);
  });
});

describe('ответ собирается из чисел инструментов', () => {
  /*
    Главное свойство демо-режима: своих чисел в ответе нет. Проверяется
    той же сверкой (FR-25), что и ответы живой модели, — и шаблон её
    проходит, иначе он учил бы на защите неправде.
  */
  it('обзор проходит сверку чисел', () => {
    const o = overview();
    const text = composeAnswer('overview', { get_release_overview: o }, names);
    expect(text).toContain(`скор ${o.metrics.riskScore}`);
    expect(verifyAnswer(text, [o]).unsupported).toEqual([]);
  });

  it('узкое место — команда с наибольшей загрузкой', () => {
    const result = {
      remaining_working_days: 4,
      teams: [
        { team_name: 'Бэкенд', remaining_h: 116, capacity_h: 42, load: 2.7619, has_capacity: true },
        { team_name: 'Тестирование', remaining_h: 72, capacity_h: 21, load: 3.4286, has_capacity: true },
        { team_name: 'Дизайн', remaining_h: 10, capacity_h: 0, load: null, has_capacity: false },
      ],
    };
    const text = composeAnswer('bottleneck', { get_team_load: result }, names);
    expect(text).toMatch(/^Узкое место — Тестирование: загрузка 343%/);
    // Команда без ёмкости названа отдельно, а не спрятана в список.
    expect(text).toContain('«Дизайн» 10 ч работ, а ёмкость не задана');
    expect(verifyAnswer(text, [result]).unsupported).toEqual([]);
  });

  it('подбор берёт итоговый скор из расчёта, а не складывает', () => {
    const o = overview();
    const suggest = {
      outcome: 'ok',
      task_ids: ['t2'],
      groups: [{ task: { id: 't2' }, with_task_ids: [], risk_score_after: 41.07 }],
      delta: { riskScore: -5.18, riskLevel: { from: 'high', to: 'medium' }, probabilityOnTime: null },
      pinned_by: [],
    };
    const text = composeAnswer('suggest', { get_release_overview: o, suggest_scenario: suggest }, names);
    expect(text).toContain('PAY-310 Регресс платёжного ядра');
    expect(text).toContain('→ 41.07');
    expect(verifyAnswer(text, [o, suggest]).unsupported).toEqual([]);
  });

  /*
    «Недостижимо» объясняется причиной. На демо-релизе уровень держит
    низкая вероятность выпуска — правило, на перенос не реагирующее, — и
    ответ обязан это сказать, а не предлагать убрать задачи.
  */
  it('недостижимая цель называет правило, а не список задач', () => {
    const o = overview();
    const suggest = {
      outcome: 'unreachable',
      task_ids: [],
      groups: [],
      delta: null,
      pinned_by: [{ code: 'LOW_PROBABILITY' }],
    };
    const text = composeAnswer('suggest', { get_release_overview: o, suggest_scenario: suggest }, names);
    expect(text).toContain('не опустить');
    expect(text).toContain('Вероятность выпуска в срок слишком низкая');
    expect(text).not.toContain('достаточно убрать');
  });

  it('пояснение про досрочные выпуски — только когда числа расходятся', () => {
    const base = { released: 6, on_time: 3, on_time_pct: 50 };
    const differ = composeAnswer(
      'history',
      { get_release_history: { ...base, avg_delay_days: 5, avg_deviation_days: 1.7 } },
      names,
    );
    const same = composeAnswer(
      'history',
      { get_release_history: { ...base, avg_delay_days: 5, avg_deviation_days: 5 } },
      names,
    );
    expect(differ).toContain('досрочные выпуски гасят опоздания');
    expect(same).not.toContain('досрочные');
  });
});
