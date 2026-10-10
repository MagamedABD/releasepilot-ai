import { oauthLogin } from './actions';
import { env } from '@/lib/env';

const LABEL = { google: 'Google', github: 'GitHub' } as const;

/**
 * Кнопки входа через провайдеров (FR-01).
 *
 * Серверный компонент с обычной формой: вход начинается переходом на
 * страницу провайдера, клиентского кода для этого не нужно. Если ни один
 * провайдер не включён, блока нет вовсе — вместе с разделителем «или».
 */
export function OAuthButtons({ next = '/' }: { next?: string }) {
  const providers = env.NEXT_PUBLIC_OAUTH_PROVIDERS;
  if (providers.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 text-xs opacity-50">
        <span className="h-px flex-1 bg-current opacity-30" />
        или
        <span className="h-px flex-1 bg-current opacity-30" />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {providers.map((p) => (
          <form key={p} action={oauthLogin}>
            <input type="hidden" name="provider" value={p} />
            <input type="hidden" name="next" value={next} />
            <button
              type="submit"
              className="w-full rounded-lg border border-black/15 px-4 py-2.5 text-sm font-medium transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-white/20 dark:hover:bg-white/10"
            >
              Войти через {LABEL[p]}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
