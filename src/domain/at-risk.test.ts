import { describe, expect, it } from 'vitest';

import { tasksAtRisk } from './at-risk';
import { blocks, canonicalScenario, snapshot, task } from './fixtures';
import { calculateRelease } from './risk';

function atRisk(snap = canonicalScenario(), limit?: number) {
  return tasksAtRisk(snap, calculateRelease(snap), limit);
}

describe('tasksAtRisk', () => {
  it('заблокированные P0 — наверху списка', () => {
    const top = atRisk().slice(0, 2).map((t) => t.taskId);
    expect(top.sort()).toEqual(['blocked-p0-a', 'blocked-p0-b']);
  });

  it('у каждой задачи названа причина попадания', () => {
    for (const t of atRisk()) {
      expect(t.reasons.length).toBeGreaterThan(0);
    }
    const blocked = atRisk().find((t) => t.taskId === 'blocked-p0-a')!;
    expect(blocked.reasons.map((r) => r.code)).toContain('BLOCKED');
  });

  it('задача, которую ждут другие, попадает в список с их числом', () => {
    const hub = atRisk().find((t) => t.taskId === 'be-hub');
    const reason = hub?.reasons.find((r) => r.code === 'BLOCKS_OTHERS');
    expect(reason?.facts.count).toBe(3);
  });

  it('завершённые задачи в список не попадают', () => {
    expect(atRisk().some((t) => t.taskId.startsWith('done-'))).toBe(false);
  });

  it('одна лишь перегруженная команда задачу не выделяет', () => {
    // Иначе в список попали бы все задачи команды сразу.
    for (const t of atRisk(canonicalScenario(), 100)) {
      const codes = t.reasons.map((r) => r.code);
      expect(codes).not.toEqual(['TEAM_OVERLOADED']);
    }
  });

  it('перерасход оценки — причина', () => {
    const snap = snapshot({
      tasks: [task({ id: 'over', estimateH: 8, spentH: 20 }), task({ id: 'fine', estimateH: 8, spentH: 4 })],
      dependencies: [],
    });
    const list = atRisk(snap);
    expect(list.map((t) => t.taskId)).toEqual(['over']);
    expect(list[0].reasons.map((r) => r.code)).toContain('OVERSPENT');
  });

  it('связь с закрытой задачей не считается ожиданием', () => {
    const snap = snapshot({
      tasks: [task({ id: 'a' }), task({ id: 'b', status: 'done' })],
      dependencies: [blocks('a', 'b')],
    });
    expect(atRisk(snap)).toEqual([]);
  });

  it('список ограничен и упорядочен по убыванию', () => {
    const list = atRisk(canonicalScenario(), 3);
    expect(list).toHaveLength(3);
    expect(list[0].score).toBeGreaterThanOrEqual(list[2].score);
  });

  it('пустой релиз — пустой список', () => {
    expect(atRisk(snapshot({ tasks: [], dependencies: [] }))).toEqual([]);
  });
});
