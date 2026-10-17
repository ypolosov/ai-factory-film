// Режиссёр видео-демо: шаги сценария съёмки выполняют участники через API под своими учётками
// (у ИИ-персонажа - бот Discord, учётка Atlassian и приложение GitHub), итог шага ждётся по связи
// с объектом дубля (ответ на сообщение шага, ключ задачи, номер PR, тег), камера - Playwright без
// окна - снимает экран браузера участника с его плашкой. Шаг с do.decision называет команду,
// которую человек выполняет сам вживую, и ждёт её итога.
// Съёмка - отдельная система: ключей фабрики она не берёт. Читает бот камеры (Discord) и учётки
// участников (Jira, Confluence, GitHub); о фабрике знает только её видимые выходы (contract.ts).
// Ключи - из каталога состояния (только чтение); в журнал, манифест и клипы они не попадают.
// Использование: node film.ts СЦЕНАРИЙ.yml КАТАЛОГ_КЛИПОВ [--only шаг,шаг] [--ctx МАНИФЕСТ] [--state /state]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { parse } from 'yaml';
import { atlassian } from './atlassian.ts';
import { LABELS } from './contract.ts';
import { discordBot } from './discord.ts';
import { persona as githubPersona } from './github.ts';
import {
  ARCHIVE_PAGE,
  anyOf,
  applyEdit,
  badge,
  chapterHtml,
  checkFilm,
  FILM_LABEL,
  type Film,
  fill,
  firstUrl,
  foreignTake,
  nextVersion,
  notice,
  parseEnv,
  replyOutcome,
  replyTo,
  type Step,
  snowflake,
  statusOutcome,
  takeKey,
  takeName,
  takeObject,
} from './script.ts';

