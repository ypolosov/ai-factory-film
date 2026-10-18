import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { type Cuts, checkCuts, clipStart, cutHash, freshness, type Publication, partTiming, takeObjects, wrap } from '../src/cuts.ts';
import type { Film } from '../src/script.ts';

const root = new URL('../', import.meta.url);
const film = parse(readFileSync(new URL('film/film.yml', root), 'utf8')) as Film;
const real = parse(readFileSync(new URL('film/cuts.yml', root), 'utf8')) as Cuts;

// Клипы, которые снимает сценарий: кадры шага (шаг-номер-участник) и чат шага с Discord.
const scripted = new Set(
  film.steps.flatMap((s) => [
    ...(s.show ?? []).map((sh, i) => `${s.id}-${i + 1}-${sh.who}`),
    ...(s.do?.discord || s.do?.webhook || s.wait?.discord ? [`${s.id}-chat`] : []),
  ]),
);

// Слайды нарезок - картинки film/slides/<имя>.png.
const slideDir = new URL('film/slides/', root);
const slides = new Set(
  existsSync(slideDir)
    ? readdirSync(slideDir)
        .filter((f) => f.endsWith('.png'))
        .map((f) => f.slice(0, -4))
    : [],
);

describe('нарезки журнала дубля', () => {
  it('настоящие нарезки цельны: клипы снимает сценарий, слайды лежат в film/slides, план укладывается в предел', () => {
    expect(checkCuts(real, scripted, slides)).toEqual([]);
    expect(Object.keys(real.cuts)).toEqual(expect.arrayContaining(['investor', 'teaser', 'b2c']));
  });

  it('нарезка с чужим клипом, без длительности или длиннее предела - ошибка', () => {
    const cuts: Cuts = {
      voice: 'v',
      cuts: {
        x: {
          title: 't',
          audience: 'a',
          max: 20,
          parts: [
            { clip: 'nope', seconds: 0 },
            { clip: 'ok', seconds: 30 },
          ],
        },
      },
    };
    expect(checkCuts(cuts, new Set(['ok']))).toEqual([
      'x: клипа nope нет в журнале дубля',
      'x: у nope нет длительности',
      'x: по плану 44 с - больше предела 20 с',
    ]);
  });

  it('часть - клип или слайд, не оба и не ни одного; слайд должен лежать в film/slides', () => {
    const cuts: Cuts = {
      voice: 'v',
      cuts: {
        x: {
          title: 't',
          audience: 'a',
          max: 60,
          parts: [
            { slide: 'roles', seconds: 5 },
            { slide: 'nope', seconds: 5 },
            { clip: 'ok', slide: 'roles', seconds: 5 },
            { seconds: 5 },
          ],
        },
      },
    };
    expect(checkCuts(cuts, new Set(['ok']), new Set(['roles']))).toEqual([
      'x: слайда nope нет в film/slides',
      'x: у ok должен быть либо клип, либо слайд',
      'x: у части без клипа должен быть либо клип, либо слайд',
    ]);
  });

  it('карточка главы пропускается в первом клипе шага с главой; голос не обрывается', () => {
    expect(clipStart(true)).toBe(2.5);
    expect(clipStart(false)).toBe(0);
    expect(clipStart(true, 0)).toBe(0);
    expect(clipStart(true, -6, 40)).toBe(34);
    expect(clipStart(false, -6, 4)).toBe(0);
    expect(partTiming(10, 30, 2.5, 4)).toEqual({ video: 10, total: 10 });
    expect(partTiming(10, 30, 0, 12)).toEqual({ video: 10, total: 12.6 });
    expect(partTiming(10, 6, 2.5, 0)).toEqual({ video: 3.5, total: 3.5 });
  });

  it('что сделано в прогоне - объекты дубля, без старых объектов из ответов фабрики', () => {
    const j = 'https://x.atlassian.net/browse/DRAW-';
    const g = 'https://github.com/o/r/pull/';
    const ctx = {
      take: 'take-1017-1438',
      story: { page: { id: '9', url: 'https://x.atlassian.net/wiki/spaces/D/pages/9' }, issue: { key: 'DRAW-82', url: `${j}82` } },
      slice: { issues: [{ url: `${j}84` }, { url: `${j}85` }] },
      adr: { pr: { number: 82, url: `${g}82` } },
      rules: { reply: { url: `${g}88` } },
      released: { reply: { url: 'https://x.atlassian.net/wiki/spaces/D/pages/5/v1.4.0' } },
      account: { reply: { url: `${g}1` } },
      librarian: { reply: { url: 'https://github.com/o/r/blob/abc/docs/glossary.md' } },
    };
    expect(takeObjects(ctx)).toEqual({ issues: ['DRAW-82', 'DRAW-84', 'DRAW-85'], prs: [82, 88], pages: ['9', '5'] });
  });

  it('субтитр переносится по словам', () => {
    expect(wrap('раз два три четыре', 9)).toBe('раз два\nтри\nчетыре');
    expect(wrap('  одно  ', 9)).toBe('одно');
  });

  it('страж свежести: новый сценарий или фабрика - новый дубль; другая нарезка - перевыпуск из журнала', () => {
    const cut = real.cuts.teaser;
    if (!cut) throw new Error('нет нарезки teaser');
    const h = cutHash(cut, real.voice);
    expect(cutHash({ ...cut, max: 61 }, real.voice)).not.toBe(h);
    // Картинка слайда входит в отпечаток: новый слайд - перевыпуск; чужой слайд отпечаток не меняет.
    const withSlide = { ...cut, parts: [{ slide: 'roles', seconds: 5 }, ...cut.parts] };
    expect(cutHash(withSlide, real.voice, { roles: 'a' })).not.toBe(cutHash(withSlide, real.voice, { roles: 'b' }));
    expect(cutHash(cut, real.voice, { roles: 'b' })).toBe(h);
    const pub: Publication = {
      cut: 'teaser',
      file: 'teaser.mp4',
      take: 't1',
      script: 's1',
      factory: 'f1',
      cuts: h,
      seconds: 50,
      built: '',
    };
    const now = { take: 't1', cuts: h, script: 's1', factory: 'f1' };
    const j = { script: 's1', factory: 'f1' };
    expect(freshness('teaser', pub, now, j)).toEqual({ cut: 'teaser', ok: true, newTake: false, reasons: [] });
    expect(freshness('teaser', pub, { ...now, script: 's2' }, j)).toMatchObject({ ok: false, newTake: true });
    expect(freshness('teaser', pub, { ...now, factory: 'f2' }, j)).toMatchObject({ ok: false, newTake: true });
    expect(freshness('teaser', pub, { ...now, cuts: 'x' }, j)).toEqual({
      cut: 'teaser',
      ok: false,
      newTake: false,
      reasons: ['нарезка изменилась - перевыпуск из журнала'],
    });
    expect(freshness('teaser', undefined, now, j).reasons).toEqual(['ролик не выпущен']);
  });
});
