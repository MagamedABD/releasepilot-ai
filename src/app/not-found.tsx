import Link from 'next/link';

export const metadata = { title: 'Не найдено — ReleasePilot AI' };

/**
 * Страница «не найдено».
 *
 * Своя, а не встроенная в Next: та отвечает по-английски в интерфейсе,
 * который целиком на русском.
 *
 * Формулировка выбрана осторожно. Сюда попадают два разных случая:
 * адреса не существует вовсе и адрес существует, но принадлежит чужой
 * организации — во втором RLS вернул пустоту, и страница вызвала
 * `notFound()`. Текст обязан читаться одинаково для обоих. Стоило бы
 * написать «нет доступа», и страница подтвердила бы постороннему, что
 * организация с таким адресом существует, — а это ровно то, что
 * скрывают политики базы.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 text-center">
      <p className="text-5xl font-semibold tracking-tight opacity-20">404</p>
      <h1 className="mt-4 text-lg font-medium">Страница не найдена</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm opacity-60">
        По этому адресу ничего нет. Возможно, ссылка устарела или в ней опечатка.
      </p>
      <div className="mt-8">
        <Link
          href="/"
          className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand dark:border-white/20 dark:hover:bg-white/10"
        >
          На главную
        </Link>
      </div>
    </div>
  );
}
