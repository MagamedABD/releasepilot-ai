/**
 * Тексты писем: дайджест (FR-43) и оповещение о росте риска (FR-44).
 *
 * Чистые функции от уже посчитанного: письмо не обращается ни к базе, ни
 * к расчёту, и поэтому проверяется тестом без почтового сервиса. Числа в
 * нём — строки статуса для руководства (`lib/ui/status`), те же, что на
 * экране: письмо, в котором готовность отличается от кокпита на процент,
 * подрывает доверие к обоим.
 *
 * Письмо идёт и текстом, и HTML. Текст — не запасной вариант «для старых
 * клиентов»: его показывают превью в списке писем и уведомления на
 * телефоне, то есть это первое, что человек видит.
 */

import type { RiskLevel } from '@/domain/types';
import { RISK_LEVEL } from '@/lib/ui/risk';

export type Email = { subject: string; text: string; html: string };

export type DigestRelease = {
  name: string;
  level: RiskLevel;
  /** Строки статуса для руководства. */
  lines: string[];
  /** Ссылка на кокпит. */
  url: string;
};

/** Содержимое приходит из названий релизов и задач — в HTML оно экранируется. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COLOR: Record<RiskLevel, string> = {
  low: '#059669',
  medium: '#d97706',
  high: '#ea580c',
  critical: '#dc2626',
};

function releaseHtml(r: DigestRelease): string {
  const [head, ...rest] = r.lines;
  return [
    `<div style="margin:0 0 24px;padding:16px;border:1px solid #e5e5e5;border-left:4px solid ${COLOR[r.level]};border-radius:8px">`,
    `<p style="margin:0 0 8px;font-weight:600">${esc(head ?? r.name)}</p>`,
    ...rest.map((l) => `<p style="margin:0 0 6px;color:#404040">${esc(l)}</p>`),
    `<p style="margin:10px 0 0"><a href="${esc(r.url)}" style="color:#2563eb">Открыть кокпит</a></p>`,
    '</div>',
  ].join('');
}

function wrap(title: string, body: string, footer: string): string {
  return [
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#171717;max-width:640px">',
    `<h2 style="margin:0 0 16px;font-size:18px">${esc(title)}</h2>`,
    body,
    `<p style="margin:24px 0 0;font-size:12px;color:#737373">${esc(footer)}</p>`,
    '</div>',
  ].join('');
}

const FOOTER = 'ReleasePilot AI. Числа — из того же расчёта, что в кокпите.';

/**
 * Дайджест по открытым релизам организации.
 *
 * Порядок релизов задаёт вызывающий — тот же, что в списке релизов:
 * сверху то, что горит. Письмо читают сверху и часто только первый блок.
 */
export function digestEmail(orgName: string, releases: readonly DigestRelease[]): Email {
  const worst = releases[0];
  const subject = worst
    ? `Статус релизов «${orgName}»: ${releases.length}, самый рискованный — ${RISK_LEVEL[worst.level].label}`
    : `Статус релизов «${orgName}»: открытых релизов нет`;

  if (releases.length === 0) {
    const line = 'Открытых релизов нет — сообщать не о чем.';
    return { subject, text: line, html: wrap(`Статус релизов — ${orgName}`, `<p>${line}</p>`, FOOTER) };
  }

  return {
    subject,
    text: releases.map((r) => [...r.lines, r.url].join('\n')).join('\n\n'),
    html: wrap(`Статус релизов — ${orgName}`, releases.map(releaseHtml).join(''), FOOTER),
  };
}

/** Оповещение: уровень риска релиза вырос. */
export function riskAlertEmail(
  release: DigestRelease & { from: RiskLevel },
): Email {
  const change = `${RISK_LEVEL[release.from].label} → ${RISK_LEVEL[release.level].label}`;
  const subject = `Риск вырос: ${release.name} — ${change}`;
  const lead = `Уровень риска релиза «${release.name}» вырос: ${change}.`;
  return {
    subject,
    text: [lead, '', ...release.lines, release.url].join('\n'),
    html: wrap('Риск релиза вырос', `<p style="margin:0 0 16px">${esc(lead)}</p>${releaseHtml(release)}`, FOOTER),
  };
}
