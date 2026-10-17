import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { knownLabel, REPLIES } from '../src/contract.ts';
import {
  anyOf,
  applyEdit,
  asksRetry,
  type ChatMessage,
  chapterHtml,
  checkFilm,
  type Film,
  fill,
  firstUrl,
  foreignTake,
  nextVersion,
  notice,
  parseEnv,
  replyOutcome,
  replyTo,
  snowflake,
  statusOutcome,
  takeKey,
  takeName,
} from '../src/script.ts';

const root = new URL('../', import.meta.url);
const real = parse(readFileSync(new URL('film/film.yml', root), 'utf8')) as Film;
const assets = (n: string) => existsSync(new URL(`film/film-assets/${n}`, root));
const camera = { discord: 'camera', atlassian: 'a', github: 'a' };

describe('сценарий съёмки', () => {
  it('файл ключей: ИМЯ=значение, комментарии и кавычки', () => {
    expect(parseEnv('# ключи\nA=1\nB="два"\n\nC=x=y\n')).toEqual({ A: '1', B: 'два', C: 'x=y' });
  });

  it('подстановки из итогов прошлых шагов: строчные и короткий коммит; неизвестная - ошибка', () => {
    const ctx = { story: { issue: { key: 'DRAW-14', url: 'https://x/DRAW-14' } }, e2e: { sha: '0123456789abcdef' } };
    expect(fill('!нарезка {story.issue.key}', ctx)).toBe('!нарезка DRAW-14');
    expect(fill('openspec/changes/{story.issue.key|lower}-x/', ctx)).toBe('openspec/changes/draw-14-x/');
    expect(fill('стенд ({e2e.sha|short})', ctx)).toBe('стенд (0123456)');
    expect(fill('{ "json": 1 }', ctx)).toBe('{ "json": 1 }');
    expect(() => fill('{story.page.url}', ctx)).toThrow('нет значения {story.page.url}');
  });

  it('ключ дубля - ЧЧММ из имени; метка другого дубля на объекте ожидания - чужой дубль', () => {
    expect(takeKey('take-1017-1013')).toBe('1013');
    expect(foreignTake(['film', 'take-1017-0930', 'needs-decision'], 'take-1017-1013')).toBe('take-1017-0930');
    expect(foreignTake(['film', 'take-1017-1013'], 'take-1017-1013')).toBeUndefined();
    expect(foreignTake(['incident'], 'take-1017-1013')).toBeUndefined();
  });

  it('имя дубля - по местному времени начала, годится в метку Jira и Confluence', () => {
    expect(takeName(new Date(2026, 9, 16, 9, 5))).toBe('take-1016-0905');
    expect(takeName(new Date(2026, 0, 2, 23, 59))).toMatch(/^take-[0-9]{4}-[0-9]{4}$/);
  });

  it('правка файла: заготовка, замены ровно одного вхождения, дописка в конец', () => {
    const asset = (n: string) => `заготовка ${n}`;
    expect(applyEdit('старое', { path: 'a.md', from: 'x.md' }, asset)).toBe('заготовка x.md');
    expect(applyEdit('a: 1\nb: 2\n', { path: 'c.yml', replace: [{ find: 'b: 2', with: 'b: 3' }] }, asset)).toBe('a: 1\nb: 3\n');
    expect(applyEdit('текст', { path: 'a.md', append: 'хвост' }, asset)).toBe('текст\nхвост\n');
    expect(applyEdit(undefined, { path: 'new.md', append: 'новый' }, asset)).toBe('новый\n');
    expect(() => applyEdit('x x', { path: 'a.md', replace: [{ find: 'x', with: 'y' }] }, asset)).toThrow('a.md: "x" встречается 2 раз');
    expect(() => applyEdit('x', { path: 'a.md', replace: [{ find: 'z', with: 'y' }] }, asset)).toThrow('a.md: "z" встречается 0 раз');
    expect(() => applyEdit(undefined, { path: 'a.md', replace: [{ find: 'z', with: 'y' }] }, asset)).toThrow('a.md: нет файла');
  });

  it('сценарий цел: участники и их учётки, подстановки из прошлых шагов, заготовки', () => {
    const film: Film = {
      title: 'т',
      camera,
      personas: { a: { name: 'A', kind: 'ai', discord: 'a', atlassian: 'a', github: 'a' }, b: { name: 'B', kind: 'ai' } },
      steps: [
        {
          id: 's1',
          who: 'a',
          do: { discord: { channel: 'к', text: '{s2.x}', file: 'макет.png' } },
          wait: { jira: { label: 'w-{s1.page.id}' } },
        },
        {
          id: 's2',
          who: 'b',
          do: { github: { merge: { pr: '{s1.pr.number}', title: '{take}' } } },
          show: [{ who: 'c', url: 'u', caption: 'к' }],
        },
        { id: 's3', who: 'b', do: { github: { pr: { branch: 'x', title: 't', body: 'b', files: [{ path: 'p', from: 'нет.md' }] } } } },
        { id: 's4', who: 'b', do: { comment: { key: 'K-1', text: 'т' } } },
      ],
    };
    expect(checkFilm(film, () => false)).toEqual([
      's1: {s2...} - не прошлый шаг',
      's1: нет заготовки макет.png',
      's2: у участника b нет приложения GitHub',
      's2: в кадре нет участника c',
      's3: у участника b нет приложения GitHub',
      's3: нет заготовки нет.md',
      's4: у участника b нет учётки Atlassian',
    ]);
  });

  it('итог ждётся по связи с объектом дубля: фраза, ответ без признака успеха, объявление без идентификатора - ошибка', () => {
    const film = {
      title: 'т',
      camera,
      personas: { a: { name: 'A', kind: 'ai', discord: 'a', atlassian: 'a', github: 'a' } },
      steps: [
        { id: 'p', who: 'a', do: { discord: { channel: 'к', text: 'x' } }, wait: { discord: { channel: 'к', contains: 'Готово' } } },
        { id: 'q', who: 'a', do: { discord: { channel: 'к', text: 'x' } }, wait: { discord: { channel: 'к', reply: true } } },
        {
          id: 'r',
          who: 'a',
          do: { discord: { channel: 'к', text: 'x' } },
          wait: { discord: { channel: 'к', reply: true, ok: 'нет-такого' } },
        },
        { id: 's', who: 'a', wait: { discord: { channel: 'к', reply: true, ok: 'daily' } } },
        { id: 't', who: 'a', wait: { discord: { channel: 'к', mentions: 'Собран тег', after: 'z' } } },
        { id: 'u', who: 'a', wait: { jira: { key: 'K-1', comment: 'Сделано', label: 'agent-done' } } },
        { id: 'v', who: 'a', wait: { github: { pr: '1', status: 'factory/lint' } } },
      ],
    } as unknown as Film;
    expect(checkFilm(film, () => true)).toEqual([
      'p: ожидание по фразе "Готово" - ждать ответ (reply) или идентификатор (mentions)',
      'p: ожидание в Discord без ответа (reply) и идентификатора (mentions)',
      'q: ответ ждётся, а какой ответ - успех (ok), не сказано',
      'r: ответа нет-такого нет в видимых выходах фабрики',
      's: ответ ждётся, а своего сообщения у шага нет',
      't: mentions "Собран тег" - без идентификатора дубля',
      't: after z - не прошлый шаг с сообщением',
      'u: ожидание по фразе "Сделано" в комментарии - ждать метку или закрытие',
      'u: метки agent-done нет в видимых выходах фабрики',
      'v: статуса factory/lint нет в видимых выходах фабрики',
    ]);
  });

  it('камера читает своими учётками: без camera - некому читать Discord, Jira и GitHub', () => {
    const film: Film = {
      title: 'т',
      personas: { a: { name: 'A', kind: 'ai', discord: 'a' } },
      steps: [
        {
          id: 's',
          who: 'a',
          do: { discord: { channel: 'к', text: 'x' } },
          wait: { discord: { channel: 'к', reply: true, ok: 'daily' }, jira: { key: 'K-1' }, github: { pr: '1' } },
        },
      ],
    };
    expect(checkFilm(film, () => true)).toEqual([
      's: Discord читает бот камеры - нет camera.discord',
      's: Jira читать некому - нет учётки у a и camera.atlassian',
      's: GitHub читать некому - нет приложения у a и camera.github',
    ]);
    expect(checkFilm({ ...film, camera: { discord: 'c', atlassian: 'нет', github: 'нет' } }, () => true)).toEqual([
      'camera.atlassian: нет участника с учёткой нет',
      'camera.github: нет участника с учёткой нет',
    ]);
  });

  it('настоящий сценарий цел и не ждёт ни одной фразы', () => {
    expect(checkFilm(real, assets)).toEqual([]);
    const text = readFileSync(new URL('film/film.yml', root), 'utf8');
    expect(text).not.toMatch(/contains:/);
    expect(text).not.toMatch(/comment: "/);
  });

  it('следующий выпуск - по последнему тегу vX.Y.Z; тегов нет - v1.0.0', () => {
    expect(nextVersion(['v1.0.0', 'demo-baseline', 'v1.2.3', 'v1.10.0'], 'minor')).toBe('v1.11.0');
    expect(nextVersion(['v1.0.0'], 'patch')).toBe('v1.0.1');
    expect(nextVersion(['demo-baseline'], 'minor')).toBe('v1.0.0');
  });

  it('метка времени Discord для "сообщения после": миллисекунды от эпохи Discord, сдвиг на 22 бита', () => {
    expect(snowflake(Date.UTC(2015, 0, 1))).toBe('0');
    expect(snowflake(1_420_070_400_000 + 1)).toBe('4194304');
  });

  it('карточка главы экранирует текст', () => {
    const html = chapterHtml('Стори <b>', 'шаг "2"');
    expect(html).toContain('Стори &lt;b&gt;');
    expect(html).toContain('шаг &quot;2&quot;');
  });
});

describe('итог шага по связи с объектом дубля', () => {
  const msg = (id: string, author: string, content: string, ref?: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    author: { id: author, bot: true },
    content,
    ...(ref ? { message_reference: { message_id: ref } } : {}),
    ...extra,
  });

  it('ответ фабрики - сообщение со ссылкой на сообщение шага, не просьба повторить и не чужой бот', () => {
    const msgs = [
      msg('2', 'factory', 'Сервис сейчас недоступен - повторите команду через минуту.', '1'),
      msg('3', 'other', 'Задачи заведены: DRAW-2.', '1'),
      msg('4', 'factory', 'Задачи заведены: DRAW-3.', '9'),
      msg('5', 'factory', 'Задачи заведены: DRAW-4.', '1'),
    ];
    expect(replyTo(msgs, '1', 'factory')?.id).toBe('5');
    expect(replyTo(msgs, '1')?.id).toBe('3');
    expect(replyTo([msg('6', 'hook', 'x', '1', { webhook_id: 'w' })], '1')).toBeUndefined();
  });

  it('объявление фабрики - не ответ, от фабрики, с идентификатором дубля', () => {
    const msgs = [
      msg('2', 'factory', 'Перезапустил CI PR 25 (abc1234): ci', '1'),
      msg('3', 'other', 'CI PR 25, ci: зелёный'),
      msg('4', 'factory', 'CI PR 24, ci: зелёный'),
      msg('5', 'factory', 'CI PR 25, ci: зелёный (попытка 2).'),
    ];
    expect(notice(msgs, 'factory', 'CI PR 25')?.id).toBe('5');
    expect(notice(msgs, 'factory', 'CI PR 26')).toBeUndefined();
  });

  it('ответ на команду: успех - по видимому выходу; иной ответ, сбой и отказ - провал; просьба повторить - повтор', () => {
    expect(replyOutcome('Задачи заведены: DRAW-2, DRAW-3.', { ok: 'slice-approved' })).toEqual({ kind: 'ok' });
    expect(replyOutcome('Задачи не заведены: нет нарезки', { ok: 'slice-approved' })).toEqual({
      kind: 'fail',
      why: 'Задачи не заведены: нет нарезки',
    });
    expect(replyOutcome('Образов v1.2.0 ещё нет в реестре. Повторите команду позже.', { ok: 'deploy-confirmed' })).toEqual({
      kind: 'retry',
    });
    expect(replyOutcome('Нельзя подтвердить выкладку: это решение ролей devops', { expect: 'refusal' })).toEqual({ kind: 'ok' });
    expect(replyOutcome('Выкладка v1.2.0 подтверждена (DevOps): стенд переходит на выпуск.', { expect: 'refusal' }).kind).toBe('fail');
    expect(replyOutcome('Не вышло: таймаут', {})).toEqual({ kind: 'fail', why: 'Не вышло: таймаут' });
    expect(replyOutcome('Нельзя утвердить нарезку: это решение ролей project-manager', {}).kind).toBe('fail');
    expect(replyOutcome('Сверяю макет DRAW-5', {})).toEqual({ kind: 'ok' });
    expect(replyOutcome('Перезапустил CI PR 25 (abc1234): ci', { ack: 'ci-started' })).toEqual({ kind: 'ok' });
  });

  it('просьба фабрики повторить команду отличается от ответа', () => {
    expect(asksRetry('Сервис сейчас недоступен - повторите команду через минуту.')).toBe(true);
    expect(asksRetry('Сверка макета DRAW-43: замечаний нет')).toBe(false);
  });

  it('статус фабрики: ждать, готово или провал там, где нужен зелёный', () => {
    expect(statusOutcome(undefined)).toBe('wait');
    expect(statusOutcome('pending', true)).toBe('wait');
    expect(statusOutcome('failure')).toBe('done');
    expect(statusOutcome('failure', true)).toBe('fail');
    expect(statusOutcome('success', true)).toBe('done');
  });

  it('метки через "|" и первая ссылка в тексте', () => {
    expect(anyOf(['agent', 'agent-review'], 'agent-running|agent-review')).toBe(true);
    expect(anyOf(['agent'], 'agent-running|agent-review')).toBe(false);
    expect(firstUrl('PR: https://github.com/o/r/pull/7).')).toBe('https://github.com/o/r/pull/7');
    expect(firstUrl('без ссылки')).toBeUndefined();
    expect(firstUrl('Источники: <https://github.com/o/r/blob/x/docs/a.md#раздел>, ещё')).toBe(
      'https://github.com/o/r/blob/x/docs/a.md#раздел',
    );
  });
});

