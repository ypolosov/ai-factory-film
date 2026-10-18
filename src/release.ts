// Выпуск роликов из журнала дубля (стадия 7 РП 30): по нарезкам film/cuts.yml - ролик на каждую
// нарезку с заставкой (дата прогона, ИИ-персонажи, версии), голосом edge-tts, субтитрами из текста
// голоса и итогом прогона; рядом - ссылки на задачи и PR для описания; журнал публикаций с отметкой
// версий (releases.json). --check - страж свежести, без сборки: новая версия сценария или фабрики -
// нужен новый дубль, другая нарезка - перевыпуск из журнала.
// Использование: node release.ts СЦЕНАРИЙ.yml НАРЕЗКИ.yml КАТАЛОГ_ДУБЛЯ КАТАЛОГ_ВЫПУСКА [--check] [--only нарезка,нарезка]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import {
  type Cut,
  type Cuts,
  checkCuts,
  clipStart,
  cutHash,
  freshness,
  INTRO_SECONDS,
  OUTRO_SECONDS,
  type Publication,
  partTiming,
  takeObjects,
  wrap,
} from './cuts.ts';
import type { Clip, Film, Plan } from './script.ts';
import { factoryMain, scriptVersionOf } from './version.ts';

const [filmPath = '', cutsPath = '', takeDir = '', out = ''] = process.argv.slice(2);
const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const only = flag('--only')?.split(',');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const TTS = '/opt/tts/bin/edge-tts';

const film = parse(readFileSync(filmPath, 'utf8')) as Film;
const spec = parse(readFileSync(cutsPath, 'utf8')) as Cuts;
type Journal = {
  title: string;
  take: string;
  started: string;
  runs?: { script: string; factory?: string; film?: string; target?: string }[];
  ctx: Record<string, unknown>;
  plans: Record<string, Plan>;
};
const journal = JSON.parse(readFileSync(join(takeDir, 'manifest.json'), 'utf8')) as Journal;
const run = journal.runs?.[0];
if (!run) throw new Error('в журнале дубля нет версий запуска (runs) - снят до журнала планов');

// Клипы журнала по имени: файл, шаг и первый ли это клип шага с главой (в нём карточка главы).
const clips = new Map<string, { clip: Clip; first: boolean }>();
for (const step of film.steps) {
  const plan = journal.plans[step.id];
  if (plan?.status !== 'done') continue;
  plan.clips.forEach((c, i) => {
    clips.set(c.file.replace(/\.[a-z0-9]+$/, ''), { clip: c, first: Boolean(step.chapter) && i === 0 });
  });
}
// Слайды - картинки film/slides/<имя>.png рядом с нарезками; отпечаток файла входит в отпечаток нарезки.
const slideDir = join(dirname(cutsPath), 'slides');
const slides = new Map<string, { file: string; hash: string }>();
for (const f of existsSync(slideDir) ? readdirSync(slideDir) : [])
  if (f.endsWith('.png'))
    slides.set(f.slice(0, -4), {
      file: join(slideDir, f),
      hash: createHash('sha256')
        .update(readFileSync(join(slideDir, f)))
        .digest('hex')
        .slice(0, 12),
    });
const slideHashes = Object.fromEntries([...slides].map(([k, v]) => [k, v.hash]));
const problems = checkCuts(spec, new Set(clips.keys()), new Set(slides.keys()));
if (problems.length) throw new Error(`нарезки:\n${problems.join('\n')}`);

mkdirSync(out, { recursive: true });
const pubFile = join(out, 'releases.json');
const pubs: Publication[] = existsSync(pubFile) ? (JSON.parse(readFileSync(pubFile, 'utf8')) as Publication[]) : [];
const names = Object.keys(spec.cuts).filter((n) => !only || only.includes(n));

// Страж свежести: сценарий и фабрика сейчас против версий дубля, нарезка против опубликованной.
if (process.argv.includes('--check')) {
  const now = { take: journal.take, script: scriptVersionOf(filmPath), factory: await factoryMain(film.factory?.repo) };
  const verdicts = names.map((n) =>
    freshness(
      n,
      pubs.find((p) => p.cut === n),
      { ...now, cuts: cutHash(spec.cuts[n] as Cut, spec.voice, slideHashes) },
      run,
    ),
  );
  for (const v of verdicts) console.log(`${v.ok ? 'свежий ' : 'устарел'} ${v.cut}${v.reasons.length ? `: ${v.reasons.join('; ')}` : ''}`);
  if (verdicts.some((v) => v.newTake)) console.log('нужен новый дубль');
  process.exit(verdicts.every((v) => v.ok) ? 0 : verdicts.some((v) => v.newTake) ? 3 : 1);
}

