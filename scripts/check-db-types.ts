/**
 * Сверка src/lib/database.types.ts с реальной схемой базы.
 *
 * Типы описаны вручную по миграциям, поэтому нужен механизм, который
 * ловит расхождение раньше, чем оно проявится ошибкой в рантайме.
 * PostgREST отдаёт OpenAPI-описание схемы по GET /rest/v1/ — берём состав
 * таблиц и колонок оттуда и сравниваем с тем, что объявлено в TypeScript.
 *
 * Запуск: npx tsx scripts/check-db-types.ts
 * Выход 1 при любом расхождении — годится для CI.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnv, adminHeaders } from './lib/env';

/**
 * Достаёт имена таблиц и колонок из блоков Row в database.types.ts.
 *
 * Границы блока определяются подсчётом фигурных скобок, а не регулярным
 * выражением: Row бывает и однострочным, и многострочным, и ленивый поиск
 * в таком тексте молча съезжает на соседнюю таблицу.
 */
function declaredTables(): Map<string, Set<string>> {
  const text = readFileSync(
    resolve(import.meta.dirname, '..', 'src', 'lib', 'database.types.ts'),
    'utf8',
  );

  const result = new Map<string, Set<string>>();
  const marker = 'Row: {';

  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
    // Имя таблицы — последнее объявление вида «name: {» перед этим Row
    const before = text.slice(0, at);
    const nameMatch = [...before.matchAll(/(\w+): \{/g)].pop();
    if (!nameMatch) continue;

    // Границы тела Row по балансу скобок
    let depth = 0;
    let end = -1;
    for (let i = at + marker.length - 1; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;

    const body = text.slice(at + marker.length, end);
    const columns = new Set<string>();
    for (const c of body.matchAll(/(?:^|[{;,])\s*(\w+)\s*:/g)) columns.add(c[1]);
    result.set(nameMatch[1], columns);
  }

  return result;
}

/**
 * Достаёт объявленные связи: таблица → набор строк «колонка→цель.колонка».
 *
 * Имена ограничений (foreignKeyName) здесь проверяются отдельно, по форме:
 * узнать настоящее имя из OpenAPI нельзя — PostgREST его не отдаёт. Но все
 * внешние ключи в миграциях объявлены на уровне колонки и без слова
 * constraint, а в этом случае PostgreSQL называет ограничение строго
 * «таблица_колонка_fkey». Отклонение от этой формы означает, что кто-то
 * задал имя вручную, и тогда связь надо перепроверять руками.
 */
type DeclaredLinks = {
  /** колонка → «таблица.колонка», куда она ссылается */
  links: Map<string, string>;
  /** имена ограничений, отклоняющиеся от стандартной формы */
  nameIssues: string[];
};

function declaredRelationships(): Map<string, DeclaredLinks> {
  const text = readFileSync(
    resolve(import.meta.dirname, '..', 'src', 'lib', 'database.types.ts'),
    'utf8',
  );

  const result = new Map<string, DeclaredLinks>();
  const marker = 'Relationships: [';

  for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
    // Отступ ровно в шесть пробелов — уровень имени таблицы внутри Tables.
    // Без этого условия у таблиц с многострочным Update именем таблицы
    // оказывалось бы слово «Update»: оно объявлено ближе.
    const nameMatch = [...text.slice(0, at).matchAll(/^ {6}(\w+): \{$/gm)].pop();
    if (!nameMatch) continue;

    const end = text.indexOf('];', at);
    if (end === -1) continue;

    const table = nameMatch[1];
    const links = new Map<string, string>();
    const nameIssues: string[] = [];

    const entryRe =
      /foreignKeyName: '([^']+)', columns: \['([^']+)'\][^}]*?referencedRelation: '([^']+)', referencedColumns: \['([^']+)'\]/g;
    for (const [, fkName, column, target, targetColumn] of text.slice(at, end).matchAll(entryRe)) {
      links.set(column, `${target}.${targetColumn}`);
      const expected = `${table}_${column}_fkey`;
      if (fkName !== expected) {
        nameIssues.push(`${table}: имя ключа ${fkName}, по форме ожидалось ${expected}`);
      }
    }

    result.set(table, { links, nameIssues });
  }

  return result;
}

type Spec = {
  definitions: Record<string, { properties?: Record<string, { description?: string }> }>;
};

async function main() {
  const env = loadEnv();

  const res = await fetch(`${env.url}/rest/v1/`, { headers: adminHeaders(env) });
  if (!res.ok) throw new Error(`Схема недоступна: HTTP ${res.status}`);
  const spec = (await res.json()) as Spec;

  const live = new Map<string, Set<string>>();
  const liveLinks = new Map<string, Map<string, string>>();

  for (const [name, def] of Object.entries(spec.definitions ?? {})) {
    if (!def.properties) continue;
    live.set(name, new Set(Object.keys(def.properties)));

    // Связи PostgREST кладёт в описание колонки отдельным тегом
    const links = new Map<string, string>();
    for (const [column, prop] of Object.entries(def.properties)) {
      const fk = /<fk table='([^']+)' column='([^']+)'\/>/.exec(prop.description ?? '');
      if (fk) links.set(column, `${fk[1]}.${fk[2]}`);
    }
    liveLinks.set(name, links);
  }

  const declared = declaredTables();
  const problems: string[] = [];

  for (const name of live.keys()) {
    if (!declared.has(name)) problems.push(`таблица ${name} есть в базе, но не описана в типах`);
  }
  for (const name of declared.keys()) {
    if (!live.has(name)) problems.push(`таблица ${name} описана в типах, но отсутствует в базе`);
  }

  for (const [name, liveCols] of live) {
    const ours = declared.get(name);
    if (!ours) continue;
    for (const c of liveCols) {
      if (!ours.has(c)) problems.push(`${name}.${c} — есть в базе, нет в типах`);
    }
    for (const c of ours) {
      if (!liveCols.has(c)) problems.push(`${name}.${c} — есть в типах, нет в базе`);
    }
  }

  // Связи. Их пропуск не ломает сборку, а тихо портит вывод типов
  // у вложенных выборок, поэтому проверяются в обе стороны.
  const declaredLinks = declaredRelationships();
  let linkCount = 0;

  for (const [table, ours] of declaredLinks) {
    problems.push(...ours.nameIssues);
    const theirs = liveLinks.get(table);
    if (!theirs) continue;

    for (const [column, target] of theirs) {
      linkCount += 1;
      const declaredTarget = ours.links.get(column);
      if (!declaredTarget) {
        problems.push(`${table}.${column} → ${target} — связь есть в базе, нет в типах`);
      } else if (declaredTarget !== target) {
        problems.push(`${table}.${column} — в базе ссылка на ${target}, в типах на ${declaredTarget}`);
      }
    }
    for (const [column, target] of ours.links) {
      if (!theirs.has(column)) {
        problems.push(`${table}.${column} → ${target} — связь есть в типах, нет в базе`);
      }
    }
  }

  const tableCount = declared.size;
  const columnCount = [...declared.values()].reduce((s, c) => s + c.size, 0);

  if (problems.length > 0) {
    console.error(`Расхождений: ${problems.length}`);
    for (const p of problems) console.error('  ✗ ' + p);
    process.exit(1);
  }

  console.log(
    `Схема и типы совпадают: ${tableCount} таблиц, ${columnCount} колонок, ${linkCount} связей.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
