// Сценарий съёмки и то, что камера рисует поверх экрана: чистые функции, проверяются тестами.
import { createHash } from 'node:crypto';
import { FAILURE_PREFIXES, knownLabel, REFUSAL, REPLIES, RETRY, STATUSES } from './contract.ts';

export interface Persona {
  name: string; // как зритель видит участника на плашке
  kind: 'human' | 'ai';
  discord?: string; // бот персонажа: .state/discord-<id>.env
  atlassian?: string; // учётка Atlassian персонажа: .state/atlassian-<id>.env
  github?: string; // приложение GitHub персонажа: .state/github-app-<id>.env и .pem
  jira?: string; // accountId в Jira - для назначения исполнителем
  browser?: string; // вход браузера камеры: ключ в film.browsers
}

// Чьими глазами смотрит камера, когда у участника шага нет своей учётки: бот камеры в Discord
// (.state/discord-<id>.env, с правом читать содержимое сообщений) и персонажи, чьей учёткой
// читаются Jira, Confluence и GitHub. Ключей фабрики съёмка не берёт.
export interface Camera {
  discord: string;
  atlassian: string;
  github: string;
}

// Правка файла в PR участника: заготовка рядом со сценарием (from), замены в нынешнем тексте или
// дописка в конец. Строки проходят подстановки {шаг.поле}.
export interface FileEdit {
  path: string;
  from?: string;
  replace?: { find: string; with: string }[];
  append?: string;
}

// Кадр: страница (url) или карточка (card); focus - текст, до которого прокрутить; scroll - секунды
// плавной прокрутки от этой точки до конца страницы; play - действия на странице (стенд); login -
// вход камеры из film.browsers вместо входа участника (Figma, GlitchTip, Bitbucket).
export type PlayAction = { click: string } | { fill: { label: string; value: string } } | { press: string } | { wait: number };
export interface Shot {
  who: string;
  url?: string;
  card?: { title: string; note?: string };
  caption: string;
  seconds?: number;
  focus?: string;
  scroll?: number;
  play?: PlayAction[];
  login?: string;
  clockDays?: number; // часы браузера сдвинуты вперёд (часы стенда демо - так же)
  // Кадр переписывается после дубля из окна браузера через OBS (scripts/demo-window.sh): в журнал
  // идут адрес и длительность кадра; клип камеры остаётся запасным, если OBS нет.
  window?: boolean;
}

export interface HttpCall {
  method?: string;
  url: string;
  body?: unknown;
  as?: string;
}

// Итог шага узнаётся по связи с объектом дубля, а не по фразе фабрики:
// - Discord: reply - ответ фабрики на сообщение шага (ссылка на него), ok - какой ответ - успех
//   (REPLIES видимых выходов, иной ответ - провал); expect: refusal - итог шага - отказ в праве;
//   mentions - объявление фабрики (не ответ), где есть идентификатор дубля: номер PR, тег, коммит;
//   ack - каким должен быть ответ на сообщение шага, пока ждём объявления; after - объявление
//   после сообщения другого шага;
// - Jira: задача по ключу, по метке (с заголовком match) или среди зависимостей (deps); label -
//   её метка состояния, has - ещё метки, state: closed - задача закрыта, fromFactory - новый
//   комментарий не от участников съёмки (его текст и ссылка - в итог); fail - метки провала
//   (по умолчанию agent-failed);
// - GitHub: PR по номеру или началу имени ветки, со статусом; success - нужен зелёный, красный -
//   провал; newer - на PR новый коммит (вершина уже не этот sha).
// Метки через "|" - любая из них.
export interface Wait {
  timeout?: number; // секунды
  discord?: {
    channel: string;
    reply?: boolean;
    ok?: string;
    expect?: 'refusal';
    mentions?: string;
    ack?: string;
    after?: string;
    retry?: number; // через сколько секунд сказать реплику снова: ответа нет или фабрика просит повторить (по умолчанию 60)
    retries?: number; // сколько раз всего сказать реплику (по умолчанию 3)
  };
  jira?: {
    label?: string;
    key?: string;
    deps?: string;
    match?: string;
    count?: number;
    open?: boolean;
    has?: string;
    state?: 'closed';
    fromFactory?: boolean;
    fail?: string;
  };
  github?: { pr?: string; head?: string; status?: string; success?: boolean; newer?: string };
}

