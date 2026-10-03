/**
 * Проверка запроса на импорт из трекера (FR-40).
 */

import { z } from 'zod';

export const trackerImportSchema = z.object({
  projectId: z.string().uuid('Ожидается идентификатор проекта'),
  /** Очередь трекера: PPT, PAYWORLD. */
  queue: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9]{1,19}$/, 'Ключ очереди — заглавные латинские буквы и цифры'),
  /** Релиз, в который идут задачи. По имени: в трекере идентификаторов наших релизов нет. */
  releaseName: z.string().trim().min(1).max(120).nullable().default(null),
  /**
   * Анонимизация (FR-42). По умолчанию включена, и отключить её можно
   * только явно: утёкшее название задачи обратно не спрячешь, а
   * псевдонимизированное можно переимпортировать.
   */
  anonymize: z.boolean().default(true),
  /** Ключ очереди → имя команды организации. */
  teamByQueue: z.record(z.string(), z.string()).optional(),
  /**
   * Сколько задач брать. Потолок — про то, что запрос обязан закончиться:
   * связи читаются по одной задаче за запрос, это ограничение API.
   */
  limit: z.number().int().min(1).max(200).default(100),
  /** Пробный прогон: разобрать и отчитаться, ничего не записав. */
  dryRun: z.boolean().default(false),
});

export type TrackerImportInput = z.infer<typeof trackerImportSchema>;
