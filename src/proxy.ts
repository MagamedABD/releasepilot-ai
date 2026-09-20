/**
 * Обновление сессии на каждом запросе.
 *
 * Токен доступа Supabase живёт около часа. Серверные компоненты писать
 * cookie не могут, поэтому продлевать сессию больше негде: без этого
 * пользователя выбрасывало бы на логин посреди работы, причём тем
 * вероятнее, чем дольше он сидит на одной странице.
 *
 * Здесь же — единственная точка, где проверяется, пускать ли вообще.
 * Разграничение по ролям и организациям остаётся в политиках RLS: proxy
 * отвечает на вопрос «вошёл ли пользователь», база — «что ему можно».
 *
 * Файл называется proxy.ts, а не middleware.ts: в Next.js 16 прежнее
 * соглашение объявлено устаревшим, хотя пока и продолжает работать.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Страницы, доступные без входа. */
const PUBLIC_PATHS = ['/login', '/register', '/auth', '/demo'];

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Между createServerClient и getUser не должно быть никакого кода:
  // любая вставка здесь создаёт окно, в котором сессия уже прочитана,
  // но ещё не продлена, и отладка таких выходов из системы мучительна.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Куда человек шёл — вернём его туда после входа, а не на главную
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/register')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Всё, кроме статики и картинок. Гонять middleware на каждый файл
     * шрифта незачем: это лишний вызов к Supabase на каждый такой запрос.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