function run1(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}: ${(r.stderr || r.stdout || '').trim().slice(-600)}`);
  return r.stdout;
}
const length = (f: string) => Number(run1('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim());

// Голос фразы - edge-tts с повтором (служба иногда не отвечает); готовая фраза берётся из кеша.
function voice(text: string): string {
  const dir = join(out, '.tts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${createHash('sha256').update(`${spec.voice}\n${text}`).digest('hex').slice(0, 16)}.mp3`);
  if (existsSync(file)) return file;
  for (let i = 1; ; i++) {
    const r = spawnSync(TTS, ['--voice', spec.voice, '--text', text, '--write-media', `${file}.part`], { encoding: 'utf8' });
    if (r.status === 0 && existsSync(`${file}.part`)) {
      renameSync(`${file}.part`, file);
      return file;
    }
    if (i >= 3) throw new Error(`голос не получен: ${(r.stderr || '').trim().slice(-300)}`);
    spawnSync('sleep', [String(5 * i)]);
  }
}

const AUDIO = ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'];
const VIDEO = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30'];
// Субтитр над плашкой участника; на слайде - мельче и у самого низа: текст слайда выше.
const subtitle = (file: string, size = 28, bottom = 78) =>
  `drawtext=fontfile=${FONT}:textfile=${file}:fontsize=${size}:fontcolor=white:line_spacing=8:box=1:boxcolor=0x14111F@0.82:boxborderw=14:x=(w-text_w)/2:y=h-text_h-${bottom}`;

// Часть ролика: кусок клипа, голос поверх (последний кадр держится до конца фразы), субтитр - над
// плашкой участника в нижнем углу кадра.
function part(work: string, n: number, src: string, from: number, video: number, total: number, say?: string): string {
  const f = join(work, `${String(n).padStart(3, '0')}.mp4`);
  const sub = join(work, `${n}.txt`);
  if (say) writeFileSync(sub, wrap(say));
  const vf = [
    'scale=1280:720',
    'fps=30',
    ...(total > video ? [`tpad=stop_mode=clone:stop_duration=${(total - video).toFixed(2)}`] : []),
    ...(say ? [subtitle(sub)] : []),
  ].join(',');
  const audio = say ? ['-i', voice(say)] : ['-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo'];
  run1('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-ss',
    from.toFixed(2),
    '-t',
    video.toFixed(2),
    '-i',
    src,
    ...audio,
    '-filter_complex',
    `[0:v]${vf}[v];[1:a]aresample=48000,apad[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-t',
    total.toFixed(2),
    ...VIDEO,
    ...AUDIO,
    f,
  ]);
  return f;
}

// Слайд: картинка держится, пока звучит голос; субтитр - как у клипов.
function slide(work: string, n: number, img: string, seconds: number, say?: string): string {
  const f = join(work, `${String(n).padStart(3, '0')}.mp4`);
  const sub = join(work, `${n}.txt`);
  if (say) writeFileSync(sub, wrap(say, 84));
  const v = say ? voice(say) : undefined;
  const total = Math.max(seconds, v ? length(v) + 0.8 : 0);
  const vf = [
    'scale=1280:720:force_original_aspect_ratio=decrease',
    'pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    'fps=30',
    ...(say ? [subtitle(sub, 22, 18)] : []),
  ].join(',');
  run1('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-loop',
    '1',
    '-framerate',
    '30',
    '-t',
    total.toFixed(2),
    '-i',
    img,
    ...(v ? ['-i', v] : ['-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo']),
    '-filter_complex',
    `[0:v]${vf}[v];[1:a]aresample=48000,apad[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-t',
    total.toFixed(2),
    ...VIDEO,
    ...AUDIO,
    f,
  ]);
  return f;
}