export interface Step {
  id: string;
  chapter?: string; // заголовок главы языком зрителя; нет - шаг продолжает прошлую главу
  note?: string; // подзаголовок главы
  who: string;
  do?: {
    discord?: { channel: string; text: string; file?: string }; // file - картинка PNG из film-assets во вложении
    wiki?: { title: string; body: string; label?: string };
    label?: { key: string; label: string };
    comment?: { key: string; text: string };
    assign?: { key: string; to: string }; // to - участник из film.personas
    logWork?: { key: string; minutes: number; comment: string };
    close?: { key: string };
    github?: {
      pr?: { branch: string; title: string; body: string; base?: string; files: FileEdit[] };
      merge?: { pr: string; title: string };
      comment?: { pr: string; text: string };
      closePr?: { pr: string }; // закрыть PR без слияния
      tag?: { bump: 'minor' | 'patch' }; // тег следующего выпуска на вершине main: итог - tag
      head?: string; // вершина ветки: итог - sha (например, коммит, который проверяет e2e стенда)
    };
    // Запрос к стенду: итог - status и json; список запросов идёт по порядку, as - имя итога запроса
    // в итоге шага ({шаг.имя.json.id} - в следующих запросах того же шага).
    http?: HttpCall | HttpCall[];
    webhook?: { channel: string; username: string; text: string }; // сообщение вебхука без учётки
    decision?: string; // команда, которую человек выполняет сам вживую
  };
  wait?: Wait;
  show?: Shot[];
}

export interface Film {
  title: string;
  personas: Record<string, Persona>;
  camera?: Camera;
  // Учётка бота фабрики в Discord (нет - узнаётся по первому ответу) и её публичный репозиторий:
  // вершина его main - версия фабрики в журнале дубля.
  factory?: { discord?: string; repo?: string };
  // Мир дубля: где камера проверяет готовность (сбои стенда в GlitchTip - ключ .state/glitchtip.token).
  world?: { glitchtip?: { url: string; org: string; project: string } };
  browsers?: Record<string, string>; // ключ -> файл сохранённого входа в каталоге состояния
  steps: Step[];
}

// Файл вида ИМЯ=значение; комментарии и пустые строки пропускаются, кавычки снимаются.
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

// Подстановки {шаг.поле.поле} из итогов прошлых шагов, {...|lower} - строчными, {...|short} - первые
// 7 знаков (короткий коммит); неизвестная - ошибка, а не пустая строка.
export function fill(text: string, ctx: Record<string, unknown>): string {
  return text.replace(/\{([a-z0-9_.-]+)(\|lower|\|short)?\}/gi, (_, path: string, filter?: string) => {
    let v: unknown = ctx;
    for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
    if (v === undefined || v === null) throw new Error(`нет значения {${path}}`);
    return filter === '|lower' ? String(v).toLowerCase() : filter === '|short' ? String(v).slice(0, 7) : String(v);
  });
}

// Новый текст файла по правке; замена требует ровно одного вхождения - иначе ошибка, а не тихий пропуск.
export function applyEdit(current: string | undefined, e: FileEdit, asset: (name: string) => string): string {
  let text = e.from ? asset(e.from) : (current ?? '');
  for (const r of e.replace ?? []) {
    if (current === undefined && !e.from) throw new Error(`${e.path}: нет файла`);
    const n = text.split(r.find).length - 1;
    if (n !== 1) throw new Error(`${e.path}: "${r.find}" встречается ${n} раз`);
    text = text.replace(r.find, () => r.with);
  }
  if (e.append !== undefined) text = `${text ? text.replace(/\n*$/, '\n') : ''}${e.append.replace(/\n*$/, '\n')}`;
  return text;
}

