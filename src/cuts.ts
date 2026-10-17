// Нарезки одного журнала дубля (film/cuts.yml): кому ролик, из каких клипов, сколько секунд и что
// говорит голос. Ролик - представление журнала: перевыпуск - пересборка из него; новый дубль нужен,
// только когда изменились сценарий или фабрика. Чистые функции, проверяются тестами.
import { createHash } from 'node:crypto';

export interface CutPart {
  clip: string; // клип журнала без .webm: шаг-номер-участник или шаг-chat
  seconds: number; // сколько показывать; голос длиннее - последний кадр держится
  from?: number; // с какой секунды клипа; по умолчанию карточка главы пропускается
  say?: string; // голос и субтитры
}
export interface Cut {
  title: string;
  audience: string;
  max: number; // секунд, предел ролика
  intro?: boolean; // заставка с датой прогона и версиями (по умолчанию да)
  intro_say?: string;
  outro?: boolean; // итог прогона (по умолчанию да)
  parts: CutPart[];
}
export interface Cuts {
  voice: string;
  cuts: Record<string, Cut>;
}

// Длительность карточки главы в начале первого клипа шага с главой (src/film.ts).
export const CARD_SECONDS = 2.5;
export const INTRO_SECONDS = 6;
export const OUTRO_SECONDS = 8;

// Нарезки цельны до выпуска: клипы есть в журнале, длительности положительны, предел не превышен
// по плану (голос может удлинить часть - это видно уже по готовому ролику).
export function checkCuts(c: Cuts, clips: Set<string>): string[] {
  const out: string[] = [];
  if (!c.voice) out.push('нет голоса (voice)');
  for (const [name, cut] of Object.entries(c.cuts ?? {})) {
    if (!cut.parts?.length) out.push(`${name}: нет частей`);
    for (const p of cut.parts ?? []) {
      if (!clips.has(p.clip)) out.push(`${name}: клипа ${p.clip} нет в журнале дубля`);
      if (!(p.seconds > 0)) out.push(`${name}: у ${p.clip} нет длительности`);
    }
    const plan =
      (cut.intro === false ? 0 : INTRO_SECONDS) +
      (cut.outro === false ? 0 : OUTRO_SECONDS) +
      (cut.parts ?? []).reduce((n, p) => n + (p.seconds > 0 ? p.seconds : 0), 0);
    if (plan > cut.max) out.push(`${name}: по плану ${plan} с - больше предела ${cut.max} с`);
  }
  return out;
}

// С какой секунды брать клип: задано - так; первый клип шага с главой - после карточки главы.
export function clipStart(firstOfChapter: boolean, from?: number): number {
  return from ?? (firstOfChapter ? CARD_SECONDS : 0);
}

// Сколько видео взять из клипа и сколько длится часть: голос не обрывается - последний кадр
// держится до конца фразы и ещё немного.
export function partTiming(seconds: number, clipLength: number, from: number, voice: number): { video: number; total: number } {
  const video = Math.max(0.5, Math.min(seconds, clipLength - from));
  return { video, total: Math.max(video, voice > 0 ? voice + 0.6 : 0) };
}

// Субтитр: строки не длиннее width знаков, перенос по пробелам.
export function wrap(text: string, width = 60): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

// Отпечаток нарезки: изменилась нарезка или голос - ролик перевыпускается из журнала.
export function cutHash(cut: Cut, voice: string): string {
  return createHash('sha256').update(JSON.stringify({ cut, voice })).digest('hex').slice(0, 12);
}

// Что сделано в прогоне - объекты дубля: задачи, PR и страницы из итогов шагов и ссылки из ответов
// фабрики (правило-кандидат, заметки о выпуске), но задачи и PR не старше первого объекта дубля:
// ответ !учёт ссылается и на PR прошлых прогонов. Номера задач и PR растут со временем, номера
// страниц Confluence - нет: страницы берутся все.
export function takeObjects(ctx: Record<string, unknown>): { issues: string[]; prs: number[]; pages: string[] } {
  const own: string[] = [];
  const replies: string[] = [];
  for (const v of Object.values(ctx)) {
    if (!v || typeof v !== 'object') continue;
    const d = v as Record<string, unknown>;
    for (const o of [d.issue, ...((d.issues as unknown[] | undefined) ?? []), d.pr, d.page]) {
      const url = (o as { url?: unknown } | undefined)?.url;
      if (typeof url === 'string') own.push(url);
    }
    const reply = (d.reply as { url?: unknown } | undefined)?.url;
    if (typeof reply === 'string') replies.push(reply);
  }
  const num = (re: RegExp) => (u: string) => Number(re.exec(u)?.[1] ?? Number.NaN);
  const issueN = num(/\/browse\/[A-Z]+-(\d+)$/);
  const prN = num(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  const minOf = (xs: number[]) => (xs.filter((x) => !Number.isNaN(x)).length ? Math.min(...xs.filter((x) => !Number.isNaN(x))) : 0);
  const i0 = minOf(own.map(issueN));
  const p0 = minOf(own.map(prN));
  const all = [...new Set([...own, ...replies])];
  return {
    issues: [...new Set(all.filter((u) => issueN(u) >= i0).map((u) => /\/browse\/([A-Z]+-\d+)$/.exec(u)?.[1] ?? ''))].sort(
      (a, b) => issueN(`/browse/${a}`) - issueN(`/browse/${b}`),
    ),
    prs: [...new Set(all.map(prN).filter((n) => n >= p0))].sort((a, b) => a - b),
    pages: [...new Set(all.map((u) => /\/wiki\/.*\/pages\/(\d+)/.exec(u)?.[1]).filter((x): x is string => Boolean(x)))],
  };
}

// Публикация ролика: из какого дубля, при каких версиях сценария и фабрики, по какой нарезке.
export interface Publication {
  cut: string;
  file: string;
  take: string;
  script: string;
  factory: string;
  cuts: string;
  seconds: number;
  built: string;
}

// Свежесть ролика (страж): новая версия сценария или фабрики - нужен новый дубль; другая нарезка
// или ролик из другого дубля - перевыпуск из журнала.
export function freshness(
  name: string,
  pub: Publication | undefined,
  now: { take: string; cuts: string; script: string; factory?: string },
  journal: { script: string; factory?: string },
): { cut: string; ok: boolean; newTake: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const newTake: string[] = [];
  if (now.script !== journal.script) newTake.push(`сценарий изменился после дубля (${journal.script} -> ${now.script})`);
  if (now.factory && journal.factory && now.factory !== journal.factory)
    newTake.push(`фабрика изменилась после дубля (${journal.factory.slice(0, 7)} -> ${now.factory.slice(0, 7)})`);
  if (!pub) reasons.push('ролик не выпущен');
  else {
    if (pub.take !== now.take) reasons.push(`ролик из другого дубля (${pub.take})`);
    if (pub.cuts !== now.cuts) reasons.push('нарезка изменилась - перевыпуск из журнала');
  }
  return { cut: name, ok: !newTake.length && !reasons.length, newTake: newTake.length > 0, reasons: [...newTake, ...reasons] };
}