const [filmPath = '', out = ''] = process.argv.slice(2);
const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const state = flag('--state') ?? '/state';
const only = flag('--only')?.split(',');
const film = parse(readFileSync(filmPath, 'utf8')) as Film;
const stateFile = (name: string) => {
  const f = join(state, name);
  if (!existsSync(f)) throw new Error(`нет ${name} в каталоге состояния съёмки`);
  return f;
};
const env = (name: string) => parseEnv(readFileSync(stateFile(name), 'utf8'));
const t0 = Date.now();
const log = (m: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assetsDir = join(filmPath, '..', 'film-assets');
// Сценарий проверяется до первого действия: ошибка в нём не оставит стенд на полпути.
const problems = checkFilm(film, (n) => existsSync(join(assetsDir, n)));
if (problems.length) throw new Error(`сценарий съёмки:\n${problems.join('\n')}`);
if (!film.camera) throw new Error('сценарий съёмки: нет camera - чьими учётками смотрит камера');
const camera = film.camera;

// Atlassian: учётка участника (.state/atlassian-<id>.env); у участника без неё читает учётка камеры.
// Подмены учёткой фабрики нет: нет ключа участника - шаг падает.
const accounts = new Map<string, ReturnType<typeof atlassian>>();
const atlassianOf = (id: string) => {
  if (!accounts.has(id)) accounts.set(id, atlassian(env(`atlassian-${id}.env`), id));
  return accounts.get(id) as ReturnType<typeof atlassian>;
};
const as = (who: string) => {
  const id = film.personas[who]?.atlassian;
  if (!id) throw new Error(`у участника ${who} нет учётки Atlassian`);
  return atlassianOf(id);
};
const reader = (who: string) => atlassianOf(film.personas[who]?.atlassian ?? camera.atlassian);
// accountId участников съёмки: комментарий не от них - комментарий фабрики.
const ours = new Set(Object.values(film.personas).flatMap((p) => (p.jira ? [p.jira] : [])));

// GitHub: участник действует своим приложением; читает его приложение или приложение камеры.
const apps = new Map<string, ReturnType<typeof githubPersona>>();
const appOf = (id: string) => {
  if (!apps.has(id)) apps.set(id, githubPersona(state, id));
  return apps.get(id) as ReturnType<typeof githubPersona>;
};
const app = (who: string) => {
  const id = film.personas[who]?.github;
  if (!id) throw new Error(`у участника ${who} нет приложения GitHub`);
  return appOf(id);
};
const looker = (who: string) => appOf(film.personas[who]?.github ?? camera.github);

const asset = (name: string) => fill(readFileSync(join(assetsDir, name), 'utf8'), ctx);

// Discord: бот камеры читает каналы (нужно право читать содержимое сообщений), бот персонажа пишет.
const botToken = (id: string) => {
  const e = env(`discord-${id}.env`);
  return e.DISCORD_BOT_TOKEN ?? e[`DISCORD_${id.toUpperCase().replace(/-/g, '_')}_TOKEN`] ?? '';
};
const eye = discordBot(botToken(camera.discord), `камера ${camera.discord}`);
const guilds = await eye.guilds();
if (guilds.length !== 1) throw new Error(`бот камеры должен быть ровно на одном сервере Discord, а он на ${guilds.length}`);
const channels = new Map((await eye.channels(guilds[0]?.id ?? '')).map((c) => [c.name, c.id]));
const channelId = (name: string) => {
  const id = channels.get(name);
  if (!id) throw new Error(`нет канала ${name}`);
  return id;
};

// Итоги шагов для подстановок {шаг.поле}; {take} - имя дубля, {factory.discord} - учётка бота
// фабрики, когда узнана. Всё, что создаёт съёмка, получает метки film и имени дубля: прошлые дубли
// уводит в архив scripts/demo-reset.sh. --ctx МАНИФЕСТ продолжает прерванный дубль: итоги и имя
// дубля - из его манифеста; сделанные шаги пропускаются, если их не назвали в --only.
const resumed = flag('--ctx')
  ? (JSON.parse(readFileSync(flag('--ctx') ?? '', 'utf8')) as { take: string; ctx: Record<string, unknown>; clips?: Clip[] })
  : undefined;
const take = resumed?.take ?? takeName(new Date(t0));
const ctx: Record<string, unknown> = { ...resumed?.ctx, take, takeKey: takeKey(take) };
if (film.steps.some((s) => s.id === 'take' || s.id === 'factory')) throw new Error('шаг не может называться take или factory');
const factory = () => film.factory?.discord ?? (ctx.factory as { discord?: string } | undefined)?.discord;
const learn = (id: string) => {
  if (factory()) return;
  ctx.factory = { discord: id };
  log(`бот фабрики в Discord: ${id} (узнан по ответу)`);
};

type Clip = { step: string; chapter: string; who: string; caption: string; file: string; at: string };
const clips: Clip[] = [...(resumed?.clips ?? [])];
// Журнал дубля пишется после каждого шага: прерванный дубль продолжается с последнего сделанного.
const manifest = () =>
  writeFileSync(
    join(out, 'manifest.json'),
    JSON.stringify({ title: film.title, take, started: new Date(t0).toISOString(), ctx, clips }, null, 2),
  );

// Реплика участника в Discord - его ботом; @factory - упоминание бота фабрики.
async function say(step: Step, did: Record<string, unknown>): Promise<void> {
  const d = step.do?.discord;
  const who = film.personas[step.who];
  if (!d) return;
  if (!who?.discord) throw new Error(`у участника ${step.who} нет бота Discord`);
  const f = factory();
  if (d.text.includes('@factory') && !f)
    throw new Error(`${step.id}: упоминание @factory, а бот фабрики ещё не известен (film.factory.discord)`);
  const text = fill(d.text, ctx).replaceAll('@factory', `<@${f}>`);
  let body: unknown = { content: text };
  if (d.file) {
    // Картинка во вложении, например макет экрана, выгруженный из Figma.
    const form = new FormData();
    form.set('payload_json', JSON.stringify({ content: text }));
    form.set('files[0]', new Blob([readFileSync(join(assetsDir, d.file))], { type: 'image/png' }), basename(d.file));
    body = form;
  }
  const m = await discordBot(botToken(who.discord), who.discord).send(channelId(d.channel), body);
  did.message = { id: m.id, channel: d.channel };
  did.said = Date.now();
  did.says = Number(did.says ?? 0) + 1;
  log(`${step.id}: ${who.name} пишет в #${d.channel}`);
}

async function act(step: Step): Promise<void> {
  const did: Record<string, unknown> = { since: Date.now() };
  ctx[step.id] = did;
  const d = step.do;
  if (!d) return;
  if (d.discord) await say(step, did);
  if (d.wiki) {
    const wiki = as(step.who).wiki;
    if (!wiki) throw new Error(`у участника ${step.who} нет ключа Confluence`);
    const page = await wiki.upsertPage(fill(d.wiki.title, ctx), fill(d.wiki.body, ctx));
    for (const l of [FILM_LABEL, take, d.wiki.label]) if (l) await wiki.addLabel(page.id, l);
    did.page = page;
    log(`${step.id}: страница ${page.url}`);
  }
  if (d.label) {
    await as(step.who).tracker.addLabel(fill(d.label.key, ctx), d.label.label);
    log(`${step.id}: метка ${d.label.label} на ${fill(d.label.key, ctx)}`);
  }
  if (d.comment) {
    await as(step.who).tracker.addComment(fill(d.comment.key, ctx), fill(d.comment.text, ctx), film.personas[step.who]?.jira);
    log(`${step.id}: комментарий на ${fill(d.comment.key, ctx)}`);
  }
  if (d.assign) {
    const who = film.personas[d.assign.to];
    if (!who?.jira) throw new Error(`у участника ${d.assign.to} нет учётки Jira`);
    await as(step.who).tracker.assign(fill(d.assign.key, ctx), who.jira);
    log(`${step.id}: ${fill(d.assign.key, ctx)} - исполнитель ${who.name}`);
  }
  if (d.logWork) {
    await as(step.who).tracker.logWork(fill(d.logWork.key, ctx), d.logWork.minutes * 60, fill(d.logWork.comment, ctx));
    log(`${step.id}: списано ${d.logWork.minutes} мин на ${fill(d.logWork.key, ctx)}`);
  }
  if (d.github?.head) {
    did.sha = await looker(step.who).branchHead(d.github.head);
    log(`${step.id}: вершина ${d.github.head} - ${String(did.sha).slice(0, 7)}`);
  }
  if (d.github?.pr) {
    const p = d.github.pr;
    const gh = app(step.who);
    const base = p.base ?? 'main';
    const files: Record<string, string> = {};
    for (const e of p.files) {
      const path = fill(e.path, ctx);
      const edit = {
        path,
        ...(e.from ? { from: e.from } : {}),
        ...(e.replace ? { replace: e.replace.map((r) => ({ find: fill(r.find, ctx), with: fill(r.with, ctx) })) } : {}),
        ...(e.append !== undefined ? { append: fill(e.append, ctx) } : {}),
      };
      files[path] = applyEdit(await gh.read(path, base), edit, asset);
    }
    const pr = await gh.openPull({ base, branch: fill(p.branch, ctx), title: fill(p.title, ctx), body: fill(p.body, ctx), files });
    did.pr = pr;
    log(`${step.id}: ${gh.slug} - PR ${pr.number}: ${pr.url}`);
  }
  if (d.github?.merge) {
    const n = Number(fill(d.github.merge.pr, ctx));
    await app(step.who).merge(n, fill(d.github.merge.title, ctx));
    log(`${step.id}: PR ${n} слит`);
  }
  if (d.github?.comment) {
    const n = Number(fill(d.github.comment.pr, ctx));
    await app(step.who).comment(n, fill(d.github.comment.text, ctx));
    log(`${step.id}: замечание в PR ${n}`);
  }
  if (d.github?.closePr) {
    const n = Number(fill(d.github.closePr.pr, ctx));
    await app(step.who).closePull(n);
    log(`${step.id}: PR ${n} закрыт без слияния`);
  }
  if (d.github?.tag) {
    const name = nextVersion(
      (await app(step.who).tags()).map((x) => x.name),
      d.github.tag.bump,
    );
    did.tag = name;
    did.sha = await app(step.who).tag(name);
    log(`${step.id}: тег ${name}`);
  }
  for (const h of d.http === undefined ? [] : Array.isArray(d.http) ? d.http : [d.http]) {
    const r = await fetch(fill(h.url, ctx), {
      method: h.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      body: h.body === undefined ? undefined : fill(JSON.stringify(h.body), ctx),
    });
    const text = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = text.slice(0, 500);
    }
    did.status = r.status;
    did.json = json;
    if (h.as) did[h.as] = { status: r.status, json };
    log(`${step.id}: ${h.method ?? 'GET'} ${fill(h.url, ctx)} - ${r.status}`);
  }
  if (d.webhook) {
    // Вебхук без учётки: самозванец пишет от чужого имени. Адрес вебхука канала - только из
    // .state/discord-webhook-<канал>.env (scripts/film-webhook-add.sh).
    const url = env(`discord-webhook-${d.webhook.channel}.env`).DISCORD_WEBHOOK_URL;
    if (!url) throw new Error(`нет DISCORD_WEBHOOK_URL в discord-webhook-${d.webhook.channel}.env`);
    const r = await fetch(`${url}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: fill(d.webhook.text, ctx), username: d.webhook.username }),
    });
    if (!r.ok) throw new Error(`Discord вебхук: ${r.status}`);
    did.message = { id: ((await r.json()) as { id: string }).id, channel: d.webhook.channel };
    log(`${step.id}: вебхук "${d.webhook.username}" пишет в #${d.webhook.channel}`);
  }
  // Задача закрывается после PR: закрытие задачи на решение запускает повторную сверку, и она
  // должна видеть уже слитое решение.
  if (d.close) {
    await as(step.who).tracker.close(fill(d.close.key, ctx));
    log(`${step.id}: ${fill(d.close.key, ctx)} закрыта`);
  }
  if (d.decision) log(`${step.id}: РЕШЕНИЕ ЧЕЛОВЕКА - ${fill(d.decision, ctx)}`);
}

// Провал шага: фабрика сказала "не вышло", агент упал, страж красный там, где нужен зелёный.
class StepFailed extends Error {}

const seen = async (who: string, key: string) => {
  for (const l of [FILM_LABEL, take]) await reader(who).tracker.addLabel(key, l);
};
// Страница Confluence, которую фабрика создала в дубле (например, заметки о выпуске), тоже получает
// метки film и имени дубля: сброс уведёт её в архив вместе со страницами съёмки.
const seenPage = async (who: string, url: string | undefined) => {
  const id = url && /\/wiki\/spaces\/[^/]+\/pages\/(\d+)/.exec(url)?.[1];
  const wiki = reader(who).wiki;
  if (!id || !wiki) return;
  for (const l of [FILM_LABEL, take]) await wiki.addLabel(id, l);
};

// Задача Jira, которой ждёт шаг: найдена - в итог шага (issue, а для deps - ещё issues).
async function jiraDone(step: Step, did: Record<string, unknown>): Promise<boolean> {
  const w = step.wait?.jira;
  if (!w) return true;
  const tracker = reader(step.who).tracker;
  const label = w.label ? fill(w.label, ctx) : undefined;
  const fail = w.fail === undefined ? LABELS.agentFailed : w.fail;
  const since = Number(did.since ?? t0);
  // Подходит ли задача: метки состояния, закрытие; метка провала - провал шага.
  const fits = async (i: { key: string; labels: string[]; state: string }) => {
    const other = foreignTake(i.labels, take);
    if (other) throw new StepFailed(`${step.id}: ${i.key} - объект прошлого дубля ${other}: мир дубля не свой`);
    if (fail && anyOf(i.labels, fail)) throw new StepFailed(`${step.id}: у ${i.key} метка провала ${fail}`);
    if (w.key && label && !anyOf(i.labels, label)) return false;
    if (w.has && !anyOf(i.labels, fill(w.has, ctx))) return false;
    if (w.state === 'closed' && i.state !== 'closed') return false;
    if (w.fromFactory) {
      // Новый комментарий не от участников съёмки - комментарий фабрики (текст и первая ссылка - в итог).
      const c = (await tracker.listComments(i.key)).find((x) => Date.parse(x.createdAt) >= since - 5000 && !ours.has(x.author));
      if (!c) return false;
      did.comment = { text: c.body, url: firstUrl(c.body) };
    }
    return true;
  };
  let found: { key: string; url: string; title: string }[] = [];
  // Все зависимости задачи (deps), не только отобранные: сброс стенда закроет и остальные задачи нарезки.
  const deps: string[] = [];
  const match = w.match ? new RegExp(fill(w.match, ctx), 'i') : undefined;
  if (w.key) {
    const i = await tracker.getIssue(fill(w.key, ctx));
    if (await fits(i)) found = [i];
  } else if (w.deps) {
    for (const k of await tracker.listDependencies(fill(w.deps, ctx))) {
      deps.push(k);
      const i = await tracker.getIssue(k);
      if ((!label || anyOf(i.labels, label)) && (!match || match.test(i.title)) && (await fits(i))) found.push(i);
    }
    if (found.length < (w.count ?? 1)) found = [];
  } else if (label) {
    // Сначала новые; с match - первая задача с подходящим заголовком.
    for (const i of await tracker.listIssues({ label, state: w.open ? 'open' : 'all', limit: 20 })) {
      if (match && !match.test(i.title)) continue;
      if (await fits(i)) {
        found = [i];
        break;
      }
    }
  }
  if (!found.length) return false;
  for (const k of new Set([...found.map((i) => i.key), ...deps])) await seen(step.who, k);
  did.issue = { key: found[0]?.key, url: found[0]?.url, title: found[0]?.title };
  if (w.deps) did.issues = found.map((i) => ({ key: i.key, url: i.url, title: i.title }));
  return true;
}

// PR, которого ждёт шаг: по номеру или по началу имени ветки; со статусом - когда статус готов.
async function githubDone(step: Step, did: Record<string, unknown>): Promise<boolean> {
  const w = step.wait?.github;
  if (!w) return true;
  const gh = looker(step.who);
  const head = w.head ? fill(w.head, ctx) : undefined;
  const p = w.pr ? await gh.getPull(Number(fill(w.pr, ctx))) : (await gh.listPulls('open')).find((x) => head && x.head.startsWith(head));
  if (!p) return false;
  // Доработка: вердикт прошлого коммита не в счёт - ждём новый коммит агента.
  if (w.newer && p.sha === fill(w.newer, ctx)) return false;
  if (w.status) {
    const s = (await gh.statuses(p.sha)).find((x) => x.key === w.status);
    const o = statusOutcome(s?.state, w.success);
    if (o === 'fail') throw new StepFailed(`${step.id}: PR ${p.number} - ${w.status} ${s?.state}: ${s?.description}`);
    if (o === 'wait') return false;
    did.status = { key: s?.key, state: s?.state, description: s?.description };
  }
  did.pr = { number: p.number, url: p.url, head: p.head, sha: p.sha };
  return true;
}

// Ответ фабрики на сообщение шага - у любого шага со своим сообщением: сбой команды - провал шага
// сразу; просьба повторить команду или молчание дольше retry - реплика ещё раз (не больше трёх).
async function ownReply(step: Step, did: Record<string, unknown>): Promise<boolean> {
  const mine = did.message as { id: string; channel: string } | undefined;
  if (!mine) return false;
  const w = step.wait?.discord;
  const msgs = await eye.after(channelId(mine.channel), mine.id);
  const asked = msgs.some((m) => m.message_reference?.message_id === mine.id && (factory() ? m.author.id === factory() : m.author.bot));
  const r = replyTo(msgs, mine.id, factory());
  const since = Date.now() - Number(did.said ?? t0);
  const every = (w?.retry ?? 60) * 1000;
  if ((asked && !r && since > every) || (!asked && w?.retry && since > every)) {
    const most = w?.retries ?? 3;
    if (Number(did.says ?? 1) >= most) throw new StepFailed(`${step.id}: фабрика не приняла команду с ${most} попыток`);
    log(`${step.id}: ${asked ? 'фабрика просит повторить команду' : 'ответа нет'} - реплика ещё раз`);
    await say(step, did);
    return false;
  }
  if (!r) return false;
  learn(r.author.id);
  const o = replyOutcome(r.content, w ?? {});
  if (o.kind === 'fail') throw new StepFailed(`${step.id}: фабрика ответила: ${o.why.slice(0, 300)}`);
  did.reply = { text: r.content, url: firstUrl(r.content) };
  return true;
}

// Discord: ответ фабрики на сообщение шага или её объявление с идентификатором дубля.
async function discordDone(step: Step, did: Record<string, unknown>, replied: boolean): Promise<boolean> {
  const w = step.wait?.discord;
  if (!w) return true;
  if (w.reply) return replied;
  if (!w.mentions) return false;
  const mine = did.message as { id: string } | undefined;
  const f = factory();
  if (!f) throw new Error(`${step.id}: объявление ждётся, а бот фабрики ещё не известен (film.factory.discord)`);
  const anchor =
    (w.after ? (ctx[w.after] as { message?: { id: string } } | undefined)?.message?.id : mine?.id) ?? snowflake(Number(did.since ?? t0));
  const n = notice(await eye.after(channelId(w.channel), anchor), f, fill(w.mentions, ctx));
  if (!n) return false;
  did.reply = { text: n.content, url: firstUrl(n.content) };
  return true;
}

async function waitFor(step: Step): Promise<void> {
  const w = step.wait;
  if (!w) return;
  const deadline = Date.now() + (w.timeout ?? 300) * 1000;
  const did = (ctx[step.id] ?? {}) as Record<string, unknown>;
  ctx[step.id] = did;
  const done = { discord: !w.discord, jira: !w.jira, github: !w.github };
  let replied = false;
  while (Date.now() < deadline) {
    // Сбой сети или площадки при проверке итога не обрывает дубль: проверка повторяется. Провал
    // шага - сразу, с причиной, а не через весь срок ожидания.
    try {
      if (!replied) replied = await ownReply(step, did);
      if (!done.discord && (await discordDone(step, did, replied))) {
        await seenPage(step.who, (did.reply as { url?: string } | undefined)?.url);
        done.discord = true;
        log(`${step.id}: итог в Discord получен`);
      }
      if (!done.jira && (await jiraDone(step, did))) {
        done.jira = true;
        log(`${step.id}: задача ${(did.issue as { key: string }).key}`);
      }
      if (!done.github && (await githubDone(step, did))) {
        done.github = true;
        const s = did.status as { key: string; state: string } | undefined;
        log(`${step.id}: PR ${(did.pr as { number: number }).number}${s ? ` - ${s.key}: ${s.state}` : ''}`);
      }
    } catch (e) {
      if (e instanceof StepFailed) throw e;
      log(`${step.id}: проверка итога не вышла (${(e as Error).message.split('\n')[0]}) - повтор`);
    }
    if (done.discord && done.jira && done.github) return;
    await sleep(5000);
  }
  throw new Error(`${step.id}: итог не наступил за ${w.timeout ?? 300} с`);
}

// Плавная прокрутка до конца за secs секунд: страница или её самая длинная прокручиваемая часть
// (у Jira прокручивается не окно, а внутренняя колонка).
async function scrollToEnd(secs: number): Promise<void> {
  const all = [document.scrollingElement, ...document.querySelectorAll('*')].filter((e): e is Element => !!e);
  const box = all
    .filter(
      (e) =>
        e.scrollHeight - e.clientHeight > 40 && (e === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(e).overflowY)),
    )
    .sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
  if (!box) return;
  const from = box.scrollTop;
  const to = box.scrollHeight - box.clientHeight;
  const frames = Math.max(1, Math.round(secs * 30));
  for (let i = 1; i <= frames; i++) {
    const k = i / frames;
    box.scrollTop = from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
    await new Promise((r) => setTimeout(r, 1000 / 30));
  }
}

