'use server';

/**
 * Серверные действия входа и регистрации.
 *
 * Почему именно server actions, а не обращение к Supabase из браузера:
 * сессия хранится в cookie, а выставить cookie может только сервер.
 * Клиентский вход пришлось бы синхронизировать с сервером отдельным
 * запросом, и до этой синхронизации серверные компоненты считали бы
 * пользователя гостем.
 *
 * Сигнатура (prevState, formData) продиктована useActionState: React
 * сам передаёт предыдущее состояние первым аргументом.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { translateAuthError } from '@/lib/supabase/auth-errors';
import { loginSchema, registerSchema, toFieldErrors, type FormState } from '@/lib/validation/auth';

/**
 * Куда вернуть человека после входа.
 *
 * Значение приходит из адресной строки, то есть полностью подконтрольно
 * тому, кто прислал ссылку. Без проверки «?next=https://чужой-сайт»
 * превращает нашу форму входа в правдоподобный трамплин для фишинга:
 * адрес в письме ведёт на настоящий домен, а после ввода пароля
 * пользователь оказывается на подделке и не замечает подмены.
 *
 * Поэтому пропускаем только внутренние пути. Два слеша в начале —
 * это тоже внешний адрес («//example.com» браузер читает как ссылку
 * на example.com по текущему протоколу), и обычная проверка
 * startsWith('/') его пропустила бы.
 */
function safeNext(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}

/** Адрес приложения — для ссылки подтверждения в письме. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function login(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fields: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: translateAuthError(error) };
  }

  // redirect работает через исключение, поэтому вызывается за пределами
  // try/catch — иначе его перехватил бы обработчик ошибок и переход
  // молча не состоялся бы.
  redirect(safeNext(formData.get('next')));
}

export async function register(_prevState: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { fields: toFieldErrors(parsed.error) };
  }

  const { fullName, email, password } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Попадает в raw_user_meta_data, откуда триггер handle_new_user
      // забирает имя в profiles. Профиль создаёт база, а не приложение:
      // так он появится при любом способе регистрации.
      data: { full_name: fullName },
      emailRedirectTo: `${await origin()}/auth/confirm`,
    },
  });

  if (error) {
    return { error: translateAuthError(error, 'signup') };
  }

  // Если в проекте включено подтверждение почты, сессии не будет:
  // Supabase создаёт пользователя, но не пускает его внутрь. Молчать
  // об этом нельзя — человек нажал кнопку и ждёт, что что-то произойдёт.
  if (!data.session) {
    return {
      notice: `Мы отправили письмо на ${email}. Откройте ссылку из письма, чтобы завершить регистрацию.`,
    };
  }

  redirect('/onboarding');
}

/** Выход. Отдельным действием, потому что cookie чистит сервер. */
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
