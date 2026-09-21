'use server';

/**
 * Создание первой организации.
 *
 * Вся работа — в функции базы create_organization: она заводит
 * организацию, делает автора владельцем и пишет запись в журнал одной
 * транзакцией. Делать то же тремя запросами из приложения нельзя:
 * упади процесс между первым и вторым, в базе останется организация
 * без единого участника — невидимая для всех, включая создателя,
 * и занявшая адрес.
 */

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { organizationSchema, toFieldErrors, type FormState } from '@/lib/validation/auth';

export async function createOrganization(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = organizationSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  });

  if (!parsed.success) {
    return { fields: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_organization', {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });

  if (error) {
    // Занятый адрес — это ошибка конкретного поля, а не формы целиком:
    // показывать её надо рядом с тем полем, которое надо исправить.
    if (error.code === '23505') {
      return { fields: { slug: ['Этот адрес уже занят, выберите другой'] } };
    }
    if (error.code === '23514') {
      return { error: 'Достигнут предел числа организаций на одного пользователя' };
    }
    if (error.code === '28000') {
      redirect('/login?next=/onboarding');
    }
    return { error: 'Не удалось создать организацию. Попробуйте ещё раз' };
  }

  // Организация есть — дальше кокпит. revalidate не нужен: переход
  // на другой маршрут и так отрисует его заново.
  redirect(`/org/${data.slug}`);
}
