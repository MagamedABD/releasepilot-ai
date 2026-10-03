'use client';

/**
 * Боковое меню организации.
 *
 * Шесть экранов были связаны только ссылками «← назад» и кнопками в
 * шапках, и чтобы из аналитики попасть в сценарии релиза, нужно было
 * пройти три страницы. Меню делает любой экран доступным за одно нажатие.
 *
 * Клиентский компонент — ради одного: подсветки текущего пункта. Состав
 * меню приходит с сервера (`layout.tsx`), где известны организация и её
 * релизы; здесь только адрес страницы, по которому видно, что открыто.
 *
 * На узком экране меню превращается в строку ссылок сверху: боковая
 * колонка в 240 пикселей на телефоне съела бы половину ширины.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { logout } from '@/app/(auth)/actions';

export type SidebarRelease = { id: string; name: string; status: string };

type Item = { href: string; label: string; exact?: boolean };

function isActive(pathname: string, item: Item): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function Sidebar({
  slug,
  orgName,
  releases,
}: {
  slug: string;
  orgName: string;
  /** Открытые релизы, самые срочные сверху. */
  releases: SidebarRelease[];
}) {
  const pathname = usePathname();
  const base = `/org/${slug}`;

  const main: Item[] = [
    { href: base, label: 'Релизы', exact: true },
    { href: `${base}/tasks`, label: 'Задачи' },
    { href: `${base}/analytics`, label: 'Аналитика' },
  ];

  // Релиз, открытый сейчас, — по адресу. Его разделы раскрываются в меню:
  // кокпит, сценарии и ассистент — три взгляда на один релиз, и переходят
  // между ними чаще всего.
  const currentId = /\/release\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null;
  const sections = (id: string): Item[] => [
    { href: `${base}/release/${id}`, label: 'Кокпит', exact: true },
    { href: `${base}/release/${id}/scenarios`, label: 'Сценарии' },
    { href: `${base}/release/${id}/assistant`, label: 'Ассистент' },
  ];

  return (
    <>
      {/* Широкий экран: колонка слева. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/10 bg-surface md:flex">
        <div className="px-5 pb-4 pt-6">
          <Link href={base} className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded bg-brand text-sm font-bold text-white"
            >
              R
            </span>
            ReleasePilot
          </Link>
          <p className="mt-2 truncate text-xs opacity-50" title={orgName}>
            {orgName}
          </p>
        </div>

        <nav aria-label="Разделы" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4">
          <ul className="flex flex-col gap-0.5">
            {main.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={isActive(pathname, item)} />
              </li>
            ))}
          </ul>

          {releases.length > 0 ? (
            <div>
              <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide opacity-40">
                Открытые релизы
              </p>
              <ul className="flex flex-col gap-0.5">
                {releases.map((r) => (
                  <li key={r.id}>
                    <NavLink
                      item={{ href: `${base}/release/${r.id}`, label: r.name }}
                      active={r.id === currentId}
                    />
                    {r.id === currentId ? (
                      <ul className="mb-1 ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-white/10 pl-2">
                        {sections(r.id).map((s) => (
                          <li key={s.href}>
                            <NavLink item={s} active={isActive(pathname, s)} small />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </nav>

        <form action={logout} className="border-t border-white/10 p-3">
          <button
            type="submit"
            className="w-full rounded-md px-3 py-2 text-left text-sm opacity-60 transition hover:bg-white/5 hover:opacity-100"
          >
            Выйти
          </button>
        </form>
      </aside>

      {/* Узкий экран: строка ссылок сверху, прокручивается вбок. */}
      <nav
        aria-label="Разделы"
        className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-white/10 bg-surface px-3 py-2 md:hidden"
      >
        {[...main, ...(currentId ? sections(currentId) : [])].map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} compact />
        ))}
      </nav>
    </>
  );
}

function NavLink({
  item,
  active,
  small = false,
  compact = false,
}: {
  item: Item;
  active: boolean;
  small?: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={[
        'block truncate rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        compact ? 'shrink-0 px-3 py-1.5 text-sm' : small ? 'px-3 py-1.5 text-sm' : 'px-3 py-2 text-sm',
        // Активный пункт — красная черта слева и белый текст, остальные —
        // приглушённые. Заливки нет: на тёмном фоне она тянет взгляд
        // сильнее, чем содержимое страницы.
        active
          ? 'bg-white/10 font-medium text-white shadow-[inset_3px_0_0_var(--color-brand)]'
          : 'opacity-70 hover:bg-white/5 hover:opacity-100',
      ].join(' ')}
      title={item.label}
    >
      {item.label}
    </Link>
  );
}