// Вход камеры для кадра: свой у кадра (shot.login), иначе свой у персонажа (scripts/camera-login.sh),
// иначе общий из film.browsers. Страница Atlassian без входа персонажа не снимается чужой сессией.
function loginFor(step: Step, shot: NonNullable<Step['show']>[number]): string | undefined {
  const who = film.personas[shot.who];
  if (shot.login) return join(state, film.browsers?.[shot.login] ?? '');
  const own = who?.atlassian ? join(state, `camera/atlassian-${who.atlassian}.json`) : undefined;
  if (own && existsSync(own)) return own;
  const url = shot.url ? fill(shot.url, ctx) : '';
  if (who?.kind === 'ai' && /atlassian\.net/.test(url))
    throw new Error(`${step.id}: нет входа камеры под ${shot.who} (scripts/camera-login.sh ${who.atlassian})`);
  return who?.browser ? join(state, film.browsers?.[who.browser] ?? '') : undefined;
}

// Баннер согласия на куки у Atlassian закрывает верх кадра. Выбор хранится у учётки: один раз
// "только необходимые" - и у персонажа баннера больше нет. Камера закрывает баннер, если он всё же
// появился (новая учётка): кнопка оживает не сразу, поэтому клик - через секунду, итог - когда
// баннер скрылся. Ждёт только на сайтах Atlassian, чтобы не тянуть кадры других сайтов.
async function dismissConsent(page: Page): Promise<void> {
  if (!/(atlassian\.net|bitbucket\.org)$/.test(new URL(page.url()).hostname)) return;
  const b = page.getByRole('button', { name: /^(Только необходимые|Only necessary)$/ }).first();
  if (
    !(await b.waitFor({ timeout: 2000 }).then(
      () => true,
      () => false,
    ))
  )
    return;
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1000);
    await b.click().catch(() => {});
    if (
      await b.waitFor({ state: 'hidden', timeout: 4000 }).then(
        () => true,
        () => false,
      )
    )
      return;
  }
  log(`баннер согласия не закрылся: ${page.url()}`);
}