const placeholder = /\{[a-z0-9_.-]+(\|lower|\|short)?\}/i;
const split = (x: string | undefined) => (x ?? '').split('|').filter(Boolean);

// Сценарий съёмки цел до прогона: участники шагов и кадров есть и у них есть нужные учётки,
// подстановки ссылаются на прошлые шаги (в ожидании и кадрах - и на свой), заготовки на месте;
// итоги ждутся по связи с объектами дубля, а не по фразам; метки и статусы - из видимых выходов
// фабрики (contract.ts); у камеры есть учётки для того, что она читает.
export function checkFilm(film: Film, assetExists: (name: string) => boolean): string[] {
  const out: string[] = [];
  const known = new Set(['take', 'takeKey', 'factory']);
  const said = new Set<string>();
  const refs = (x: unknown) =>
    [...JSON.stringify(x ?? '').matchAll(/\{([a-z0-9_-]+)[a-z0-9_.-]*(\|lower|\|short)?\}/gi)].map((m) => m[1] ?? '');
  const unknown = (id: string, x: unknown) => {
    for (const r of new Set(refs(x))) if (!known.has(r)) out.push(`${id}: {${r}...} - не прошлый шаг`);
  };
  const label = (id: string, l: string) => {
    if (!placeholder.test(l) && !knownLabel(l)) out.push(`${id}: метки ${l} нет в видимых выходах фабрики`);
  };
  for (const s of film.steps) {
    const who = film.personas[s.who];
    if (!who) out.push(`${s.id}: нет участника ${s.who}`);
    // Запросы к стенду в шаге могут ссылаться на итоги прошлых запросов того же шага.
    unknown(s.id, { ...s.do, http: undefined });
    known.add(s.id);
    unknown(s.id, [s.do?.http, s.wait, s.show]);
    const d = s.do;
    if (d?.discord && !who?.discord) out.push(`${s.id}: у участника ${s.who} нет бота Discord`);
    const writesGithub = d?.github?.pr || d?.github?.merge || d?.github?.comment || d?.github?.closePr || d?.github?.tag;
    if (writesGithub && !who?.github) out.push(`${s.id}: у участника ${s.who} нет приложения GitHub`);
    if (d?.github?.head && !who?.github && !film.camera?.github)
      out.push(`${s.id}: GitHub читать некому - нет приложения у ${s.who} и camera.github`);
    if ((d?.wiki || d?.label || d?.comment || d?.assign || d?.logWork || d?.close) && !who?.atlassian)
      out.push(`${s.id}: у участника ${s.who} нет учётки Atlassian`);
    if (d?.label) label(s.id, d.label.label);
    if (d?.discord || d?.webhook) said.add(s.id);

    const w = s.wait;
    if (w?.discord) {
      const wd = w.discord as NonNullable<Wait['discord']> & { contains?: string };
      if (wd.contains !== undefined)
        out.push(`${s.id}: ожидание по фразе "${wd.contains}" - ждать ответ (reply) или идентификатор (mentions)`);
      if (!wd.reply && !wd.mentions) out.push(`${s.id}: ожидание в Discord без ответа (reply) и идентификатора (mentions)`);
      if (wd.reply && !(d?.discord || d?.webhook)) out.push(`${s.id}: ответ ждётся, а своего сообщения у шага нет`);
      if (wd.reply && !wd.ok && !wd.expect) out.push(`${s.id}: ответ ждётся, а какой ответ - успех (ok), не сказано`);
      for (const k of [wd.ok, wd.ack]) if (k && !REPLIES[k]) out.push(`${s.id}: ответа ${k} нет в видимых выходах фабрики`);
      if (wd.mentions && !placeholder.test(wd.mentions)) out.push(`${s.id}: mentions "${wd.mentions}" - без идентификатора дубля`);
      if (wd.after && (wd.after === s.id || !said.has(wd.after))) out.push(`${s.id}: after ${wd.after} - не прошлый шаг с сообщением`);
      if (!film.camera?.discord) out.push(`${s.id}: Discord читает бот камеры - нет camera.discord`);
    }
    if (w?.jira) {
      const wj = w.jira as NonNullable<Wait['jira']> & { comment?: unknown };
      if (typeof wj.comment === 'string') out.push(`${s.id}: ожидание по фразе "${wj.comment}" в комментарии - ждать метку или закрытие`);
      for (const l of [...split(wj.label), ...split(wj.has), ...split(wj.fail)]) label(s.id, l);
      if (!who?.atlassian && !film.camera?.atlassian) out.push(`${s.id}: Jira читать некому - нет учётки у ${s.who} и camera.atlassian`);
    }
    if (w?.github) {
      if (w.github.status && !(STATUSES as readonly string[]).includes(w.github.status))
        out.push(`${s.id}: статуса ${w.github.status} нет в видимых выходах фабрики`);
      if (!who?.github && !film.camera?.github) out.push(`${s.id}: GitHub читать некому - нет приложения у ${s.who} и camera.github`);
    }
    for (const sh of s.show ?? []) {
      if (!film.personas[sh.who]) out.push(`${s.id}: в кадре нет участника ${sh.who}`);
      if (!sh.url && !sh.card) out.push(`${s.id}: у кадра нет ни страницы, ни карточки`);
      if (sh.login && !film.browsers?.[sh.login]) out.push(`${s.id}: нет входа камеры ${sh.login} в film.browsers`);
    }
    const file = d?.discord?.file;
    if (file && !assetExists(file)) out.push(`${s.id}: нет заготовки ${file}`);
    for (const f of d?.github?.pr?.files ?? []) if (f.from && !assetExists(f.from)) out.push(`${s.id}: нет заготовки ${f.from}`);
  }
  for (const k of ['atlassian', 'github'] as const) {
    const id = film.camera?.[k];
    if (id && !Object.values(film.personas).some((p) => p[k] === id)) out.push(`camera.${k}: нет участника с учёткой ${id}`);
  }
  return out;
}