// Карточка: заголовок и текст на фоне глав; голос - по желанию.
function card(work: string, n: number, title: string, body: string, seconds: number, say?: string): string {
  const f = join(work, `${String(n).padStart(3, '0')}.mp4`);
  writeFileSync(join(work, `${n}-title.txt`), title);
  writeFileSync(join(work, `${n}-body.txt`), body);
  const v = say ? voice(say) : undefined;
  const total = Math.max(seconds, v ? length(v) + 0.8 : 0);
  run1('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x14111F:s=1280x720:r=30:d=${total.toFixed(2)}`,
    ...(v ? ['-i', v] : ['-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo']),
    '-filter_complex',
    `[0:v]drawtext=fontfile=${FONT}:textfile=${join(work, `${n}-title.txt`)}:fontsize=42:fontcolor=white:x=(w-text_w)/2:y=h/2-170,drawtext=fontfile=${FONT}:textfile=${join(work, `${n}-body.txt`)}:fontsize=26:fontcolor=0xC9C3E6:line_spacing=14:x=(w-text_w)/2:y=h/2-70[v];[1:a]aresample=48000,apad[a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-t',
    total.toFixed(2),
    ...VIDEO,
    ...AUDIO,
    f,
  ]);
  return f;
}

const two = (x: number) => String(x).padStart(2, '0');
const d = new Date(journal.started);
const when = `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
const versions = `Версии: съёмка ${(run.film ?? '?').slice(0, 7)}, сценарий ${run.script.slice(0, 8)}, фабрика ${(run.factory ?? '?').slice(0, 7)}, цель ${(run.target ?? '?').slice(0, 7)}`;
const done = takeObjects(journal.ctx);
const outro = [
  `Задачи Jira: ${done.issues.length} (${done.issues.join(', ')})`,
  `PR: ${done.prs.length} (${done.prs.map((p) => `#${p}`).join(', ')})`,
  `Страницы Confluence: ${done.pages.length}`,
  '',
  'Ссылки на задачи, PR и страницы - в описании ролика',
].join('\n');

for (const name of names) {
  const cut = spec.cuts[name] as Cut;
  const work = mkdtempSync(join(out, `.work-${name}-`));
  const parts: string[] = [];
  let n = 0;
  if (cut.intro !== false)
    parts.push(
      card(
        work,
        n++,
        cut.title,
        `${cut.audience}\nПрогон фабрики ПО на ИИ, ${when}\nВсе роли играют ИИ-персонажи; работу фабрики делает ИИ вживую\nГолос - синтез речи по тексту сценария\n\n${versions}`,
        INTRO_SECONDS,
        cut.intro_say,
      ),
    );
  for (const p of cut.parts) {
    if (p.slide) {
      const s = slides.get(p.slide);
      if (!s) throw new Error(`${name}: нет слайда ${p.slide}`);
      parts.push(slide(work, n++, s.file, p.seconds, p.say));
      continue;
    }
    const c = clips.get(p.clip ?? '');
    if (!c) throw new Error(`${name}: нет клипа ${p.clip}`);
    const src = join(takeDir, c.clip.file);
    const from = clipStart(c.first, p.from, length(src));
    const t = partTiming(p.seconds, length(src), from, p.say ? length(voice(p.say)) : 0);
    parts.push(part(work, n++, src, from, t.video, t.total, p.say));
  }
  if (cut.outro !== false) parts.push(card(work, n++, 'Что сделано в прогоне', outro, OUTRO_SECONDS));
  writeFileSync(join(work, 'list.txt'), parts.map((f) => `file '${f}'`).join('\n'));
  const file = `${name}.mp4`;
  run1('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    join(work, 'list.txt'),
    '-c',
    'copy',
    // Машиночитаемая пометка ИИ-контента - в метаданных файла; видимая - в заставке и на плашках.
    '-metadata',
    `title=${cut.title}`,
    '-metadata',
    `comment=Создано с ИИ: роли играют ИИ-персонажи, работу фабрики делает ИИ, голос - синтез речи (edge-tts, ${spec.voice}). Прогон ${journal.take}.`,
    '-metadata',
    `creation_time=${new Date().toISOString()}`,
    join(out, file),
  ]);
  run1('rm', ['-rf', work]);
  const seconds = Math.round(length(join(out, file)));
  // Ссылки для описания: объекты шагов нарезки.
  const steps = [...new Set(cut.parts.flatMap((p) => (p.clip ? [clips.get(p.clip)?.clip.step ?? ''] : [])))];
  writeFileSync(
    join(out, `${name}-links.md`),
    [
      `# ${cut.title} - ${cut.audience}`,
      '',
      `Прогон ${journal.take}, ${when}. ${versions}.`,
      '',
      ...steps.flatMap((s) => (journal.plans[s]?.links ?? []).map((l) => `- ${s}: ${l}`)),
      '',
    ].join('\n'),
  );
  const pub: Publication = {
    cut: name,
    file,
    take: journal.take,
    script: run.script,
    factory: run.factory ?? '',
    cuts: cutHash(cut, spec.voice, slideHashes),
    seconds,
    built: new Date().toISOString(),
  };
  const i = pubs.findIndex((x) => x.cut === name);
  if (i >= 0) pubs[i] = pub;
  else pubs.push(pub);
  writeFileSync(pubFile, JSON.stringify(pubs, null, 2));
  console.log(`${name}: ${seconds} с${seconds > cut.max ? ` - больше предела ${cut.max} с` : ''} - ${join(out, file)}`);
}