async function shoot(browser: Browser, step: Step): Promise<void> {
  for (const [n, shot] of (step.show ?? []).entries()) {
    const who = film.personas[shot.who];
    if (!who) throw new Error(`нет участника ${shot.who}`);
    const login = loginFor(step, shot);
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: 'ru-RU',
      ...(login && existsSync(login) ? { storageState: login } : {}),
      recordVideo: { dir: join(out, 'raw'), size: { width: 1280, height: 720 } },
    });
    await context.addInitScript(badge, { name: who.name, ai: who.kind === 'ai' });
    if (shot.clockDays) await context.clock.install({ time: new Date(Date.now() + shot.clockDays * 86_400_000) });
    const page = await context.newPage();
    page.on('dialog', (d) => void d.accept()); // подтверждения на стенде - да
    if (n === 0 && step.chapter) {
      await page.setContent(chapterHtml(step.chapter, step.note ?? ''));
      await page.waitForTimeout(2500);
    }
    if (shot.card) await page.setContent(chapterHtml(fill(shot.card.title, ctx), fill(shot.card.note ?? '', ctx)));
    else {
      await page.goto(fill(shot.url ?? '', ctx), { waitUntil: 'domcontentloaded' });
      await dismissConsent(page);
    }
    if (shot.focus) {
      // Комментарий может появиться позже загрузки страницы: нет текста - страница перезагружается раз.
      const text = fill(shot.focus, ctx);
      const visible = () => page.getByText(text).first().waitFor({ timeout: 15_000 });
      const ok = await visible()
        .then(() => true)
        .catch(async () => {
          await page.reload({ waitUntil: 'domcontentloaded' });
          return visible()
            .then(() => true)
            .catch(() => false);
        });
      if (!ok) log(`${step.id}: нет текста "${shot.focus}" на экране`);
      await page
        .getByText(text)
        .first()
        .scrollIntoViewIfNeeded()
        .catch(() => {});
    }
    // Действия на странице: нет элемента - кадр продолжается, а режиссёр называет пропуск в журнале.
    for (const a of shot.play ?? []) {
      try {
        if ('click' in a) await page.getByText(fill(a.click, ctx)).first().click({ timeout: 10_000 });
        if ('fill' in a) await page.getByLabel(fill(a.fill.label, ctx)).first().fill(fill(a.fill.value, ctx), { timeout: 10_000 });
        if ('press' in a) await page.keyboard.press(a.press);
      } catch (e) {
        log(`${step.id}: действие ${JSON.stringify(a)} не вышло: ${(e as Error).message.split('\n')[0]}`);
      }
      await page.waitForTimeout('wait' in a ? a.wait * 1000 : 800);
    }
    if (shot.scroll) await page.evaluate(scrollToEnd, shot.scroll);
    await page.waitForTimeout((shot.seconds ?? 6) * 1000);
    const video = page.video();
    await context.close();
    const file = `${step.id}-${n + 1}-${shot.who}.webm`;
    await video?.saveAs(join(out, file));
    clips.push({
      step: step.id,
      chapter: step.chapter ?? '',
      who: who.name,
      caption: fill(shot.caption, ctx),
      file,
      at: new Date().toISOString(),
    });
    log(`${step.id}: кадр ${file}`);
  }
}