// Сообщение Discord, как его видит камера.
export interface ChatMessage {
  id: string;
  author: { id: string; bot?: boolean; username?: string; global_name?: string | null; avatar?: string | null };
  content: string;
  webhook_id?: string;
  message_reference?: { message_id?: string };
  timestamp?: string;
  attachments?: { url: string; content_type?: string }[];
  mentions?: { id: string; username?: string; global_name?: string | null }[];
}

// Ответ фабрики на сообщение шага: сообщение со ссылкой на него. Ответ "повторите команду" -
// не итог. Пока учётка фабрики не известна, годится ответ любого бота, кроме вебхука.
export function replyTo(msgs: ChatMessage[], mine: string, factory?: string): ChatMessage | undefined {
  return msgs.find(
    (m) =>
      m.message_reference?.message_id === mine &&
      (factory ? m.author.id === factory : m.author.bot === true && !m.webhook_id) &&
      !RETRY.test(m.content),
  );
}

// Объявление фабрики: не ответ на сообщение, от учётки фабрики, с идентификатором дубля.
export function notice(msgs: ChatMessage[], factory: string, mention: string): ChatMessage | undefined {
  return msgs.find((m) => !m.message_reference?.message_id && m.author.id === factory && m.content.includes(mention));
}

// Что значит ответ фабрики на сообщение шага: итог, повод сказать реплику снова или провал с
// текстом ответа. Шаг ждёт отказ, а фабрика ответила иначе - тоже провал: право не проверено.
export type ReplyOutcome = { kind: 'ok' } | { kind: 'retry' } | { kind: 'fail'; why: string };
export function replyOutcome(text: string, w: { ok?: string; ack?: string; expect?: 'refusal' }): ReplyOutcome {
  const t = text.trim();
  if (RETRY.test(t)) return { kind: 'retry' };
  if (w.expect === 'refusal') return REFUSAL.test(t) ? { kind: 'ok' } : { kind: 'fail', why: `ждали отказ в праве, а ответ: ${t}` };
  const want = w.ok ?? w.ack;
  if (want && REPLIES[want]?.test(t)) return { kind: 'ok' };
  if (want || FAILURE_PREFIXES.some((p) => t.startsWith(p)) || REFUSAL.test(t)) return { kind: 'fail', why: t };
  return { kind: 'ok' };
}

