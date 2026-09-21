/**
 * Проверка данных форм аутентификации.
 *
 * Схемы живут отдельно от компонентов и от серверных действий, потому что
 * нужны и там, и там. Проверка на клиенте — ради удобства: она мгновенна
 * и не гоняет запрос впустую. Проверка на сервере — ради безопасности:
 * форму можно обойти, отправив запрос напрямую, и всё, что пришло
 * из браузера, до проверки считается недостоверным.
 */

import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Укажите почту')
  .email('Похоже на опечатку в адресе');

/**
 * Восемь символов — осознанный минимум, а не «как у всех».
 * Требования вида «заглавная, цифра и спецсимвол» на практике приводят
 * к паролям вида Password1! и к записи их на бумажке; длина даёт больше.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Не короче восьми символов')
  .max(72, 'Не длиннее 72 символов');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Введите пароль'),
});

export const registerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Укажите имя')
    .max(120, 'Слишком длинное имя'),
  email: emailSchema,
  password: passwordSchema,
});

export const organizationSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название').max(120, 'Слишком длинное название'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Не короче двух символов')
    .max(40, 'Не длиннее 40 символов')
    .regex(/^[a-z0-9-]+$/, 'Только латиница, цифры и дефис'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type OrganizationInput = z.infer<typeof organizationSchema>;

/** Состояние формы, общее для всех серверных действий. */
export type FormState = {
  /** Общая ошибка, не привязанная к полю. */
  error?: string;
  /** Ошибки по полям: имя поля → сообщения. */
  fields?: Record<string, string[]>;
  /** Сообщение об успехе, когда перехода никуда не происходит. */
  notice?: string;
};

/** Приводит ошибки zod к формату состояния формы. */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
