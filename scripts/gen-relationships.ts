/**
 * Достраивает блоки Relationships в src/lib/database.types.ts.
 *
 * Зачем они вообще нужны. GenericTable из postgrest-js требует поле
 * Relationships, и требует жёстко: таблица без него не подходит под
 * GenericSchema, схема целиком признаётся неподходящей, а типы всех
 * запросов схлопываются в never. Симптом при этом выглядит нелепо —
 * «Property 'id' does not exist on type 'never'» на совершенно обычном
 * select. Причина не в запросе, а в том, что клиент молча потерял схему.
 *
 * Вторая, содержательная причина: именно по этим связям разбираются
 * вложенные выборки. Без них .select('organizations(slug)') не с чем
 * сопоставить, и точка тоже станет never.
 *
 * Почему генератор, а не руки: связей около сорока, каждая — четыре
 * поля, и ошибка в любом из них не ломает сборку, а тихо портит вывод
 * типов в одном запросе. Машина переписывает это из миграций, где
 * связи и так объявлены, и остаётся единственный источник правды.
 *
 * Имена ограничений не придуманы: все внешние ключи в миграциях заданы
 * на уровне колонки без слова constraint, а в таком случае PostgreSQL
 * называет ограничение по схеме «таблица_колонка_fkey».
 *
 * Граница проверяемого: check-db-types.ts сверяет с живой базой сами
 * связи — какая колонка куда ссылается, — потому что PostgREST отдаёт
 * их в описании колонки. Имён ограничений он не отдаёт, поэтому они
 * проверяются только по форме. Если кто-то однажды задаст имя вручную,
 * сверка это заметит и потребует перепроверить связь глазами.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const TYPES = join(ROOT, 'src', 'lib', 'database.types.ts');

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

/** Собирает связи по всем миграциям: таблица → список связей. */
function readRelationships(): Map<string, Relationship[]> {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

  const result = new Map<string, Relationship[]>();

  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/g;
  for (const [, table, body] of sql.matchAll(tableRe)) {
    const rels: Relationship[] = [];

    for (const line of body.split('\n')) {
      const fk = line.match(
        /^\s*(\w+)\s+uuid\b(.*?)\breferences\s+(?:(\w+)\.)?(\w+)\s*\(\s*(\w+)\s*\)/i,
      );
      if (!fk) continue;

      const [, column, between, schema, target, targetColumn] = fk;

      // Ссылки в чужие схемы PostgREST наружу не отдаёт: auth.users
      // недоступна для выборки, и связь с ней в типах только мешала бы.
      if (schema && schema !== 'public') continue;

      rels.push({
        foreignKeyName: `${table}_${column}_fkey`,
        columns: [column],
        // Один-к-одному только там, где колонка-ссылка сама является
        // первичным ключом: тогда больше одной строки с этим значением
        // не бывает по определению.
        isOneToOne: /primary\s+key/i.test(between),
        referencedRelation: target,
        referencedColumns: [targetColumn],
      });
    }

    if (rels.length) result.set(table, rels);
  }

  return result;
}

/** Печатает связи в том же стиле, что и остальной файл. */
function render(rels: Relationship[]): string {
  const lines = rels.map(
    (r) =>
      `          { foreignKeyName: '${r.foreignKeyName}', columns: ['${r.columns[0]}'],` +
      ` isOneToOne: ${r.isOneToOne}, referencedRelation: '${r.referencedRelation}',` +
      ` referencedColumns: ['${r.referencedColumns[0]}'] },`,
  );
  return ['        Relationships: [', ...lines, '        ];'].join('\n');
}

function main() {
  const rels = readRelationships();

  // Прошлый результат убираем целиком, а не дополняем: скрипт должен
  // приводить файл к одному и тому же виду при любом числе запусков.
  const text = readFileSync(TYPES, 'utf8')
    .replace(/\n {8}Relationships: \[\n[\s\S]*?\n {8}\];/g, '')
    .replace(/\n {8}Relationships: \[\];/g, '');

  const lines = text.split('\n');
  const out: string[] = [];

  let current: string | null = null;
  let depth = 0;
  let patched = 0;

  for (const line of lines) {
    // Начало блока таблицы: ровно шесть пробелов отступа внутри Tables
    const open = line.match(/^ {6}(\w+): \{$/);
    if (open && depth === 0) {
      current = open[1];
      depth = 1;
      out.push(line);
      continue;
    }

    if (current) {
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      if (depth === 0) {
        const list = rels.get(current);
        if (list) {
          out.push(render(list));
          patched += 1;
        } else {
          out.push('        Relationships: [];');
        }
        current = null;
      }
    }

    out.push(line);
  }

  writeFileSync(TYPES, out.join('\n'), 'utf8');
  console.log(`Связи проставлены: ${patched} таблиц со ссылками из ${rels.size} найденных в миграциях.`);
}

main();
