// Версии для журнала дубля и стража свежести: отпечаток сценария (film.yml и заготовки) и вершина
// main публичного репозитория фабрики (какая сборка запущена, снаружи не видно - РП 31).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scriptVersion } from './script.ts';

export function scriptVersionOf(filmPath: string): string {
  const assets = join(dirname(filmPath), 'film-assets');
  return scriptVersion([
    { name: 'film.yml', content: readFileSync(filmPath) },
    ...readdirSync(assets, { recursive: true })
      .map(String)
      .filter((n) => statSync(join(assets, n)).isFile())
      .map((n) => ({ name: `film-assets/${n}`, content: readFileSync(join(assets, n)) })),
  ]);
}

export async function factoryMain(repo: string | undefined): Promise<string | undefined> {
  if (!repo) return undefined;
  const r = await fetch(`https://api.github.com/repos/${repo}/commits/main`, { headers: { accept: 'application/vnd.github.sha' } }).catch(
    () => undefined,
  );
  return r?.ok ? (await r.text()).trim() : undefined;
}