// Фабрика просит повторить команду (площадка временно недоступна): повод сказать реплику снова.
export function asksRetry(text: string): boolean {
  return RETRY.test(text);
}

// Любая из меток через "|".
export function anyOf(have: string[], want: string): boolean {
  return split(want).some((l) => have.includes(l));
}

// Статус коммита фабрики для ожидания: ждать, готово или провал (нужен зелёный, а он красный).
export function statusOutcome(state: string | undefined, success?: boolean): 'wait' | 'done' | 'fail' {
  if (!state || state === 'pending') return 'wait';
  if (success && state !== 'success') return 'fail';
  return 'done';
}

// Ворота слияния PR: слить, ждать или провал. Красная обязательная проверка ветки и конфликт с базой -
// провал сразу, с причиной; черновик (агент дорабатывает PR) и идущие проверки - ждать. mergeable -
// состояние слияния GitHub (mergeable_state): clean и unstable (красная необязательная проверка)
// пускают, blocked, unknown и прочие - нет.
export type CheckState = 'ok' | 'pending' | 'failed';
export type MergeGate = { kind: 'merge' } | { kind: 'wait'; why: string } | { kind: 'fail'; why: string };
export function mergeGate(p: { mergeable: string; draft: boolean }, required: { name: string; state: CheckState }[]): MergeGate {
  const failed = required.filter((c) => c.state === 'failed').map((c) => c.name);
  if (failed.length) return { kind: 'fail', why: `красная обязательная проверка: ${failed.join(', ')}` };
  if (p.mergeable === 'dirty') return { kind: 'fail', why: 'конфликт с базовой веткой' };
  if (p.draft) return { kind: 'wait', why: 'PR - черновик: агент дорабатывает' };
  const pending = required.filter((c) => c.state === 'pending').map((c) => c.name);
  if (pending.length) return { kind: 'wait', why: `ждём обязательные проверки: ${pending.join(', ')}` };
  if (p.mergeable === 'clean' || p.mergeable === 'unstable') return { kind: 'merge' };
  return { kind: 'wait', why: `GitHub ещё не пускает слияние (${p.mergeable})` };
}

// Первая ссылка в тексте - без хвостовой пунктуации и без угловых скобок Discord (<адрес> - без превью).
export function firstUrl(text: string): string | undefined {
  return /https?:\/\/[^\s<>]+/.exec(text)?.[0]?.replace(/[).,]+$/, '');
}

// Тег следующего выпуска по последнему тегу vX.Y.Z; тегов выпусков нет - v1.0.0.
export function nextVersion(tags: string[], bump: 'minor' | 'patch'): string {
  const vs = tags
    .map((t) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(t))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const last = vs.at(-1);
  if (!last) return 'v1.0.0';
  return bump === 'minor' ? `v${last[0]}.${last[1] + 1}.0` : `v${last[0]}.${last[1]}.${last[2] + 1}`;
}

// Номер сообщения Discord на момент времени: "сообщения после" для ожидания без своей реплики.
export function snowflake(ms: number): string {
  return String((BigInt(ms) - 1_420_070_400_000n) << 22n);
}

