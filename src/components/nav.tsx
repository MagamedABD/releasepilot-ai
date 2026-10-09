'use client';

/**
 * Навигация по приложению: верхнее меню, вкладки релиза и поиск.
 *
 * Раньше у каждого экрана была своя ссылка «← назад», и попасть, скажем,
 * из аналитики в ассистента можно было только через список и кокпит —
 * три перехода ради одного. Меню видно на любом экране, а поиск (⌘K)
 * открывает любой экран любого релиза за одно действие.
 *
 * Клиентский компонент из-за двух вещей: подсветки текущего раздела
 * (`usePathname`) и палитры поиска с клавиатурой. Данные — список
 * релизов — приходят из серверного макета готовыми.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { logout } from '@/app/(auth)/actions';
import { RELEASE_STATUS } from '@/lib/ui/risk';

export type NavRelease = {
  id: string;
  name: string;
  status: string;
  projectKey: string;
};

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600';

/** Релиз, внутри которого сейчас человек, — из адреса, а не из состояния. */
function currentReleaseId(pathname: string): string | null {
  return /\/release\/([^/]+)/.exec(pathname)?.[1] ?? null;
}

export function AppNav({
  slug,
  orgName,
  releases,
}: {
  slug: string;
  orgName: string;
  releases: NavRelease[];
}) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const base = `/org/${slug}`;
  const releaseId = currentReleaseId(pathname);

  // Внутри релиза кнопка ведёт в ассистента этого релиза, снаружи — в
  // самый горящий (решает сервер, см. app/org/[slug]/assistant).
  const assistantHref = releaseId ? `${base}/release/${releaseId}/assistant` : `${base}/assistant`;
  const inAssistant = pathname.endsWith('/assistant');

  const sections = [
    { href: base, label: 'Релизы', active: pathname === base || releaseId !== null },
    { href: `${base}/tasks`, label: 'Задачи', active: pathname.startsWith(`${base}/tasks`) },
    { href: `${base}/analytics`, label: 'Аналитика', active: pathname.startsWith(`${base}/analytics`) },
    { href: `${base}/settings`, label: 'Настройки', active: pathname.startsWith(`${base}/settings`) },
  ];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-black/10 bg-background/90 backdrop-blur dark:border-white/15">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 md:flex-nowrap md:gap-4">
          <Link href={base} className={`flex min-w-0 shrink items-center gap-2 rounded-md ${FOCUS}`}>
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-foreground text-xs font-bold text-background"
            >
              RP
            </span>
            <span className="hidden max-w-56 min-w-0 truncate text-sm font-semibold lg:block">{orgName}</span>
          </Link>

          {/*
            На телефоне разделы уходят второй строкой с прокруткой: четыре
            раздела, поиск, ассистент и выход в одну строку шириной 360px не
            помещаются, а прятать разделы в «бургер» значит добавить клик к
            каждому переходу.
          */}
          <nav
            aria-label="Разделы"
            className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0"
          >
            {sections.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                aria-current={s.active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition ${FOCUS} ${
                  s.active
                    ? 'bg-black/[0.07] font-medium dark:bg-white/[0.12]'
                    : 'opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10'
                }`}
              >
                {s.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className={`flex items-center gap-2 rounded-lg border border-black/15 px-2.5 py-1.5 text-sm opacity-80 transition hover:bg-black/5 hover:opacity-100 dark:border-white/20 dark:hover:bg-white/10 ${FOCUS}`}
            >
              <SearchIcon />
              <span className="hidden md:inline">Поиск</span>
              <kbd className="hidden rounded border border-black/15 px-1 font-mono text-[11px] opacity-60 md:inline dark:border-white/20">
                ⌘K
              </kbd>
              <span className="sr-only md:hidden">Поиск</span>
            </button>

            <Link
              href={assistantHref}
              aria-current={inAssistant ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 ${FOCUS}`}
            >
              <SparkIcon />
              <span className="hidden sm:inline">AI-ассистент</span>
              <span className="sm:hidden">AI</span>
            </Link>

            <form action={logout}>
              <button
                type="submit"
                title="Выйти"
                className={`whitespace-nowrap rounded-lg px-2 py-1.5 text-sm opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10 ${FOCUS}`}
              >
                <span className="hidden sm:inline">Выйти</span>
                <LogoutIcon className="sm:hidden" />
              </button>
            </form>
          </div>
        </div>
      </header>

      {searchOpen ? (
        <SearchPalette
          slug={slug}
          releases={releases}
          currentReleaseId={releaseId}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </>
  );
}

// ── Поиск ───────────────────────────────────────────────────────────────────

type Item = { href: string; title: string; hint: string; keywords: string };

function buildItems(slug: string, releases: NavRelease[], currentId: string | null): Item[] {
  const base = `/org/${slug}`;
  const screens: Item[] = [
    { href: base, title: 'Все релизы', hint: 'Раздел', keywords: 'релизы список главная' },
    { href: `${base}/tasks`, title: 'Задачи', hint: 'Раздел', keywords: 'задачи фильтр' },
    { href: `${base}/analytics`, title: 'Аналитика', hint: 'Раздел', keywords: 'аналитика история в срок' },
    { href: `${base}/tasks?blocked=true`, title: 'Заблокированные задачи', hint: 'Задачи', keywords: 'блокеры блок' },
    { href: `${base}/settings`, title: 'Команды и ёмкость', hint: 'Настройки', keywords: 'настройки команды ёмкость емкость состав' },
    { href: `${base}/settings?tab=absences`, title: 'Отсутствия', hint: 'Настройки', keywords: 'настройки отпуск больничный отсутствия' },
    { href: `${base}/settings?tab=import`, title: 'Импорт задач из файла', hint: 'Настройки', keywords: 'настройки импорт csv json файл загрузить' },
    { href: `${base}?release=new`, title: 'Новый релиз', hint: 'Действие', keywords: 'создать новый релиз добавить' },
    { href: `${base}/tasks?task=new`, title: 'Новая задача', hint: 'Действие', keywords: 'создать новая задача добавить' },
  ];

  // Текущий релиз — первым: из кокпита чаще всего ищут его же экраны.
  const ordered = currentId
    ? [...releases.filter((r) => r.id === currentId), ...releases.filter((r) => r.id !== currentId)]
    : releases;

  const perRelease = ordered.flatMap((r) => {
    const rb = `${base}/release/${r.id}`;
    const tag = `${r.projectKey} · ${RELEASE_STATUS[r.status] ?? r.status}`;
    const kw = `${r.name} ${r.projectKey}`;
    return [
      { href: rb, title: r.name, hint: `Кокпит · ${tag}`, keywords: `${kw} кокпит риск` },
      { href: `${rb}/assistant`, title: `${r.name} — AI-ассистент`, hint: tag, keywords: `${kw} ассистент ai агент ии` },
      { href: `${rb}/scenarios`, title: `${r.name} — сценарии`, hint: tag, keywords: `${kw} сценарии перенос what-if` },
      { href: `${base}/tasks?releaseId=${r.id}`, title: `${r.name} — задачи`, hint: tag, keywords: `${kw} задачи` },
    ];
  });

  return [...screens, ...perRelease];
}

function SearchPalette({
  slug,
  releases,
  currentReleaseId,
  onClose,
}: {
  slug: string;
  releases: NavRelease[];
  currentReleaseId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo(
    () => buildItems(slug, releases, currentReleaseId),
    [slug, releases, currentReleaseId],
  );

  // Каждое слово запроса должно найтись — «2.14 асс» находит ассистента
  // релиза 2.14, а не всё подряд с «асс» или «2.14».
  const items = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return all.slice(0, 12);
    return all.filter((it) => {
      const hay = `${it.title} ${it.hint} ${it.keywords}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [all, query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function go(item: Item | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Поиск по приложению"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-black/10 bg-background shadow-2xl dark:border-white/15">
        <div className="flex items-center gap-2 border-b border-black/10 px-4 dark:border-white/15">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Релиз, экран или «ассистент»…"
            aria-label="Что найти"
            className="w-full bg-transparent py-3.5 text-base outline-none placeholder:opacity-50"
          />
          <kbd className="rounded border border-black/15 px-1.5 font-mono text-[11px] opacity-50 dark:border-white/20">
            Esc
          </kbd>
        </div>

        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm opacity-60">Ничего не нашлось</p>
        ) : (
          <ul ref={listRef} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
            {items.map((it, i) => (
              <li
                key={it.href}
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(it)}
                className={`flex cursor-pointer items-baseline justify-between gap-4 rounded-lg px-3 py-2 ${
                  i === active ? 'bg-black/[0.07] dark:bg-white/[0.12]' : ''
                }`}
              >
                <span className="min-w-0 truncate text-sm">{it.title}</span>
                <span className="shrink-0 text-xs opacity-50">{it.hint}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-black/10 px-4 py-2 text-xs opacity-50 dark:border-white/15">
          ↑↓ — выбрать · Enter — открыть · ⌘K или / — открыть поиск с любой страницы
        </p>
      </div>
    </div>
  );
}

// ── Вкладки релиза ──────────────────────────────────────────────────────────

export function ReleaseNav({
  slug,
  releaseId,
  releaseName,
}: {
  slug: string;
  releaseId: string;
  releaseName: string;
}) {
  const pathname = usePathname();
  const base = `/org/${slug}/release/${releaseId}`;

  const tabs = [
    { href: base, label: 'Кокпит', active: pathname === base },
    { href: `/org/${slug}/tasks?releaseId=${releaseId}`, label: 'Задачи', active: false },
    { href: `${base}/scenarios`, label: 'Сценарии', active: pathname === `${base}/scenarios` },
    { href: `${base}/assistant`, label: 'AI-ассистент', active: pathname === `${base}/assistant` },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-5">
      <nav aria-label="Путь" className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link href={`/org/${slug}`} className={`shrink-0 rounded opacity-60 transition hover:opacity-100 ${FOCUS}`}>
          ← Релизы
        </Link>
        <span aria-hidden className="opacity-30">/</span>
        <span className="truncate font-medium">{releaseName}</span>
      </nav>

      <nav
        aria-label="Экраны релиза"
        className="-mx-4 mt-3 flex gap-1 overflow-x-auto border-b border-black/10 px-4 dark:border-white/15"
      >
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            aria-current={t.active ? 'page' : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition ${FOCUS} ${
              t.active
                ? 'border-foreground font-medium'
                : 'border-transparent opacity-60 hover:opacity-100'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

// ── Значки ──────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="9" r="6" />
      <path d="m14 14 4 4" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0" fill="currentColor">
      <path d="M10 1.5 11.9 8.1 18.5 10l-6.6 1.9L10 18.5l-1.9-6.6L1.5 10l6.6-1.9L10 1.5Z" />
    </svg>
  );
}

function LogoutIcon({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={`size-4 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M13 14l4-4-4-4M17 10H8" />
    </svg>
  );
}