// Куки сохранённого входа камеры для адреса - заголовок Cookie (в журнал не идут).
function cookieHeader(file: string, url: string): string {
  const host = new URL(url).hostname;
  const s = JSON.parse(readFileSync(file, 'utf8')) as { cookies: { name: string; value: string; domain: string }[] };
  return s.cookies
    .filter((c) => host === c.domain.replace(/^\./, '') || host.endsWith(c.domain.startsWith('.') ? c.domain : `.${c.domain}`))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

// Готовность мира к дублю - до первого действия и только чтением: стенд выложен с вершины main, нет
// открытых PR и задач прошлых дублей, нет их страниц вне архива (объект дубля - takeObject), нет
// нерешённых сбоев стенда, входы камеры действуют и принадлежат своим персонажам. Состояние фабрики
// изнутри (раннер, приостановленные сценарии) съёмке не видно - это видимый выход фабрики будущего
// (РП 31).
async function preflight(): Promise<string[]> {
  const out: string[] = [];
  const gh = appOf(camera.github);
  const head = await gh.branchHead('main');
  let deploy: string | undefined;
  for (let i = 0; i < 12 && head; i++) {
    deploy = (await gh.statuses(head)).find((s) => s.key === 'factory/deploy')?.state;
    if (deploy === 'success') break;
    await sleep(10_000);
  }
  if (deploy !== 'success') out.push(`стенд: вершина main ${head?.slice(0, 7)} не выложена (factory/deploy: ${deploy ?? 'нет'})`);
  for (const p of await gh.listPulls('open'))
    if (/^(agent|film|factory\/rule-)/.test(p.head)) out.push(`GitHub: открыт PR ${p.number} (${p.head}) прошлого дубля`);
  const { tracker, wiki } = atlassianOf(camera.atlassian);
  const lead = await tracker.owner();
  if (!lead) out.push('Jira: не узнать руководителя проекта - задачи прошлых дублей не отличить от базы');
  for (const i of lead ? await tracker.openIssues() : []) {
    if (!takeObject(i, lead)) continue;
    // Поиск Jira отстаёт от записи: задача, только что закрытая сбросом, проверяется по ключу.
    if ((await tracker.getIssue(i.key)).state === 'open') out.push(`Jira: открыта задача ${i.key} прошлого дубля`);
  }
  if (wiki) {
    // Поиск отстаёт от записи: страница, которую сброс только что увёл в архив, может ещё числиться
    // вне его - перепроверка до минуты.
    const owner = await wiki.owner();
    if (!owner) out.push('Confluence: не узнать автора главной страницы - страницы прошлых дублей не отличить от базы');
    const stray = async () => (owner ? (await wiki.pagesOutside(ARCHIVE_PAGE)).filter((p) => takeObject(p, owner)) : []);
    let pages = await stray();
    for (let i = 0; i < 6 && pages.length; i++) {
      await sleep(10_000);
      pages = await stray();
    }
    for (const p of pages) out.push(`Confluence: страница прошлого дубля вне архива "${p.title}"`);
  } else out.push(`Confluence: у учётки камеры ${camera.atlassian} нет ключа Confluence - страницы прошлых дублей не проверить`);
  const g = film.world?.glitchtip;
  if (g && existsSync(join(state, 'glitchtip.token'))) {
    const token = readFileSync(join(state, 'glitchtip.token'), 'utf8').trim();
    const r = await fetch(`${g.url}/api/0/projects/${g.org}/${g.project}/issues/?query=${encodeURIComponent('is:unresolved')}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    const n = r.ok ? ((await r.json()) as unknown[]).length : -1;
    if (n !== 0) out.push(`GlitchTip: ${n < 0 ? `нет ответа (${r.status})` : `нерешённых сбоев стенда ${n}`}`);
  } else if (g) out.push('GlitchTip: нет .state/glitchtip.token - сбои прошлых дублей не проверить');
  // Входы камеры: персонажи в кадрах Atlassian - свои и живые, входы на сайты - живые.
  const shots = film.steps.flatMap((s) => s.show ?? []);
  for (const id of new Set(shots.map((s) => s.who))) {
    const who = film.personas[id];
    if (who?.kind !== 'ai' || !who.atlassian) continue;
    const file = join(state, `camera/atlassian-${who.atlassian}.json`);
    if (!existsSync(file)) {
      out.push(`камера: нет входа под ${id} (scripts/camera-login.sh ${who.atlassian})`);
      continue;
    }
    const site = env(`atlassian-${who.atlassian}.env`).ATLASSIAN_SITE ?? '';
    const r = await fetch(`${site}/rest/api/3/myself`, { headers: { cookie: cookieHeader(file, site), accept: 'application/json' } });
    const me = r.ok ? ((await r.json()) as { accountId?: string }).accountId : undefined;
    if (!me) out.push(`камера: вход под ${id} не действует (scripts/camera-login.sh ${who.atlassian})`);
    else if (who.jira && me !== who.jira) out.push(`камера: вход под ${id} - чужая учётка ${me}`);
  }
  for (const shot of shots.filter((s) => s.login)) {
    const file = join(state, film.browsers?.[shot.login ?? ''] ?? '');
    if (!existsSync(file)) {
      out.push(`камера: нет входа ${shot.login} (scripts/camera-login.sh ${shot.login} АДРЕС)`);
      continue;
    }
    const check =
      shot.login === 'bitbucket'
        ? 'https://bitbucket.org/!api/2.0/user'
        : g && shot.url?.startsWith(g.url)
          ? `${g.url}/_allauth/browser/v1/auth/session`
          : undefined;
    if (!check) continue;
    const r = await fetch(check, { headers: { cookie: cookieHeader(file, check), accept: 'application/json' } });
    if (!r.ok) out.push(`камера: вход ${shot.login} не действует (scripts/camera-login.sh ${shot.login} АДРЕС)`);
  }
  return [...new Set(out)];
}

// Новый дубль начинается с проверки готовности мира; --preflight - только проверка, без дубля.
if (process.argv.includes('--preflight') || !resumed) {
  const problems = await preflight();
  if (problems.length) {
    const text = `мир не готов к дублю:\n${problems.map((p) => `- ${p}`).join('\n')}`;
    if (process.argv.includes('--preflight')) {
      console.log(text);
      process.exit(1);
    }
    throw new Error(text);
  }
  log('мир готов к дублю');
  if (process.argv.includes('--preflight')) process.exit(0);
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const step of film.steps) {
    const named = only?.includes(step.id);
    if (only && !named) continue;
    // Продолжение дубля: сделанный шаг не повторяется, если его не назвали явно.
    if (!only && (ctx[step.id] as { done?: boolean } | undefined)?.done) continue;
    log(`== ${step.id}${step.chapter ? `: ${step.chapter}` : ''}`);
    await act(step);
    await waitFor(step);
    await shoot(browser, step);
    (ctx[step.id] as Record<string, unknown>).done = true;
    manifest();
  }
} finally {
  await browser.close();
  // Журнал дубля: шаги, клипы, ссылки на задачи и страницы - без ключей и куки.
  manifest();
  log(`манифест: ${join(out, 'manifest.json')}`);
}
