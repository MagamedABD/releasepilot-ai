/**
 * Параметры выборки аналитики.
 *
 * Организация обязательна — объяснение в самом маршруте: история
 * поставки, посчитанная по двум организациям сразу, не описывает ни одну.
 */

import { z } from 'zod';

export const analyticsQuerySchema = z.object({
  orgId: z.string().uuid('Ожидается идентификатор организации'),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