describe('видимые выходы фабрики', () => {
  it('известные метки - из контракта, с подстановкой - по образцу', () => {
    expect(knownLabel('agent-failed')).toBe(true);
    expect(knownLabel('wiki-5046280')).toBe(true);
    expect(knownLabel('release-v1.2.0')).toBe(true);
    expect(knownLabel('agent:frontend')).toBe(true);
    expect(knownLabel('agent-done')).toBe(false);
  });

  it('у каждого успешного ответа в сценарии есть образец, и образцы различают ответы', () => {
    expect(REPLIES['slice-approved']?.test('Задачи заведены: DRAW-2.')).toBe(true);
    expect(REPLIES['slice-approved']?.test('Задачи не заведены: x')).toBe(false);
    expect(REPLIES['deploy-confirmed']?.test('Выкладка v1.2.0 подтверждена (DevOps): стенд переходит на выпуск.')).toBe(true);
  });
});

describe('съёмка - отдельная система', () => {
  // Файлы ключей фабрики: бот, Atlassian, токены GitHub цели, координатор. Съёмка их не читает.
  const factoryKeys = [
    /\bdiscord\.env\b/,
    /\batlassian\.env\b/,
    /atlassian-factory\.env/,
    /github-target\.env/,
    /coordinator\/[\w.-]+\.(token|env|json)/,
    /github-app-factory/,
  ];
  const files = (dir: string, ext: string) =>
    readdirSync(new URL(dir, root))
      .filter((f) => f.endsWith(ext))
      .map((f) => ({ f: `${dir}${f}`, text: readFileSync(new URL(`${dir}${f}`, root), 'utf8') }));

  it('ни код съёмки, ни её скрипты не берут ключей фабрики и не импортируют её код', () => {
    const found = [...files('src/', '.ts'), ...files('scripts/', '.sh')].flatMap(({ f, text }) =>
      factoryKeys.filter((k) => k.test(text)).map((k) => `${f}: ${k}`),
    );
    expect(found).toEqual([]);
    for (const { f, text } of files('src/', '.ts')) expect(text, f).not.toMatch(/from '\.\.\/(ports|coordinator)\//);
  });
});