// Метка всего, что создаёт съёмка: по ней scripts/demo-reset.sh уводит прошлые дубли в архив.
export const FILM_LABEL = 'film';
// Страница Confluence, под которую сброс уводит страницы прошлых дублей.
export const ARCHIVE_PAGE = 'Архив съёмок';

// Объект дубля - с меткой film или заведённый не владельцем мира (автор главной страницы пространства,
// руководитель проекта Jira): базу демо заводит владелец, а в дублях пишут фабрика и персонажи. Своё
// фабрика ставит без меток съёмки, и одной метки мало: страницы выпусков прошлых дублей попадали в
// ответ библиотекаря. По тому же правилу scripts/demo-reset.sh уводит страницы в архив; задачи Jira
// он закрывает по меткам, а задачу без меток не пустит проверка готовности мира.
export function takeObject(o: { labels: string[]; creator?: string }, owner: string): boolean {
  return o.labels.includes(FILM_LABEL) || o.creator !== owner;
}

// Журнал дубля (manifest.json): шаг сценария - план; у плана попытки с исходом, клипы последней
// удачной попытки и ссылки на объекты дубля. Прерванный или упавший план переснимается один.
export interface Clip {
  step: string;
  chapter: string;
  who: string;
  caption: string;
  file: string;
  at: string;
  // Кадр для записи окна браузера через OBS (Shot.window): адрес, секунды, карточка главы.
  window?: { url: string; seconds: number; card?: { title: string; note: string } };
}
export interface Attempt {
  n: number;
  start: string;
  end?: string;
  outcome: 'running' | 'done' | 'failed' | 'interrupted';
  why?: string;
  adopted?: boolean; // итог прошлой попытки уже наступил - действие не повторялось
}
export interface Plan {
  status: Attempt['outcome'];
  attempts: Attempt[];
  clips: Clip[];
  links: string[];
}

// Предусловие плана: итоги других шагов, на которые ссылается шаг, уже есть. Свои итоги шаг получает
// сам, имя и ключ дубля и бот фабрики известны всегда. Пересъёмка одного плана без итогов, на
// которые он опирается, - провал до действия, а не посреди него.
export function unmet(step: Step, ctx: Record<string, unknown>): string[] {
  const out = new Set<string>();
  for (const m of JSON.stringify([step.do, step.wait, step.show]).matchAll(/\{([a-z0-9_.-]+)(\|lower|\|short)?\}/gi)) {
    const path = m[1] ?? '';
    if ([step.id, 'take', 'takeKey', 'factory'].includes(path.split('.')[0] ?? '')) continue;
    try {
      fill(`{${path}}`, ctx);
    } catch {
      out.add(`{${path}}`);
    }
  }
  return [...out];
}

// Ссылки плана для журнала и ролика: адреса задач, страниц, PR и ответов из итогов шага.
export function links(x: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/^https?:\/\/\S+$/.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(x);
  return [...out];
}

// Клипы дубля по порядку сценария, а не по порядку съёмки: переснятый план встаёт на своё место.
export function takeClips(steps: Step[], plans: Record<string, Plan>): Clip[] {
  return steps.flatMap((s) => (plans[s.id]?.status === 'done' ? (plans[s.id]?.clips ?? []) : []));
}

