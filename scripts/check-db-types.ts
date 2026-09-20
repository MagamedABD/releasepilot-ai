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

function loadEnv(): Record<string, string> {
  const text = readFileSync(resolve(import.meta.dirname, '..', '.env.local'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
}

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

type Spec = {
  definitions: Record<string, { properties?: Record<string, unknown> }>;
};

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('В .env.local нет NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Схема недоступна: HTTP ${res.status}`);
  const spec = (await res.json()) as Spec;

  const live = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries(spec.definitions ?? {})) {
    if (!def.properties) continue;
    live.set(name, new Set(Object.keys(def.properties)));
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

  const tableCount = declared.size;
  const columnCount = [...declared.values()].reduce((s, c) => s + c.size, 0);

  if (problems.length > 0) {
    console.error(`Расхождений: ${problems.length}`);
    for (const p of problems) console.error('  ✗ ' + p);
    process.exit(1);
  }

  console.log(`Схема и типы совпадают: ${tableCount} таблиц, ${columnCount} колонок.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
