// Слайды нарезок (film/cuts.yml, часть slide): раздел колоды Claude Design film/slides/<имя>.html -
// картинка film/slides/<имя>.png 1920x1080. Запускается в образе камеры (scripts/slides-render.sh):
// Chromium без окна, шрифты колоды (Unbounded, Manrope; OFL) - файлы film/fonts, без сети. Разметка
// слайда - подмножество формата колоды: стили в атрибутах, отступы задают padding и gap, поэтому
// внешние поля обнуляются.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '/opt/film/node_modules/playwright/index.mjs';

const [dir = '/slides', fontDir = '/fonts'] = process.argv.slice(2);
const face = (family, file) =>
  `@font-face{font-family:'${family}';font-weight:100 900;src:url(data:font/ttf;base64,${readFileSync(join(fontDir, file)).toString('base64')})}`;
const fonts = face('Unbounded', 'Unbounded.ttf') + face('Manrope', 'Manrope.ttf');
const base =
  '*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;overflow:hidden}section{width:1920px;height:1080px;position:relative}ul{padding-left:1.1em}th,td{padding:0.35em 0.6em;text-align:left}aside{display:none}';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
  const html = readFileSync(join(dir, f), 'utf8');
  await page.setContent(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${fonts}${base}</style></head><body>${html}</body></html>`, {
    waitUntil: 'load',
  });
  // Шрифт грузится по первому использованию: ждём оба начертания, иначе снимок - запасным шрифтом.
  await page.evaluate(async () => {
    await Promise.all(['700 64px Unbounded', '400 32px Manrope', '800 32px Manrope'].map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  });
  const out = join(dir, f.replace(/\.html$/, '.png'));
  await page.screenshot({ path: out });
  console.log(`слайд ${out}`);
}
await browser.close();