// Версия сценария - отпечаток film.yml и заготовок: по ней страж свежести решит, нужен ли новый дубль.
export function scriptVersion(files: { name: string; content: string | Uint8Array }[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    h.update(f.name);
    h.update('\0');
    h.update(f.content);
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

// Имя дубля по местному времени начала: take-ММДД-ЧЧММ - годится в метку Jira и Confluence.
export function takeName(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `take-${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

// Ключ дубля {takeKey} - год в прошлом (0100-1999) из даты и времени начала дубля: делает объекты
// дубля своими там, где площадка склеивает похожие. GlitchTip склеивает сбои с одинаковым текстом
// ошибки в один, и фабрика открыла бы баг прошлого дубля; сбой с годом дубля в несуществующей дате -
// новый сбой и новый баг. Год всегда в прошлом: при годе ЧЧММ дубль после 20:27 давал будущий год,
// и правило возраста цели отклоняло заявку (422) раньше, чем ломался разбор даты.
export function takeKey(take: string): string {
  const m = /take-(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(take);
  if (!m) return '0100';
  const [month, day, hh, mm] = m.slice(1).map(Number) as [number, number, number, number];
  return String(100 + (((month * 31 + day) * 1440 + hh * 60 + mm) % 1900)).padStart(4, '0');
}

// Метка другого дубля на объекте, который выбрало ожидание: объект прошлого дубля - провал шага,
// а не тихая подмена.
export function foreignTake(labels: string[], take: string): string | undefined {
  return labels.find((l) => /^take-\d{4}-\d{4}$/.test(l) && l !== take);
}

// Плашка участника в углу экрана: кто сейчас действует; ИИ-персонаж помечен. Плашка ставится сразу,
// а не по загрузке страницы (у Confluence загрузка тянется секунды), и возвращается, если приложение
// перерисовало страницу.
export function badge(p: { name: string; ai: boolean }): void {
  const put = () => {
    if (!document.documentElement || document.getElementById('film-badge')) return;
    const el = document.createElement('div');
    el.id = 'film-badge';
    el.textContent = p.ai ? `${p.name} - ИИ-персонаж` : p.name;
    el.setAttribute(
      'style',
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 14px;border-radius:10px;' +
        `font:600 16px/1.3 system-ui,sans-serif;color:#fff;background:${p.ai ? '#5B3FD6' : '#1F6F43'};` +
        'box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none',
    );
    document.documentElement.appendChild(el);
  };
  put();
  document.addEventListener('DOMContentLoaded', put);
  setInterval(put, 300);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

// Карточка главы перед первым кадром шага.
export function chapterHtml(title: string, note: string): string {
  return `<!doctype html><html lang="ru"><body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:14px;background:#14111F;color:#fff;font-family:system-ui,sans-serif"><div style="font-size:44px;font-weight:700;text-align:center;max-width:1000px">${esc(title)}</div><div style="font-size:22px;color:#C9C3E6;text-align:center;max-width:1000px">${esc(note)}</div></body></html>`;
}

// Чат из журнала дубля: настоящие сообщения шага (бот камеры читает их по id из журнала) в
// нейтральном виде чата - не интерфейс Discord, а его переписка с подписью источника.
export type ChatRole = 'ai' | 'factory' | 'webhook' | 'human';
export interface ChatLine {
  name: string;
  role: ChatRole;
  avatar?: string;
  time: string; // ЧЧ:ММ
  html: string; // текст сообщения, уже размеченный (discordHtml)
  images: string[];
}

// Разметка Discord - в HTML: экранирование, упоминания по именам, **жирный**, `код`, блоки кода,
// ссылки <адрес> и [текст](адрес) - текстом, заголовки и списки - строками.
export function discordHtml(text: string, names: Record<string, string>): string {
  const codes: string[] = [];
  let t = esc(text).replace(/```(?:[a-z]*\n)?([\s\S]*?)```/g, (_, c: string) => {
    codes.push(`<pre>${c.replace(/\n$/, '')}</pre>`);
    return `<<${codes.length - 1}>>`;
  });
  t = t
    .replace(/&lt;@!?(\d+)&gt;/g, (_, id: string) => `<span class="mention">@${esc(names[id] ?? id)}</span>`)
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<span class="link">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<span class="link">$1</span>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,3} (.+)$/gm, '<b>$1</b>')
    .replace(/^[-*] /gm, '• ')
    .replace(/\n/g, '<br>');
  // Метка блока кода - с "<": после экранирования такого знака в тексте нет.
  return t.replace(/<<(\d+)>>/g, (_, i: string) => codes[Number(i)] ?? '');
}

const ROLE = { ai: 'ИИ-персонаж', factory: 'фабрика', webhook: 'вебхук без учётки', human: 'человек' } as const;

