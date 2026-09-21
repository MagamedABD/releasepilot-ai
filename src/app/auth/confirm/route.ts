/**
 * Посадочная страница ссылки из письма.
 *
 * Supabase умеет присылать ссылку в двух видах, и какой именно — зависит
 * от шаблона письма в настройках проекта. Поддерживаем оба, чтобы
 * регистрация не ломалась от правки шаблона:
 *
 *   • token_hash + type — одноразовый код подтверждения, меняем на сессию
 *     вызовом verifyOtp;
 *   • code — код потока PKCE, меняем вызовом exchangeCodeForSession.
 *
 * Обработчик маршрута, а не страница: здесь нечего показывать, задача —
 * выставить cookie сессии и увести человека дальше. Cookie ставит
 * createClient, поэтому вся работа обязана происходить на сервере.
 */

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

/** Разрешённые значения type — чтобы не передавать в Supabase что попало. */
const OTP_TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const code = searchParams.get('code');

  const supabase = await createClient();

  if (tokenHash && type && OTP_TYPES.includes(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${origin}/onboarding`);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/onboarding`);
  }

  // Ссылка просрочена, уже использована или подделана. Разницу
  // пользователю знать незачем, а нам незачем её подтверждать.
  return NextResponse.redirect(`${origin}/login?error=link`);
}