// Страница чата: сообщения появляются по одному, источник - в шапке.
export function chatHtml(p: { channel: string; lines: ChatLine[] }): string {
  const msgs = p.lines
    .map(
      (l, i) =>
        `<div class="msg" style="animation-delay:${(i * 1.2).toFixed(1)}s">${l.avatar ? `<img class="ava" src="${esc(l.avatar)}">` : '<div class="ava"></div>'}<div class="body"><div class="head"><span class="name">${esc(l.name)}</span><span class="role ${l.role}">${ROLE[l.role]}</span><span class="time">${esc(l.time)}</span></div><div class="text">${l.html}</div>${l.images.map((u) => `<img class="att" src="${esc(u)}">`).join('')}</div></div>`,
    )
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:flex;flex-direction:column;background:#1E1F24;color:#E6E6EA;font:17px/1.45 system-ui,sans-serif}
.top{padding:14px 28px;border-bottom:1px solid #33343B;display:flex;gap:14px;align-items:baseline}
.top .ch{font-size:22px;font-weight:700}.top .src{color:#9C9DA8;font-size:15px}
.list{flex:1;overflow-y:auto;padding:18px 28px}
.msg{display:flex;gap:14px;margin-bottom:18px;opacity:0;animation:in .5s ease forwards}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.ava{width:42px;height:42px;border-radius:50%;background:#3A3B44;flex:none}
.head{display:flex;gap:10px;align-items:baseline}.name{font-weight:700}
.role{font-size:12px;padding:1px 7px;border-radius:6px;color:#fff}.role.ai{background:#5B3FD6}.role.factory{background:#1F6F43}
.role.webhook{background:#9A3B3B}.role.human{background:#555}.time{color:#8E8F99;font-size:13px}
.text{margin-top:3px;max-width:1080px;word-wrap:break-word}.mention{color:#B9B2FF;background:#3B3566;border-radius:4px;padding:0 3px}
.link{color:#7DB4FF}code{background:#2B2C33;border-radius:4px;padding:0 4px}pre{background:#2B2C33;border-radius:6px;padding:8px 10px;white-space:pre-wrap}
.att{display:block;margin-top:8px;max-width:520px;max-height:300px;border-radius:8px}
</style></head><body><div class="top"><span class="ch">#${esc(p.channel)}</span><span class="src">переписка команды в Discord - роли играют ИИ-персонажи</span></div><div class="list">${msgs}</div></body></html>`;
}

// Сообщение Discord - строка чата: роль - фабрика, вебхук, ИИ-персонаж (бот) или человек;
// время - местное (часовой пояс камеры).
export function chatLine(m: ChatMessage, factory: string | undefined): ChatLine {
  const names = Object.fromEntries((m.mentions ?? []).map((u) => [u.id, u.global_name || u.username || u.id]));
  const role: ChatRole = m.webhook_id ? 'webhook' : m.author.id === factory ? 'factory' : m.author.bot ? 'ai' : 'human';
  const d = m.timestamp ? new Date(m.timestamp) : undefined;
  const two = (n: number) => String(n).padStart(2, '0');
  return {
    name: m.author.global_name || m.author.username || m.author.id,
    role,
    ...(m.author.avatar ? { avatar: `https://cdn.discordapp.com/avatars/${m.author.id}/${m.author.avatar}.png?size=80` } : {}),
    time: d ? `${two(d.getHours())}:${two(d.getMinutes())}` : '',
    html: discordHtml(m.content, names),
    images: (m.attachments ?? []).filter((a) => a.content_type?.startsWith('image/')).map((a) => a.url),
  };
}

// Место клипа чата в плане: перед кадрами браузера, но после первого кадра, если карточка главы
// уже в нём (у шага есть глава и кадры).
export function chatPlace(chapter: boolean, browserClips: number): number {
  return chapter && browserClips > 0 ? 1 : 0;
}
