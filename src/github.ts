// GitHub для участников съёмки: ИИ-персонаж действует в репозитории цели своим приложением GitHub
// (GitHub App, scripts/persona-github-app-add.sh) - ветка с коммитом, PR, слияние; камера тем же
// клиентом читает PR, статусы и теги. Коммиты и PR подписаны приложением ("<имя>[bot]"). Ключ
// приложения - из каталога состояния, в журнал не идёт. Действия повторяемы: уже сделанное не
// делается второй раз (ветка есть - её PR, PR слит - не сливать, тег есть - его коммит).
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from './atlassian.ts';
import { parseEnv } from './script.ts';

const API = 'https://api.github.com';
const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export interface PullRef {
  number: number;
  url: string;
  head: string;
  sha: string;
}

export interface Pull extends PullRef {
  state: 'open' | 'closed';
  merged: boolean;
}

type Json = Record<string, unknown>;

const toPull = (p: Json): Pull => ({
  number: Number(p.number),
  url: String(p.html_url),
  head: String((p.head as Json).ref),
  sha: String((p.head as Json).sha),
  state: p.state === 'open' ? 'open' : 'closed',
  merged: Boolean(p.merged_at),
});

export function persona(state: string, id: string) {
  const env = parseEnv(readFileSync(join(state, `github-app-${id}.env`), 'utf8'));
  const pem = readFileSync(join(state, `github-app-${id}.pem`), 'utf8');
  const repo = env.GITHUB_TARGET_REPO ?? '';
  const slug = env.GITHUB_APP_SLUG ?? id;
  let token: { value: string; until: number } | undefined;

  // Токен установки приложения живёт час; берём новый за пять минут до конца.
  async function auth(): Promise<string> {
    if (token && token.until - Date.now() > 300_000) return token.value;
    const now = Math.floor(Date.now() / 1000);
    const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))}`;
    const jwt = `${body}.${b64url(createSign('RSA-SHA256').update(body).sign(pem))}`;
    const r = await fetch(`${API}/app/installations/${env.GITHUB_APP_INSTALLATION}/access_tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error(`GitHub: токен приложения ${slug}: ${r.status}`);
    const t = (await r.json()) as { token: string; expires_at: string };
    token = { value: t.token, until: Date.parse(t.expires_at) };
    return token.value;
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await request(
      `${API}/repos/${repo}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${await auth()}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      `GitHub (${slug}) ${method} ${path.split('?')[0]}`,
    );
    if (!r.ok) throw new Error(`GitHub (${slug}) ${method} ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (r.status === 204 ? undefined : await r.json()) as T;
  }
  const missing = (e: unknown) => String(e).includes(': 404');

  const gh = {
    slug,
    // Текст файла в ветке; нет файла - undefined.
    async read(path: string, ref = 'main'): Promise<string | undefined> {
      try {
        const f = await call<{ content: string }>('GET', `/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
        return Buffer.from(f.content, 'base64').toString('utf8');
      } catch (e) {
        if (missing(e)) return undefined;
        throw e;
      }
    },
    async branchHead(branch: string): Promise<string | undefined> {
      try {
        return (await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`)).object.sha;
      } catch (e) {
        if (missing(e)) return undefined;
        throw e;
      }
    },
    async getPull(n: number): Promise<Pull> {
      return toPull(await call<Json>('GET', `/pulls/${n}`));
    },
    async listPulls(state: 'open' | 'all' = 'open'): Promise<Pull[]> {
      return (await call<Json[]>('GET', `/pulls?state=${state}&per_page=100`)).map(toPull);
    },
    // Статусы коммита по ключу - последний у каждого ключа.
    async statuses(sha: string): Promise<{ key: string; state: string; description: string }[]> {
      const r = await call<{ statuses: Json[] }>('GET', `/commits/${sha}/status`);
      return r.statuses.map((s) => ({ key: String(s.context), state: String(s.state), description: String(s.description ?? '') }));
    },
    async tags(): Promise<{ name: string; sha: string }[]> {
      return (await call<Json[]>('GET', '/tags?per_page=100')).map((t) => ({ name: String(t.name), sha: String((t.commit as Json).sha) }));
    },
    // Ветка от base с одним коммитом всех файлов и PR из неё. Ветка уже есть - её открытый PR.
    async openPull(p: { base: string; branch: string; title: string; body: string; files: Record<string, string> }): Promise<PullRef> {
      if (await gh.branchHead(p.branch)) {
        const open = (await gh.listPulls('open')).find((x) => x.head === p.branch);
        if (open) return open;
        throw new Error(`GitHub: ветка ${p.branch} уже есть, а открытого PR из неё нет`);
      }
      const base = await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${p.base}`);
      const parent = await call<{ tree: { sha: string } }>('GET', `/git/commits/${base.object.sha}`);
      const tree = await call<{ sha: string }>('POST', '/git/trees', {
        base_tree: parent.tree.sha,
        tree: Object.entries(p.files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
      });
      const commit = await call<{ sha: string }>('POST', '/git/commits', {
        message: p.title,
        tree: tree.sha,
        parents: [base.object.sha],
      });
      await call('POST', '/git/refs', { ref: `refs/heads/${p.branch}`, sha: commit.sha });
      const pr = await call<{ number: number; html_url: string }>('POST', '/pulls', {
        title: p.title,
        body: p.body,
        head: p.branch,
        base: p.base,
      });
      return { number: pr.number, url: pr.html_url, head: p.branch, sha: commit.sha };
    },
    // Слить сжатием; уже слит - ничего не делать.
    async merge(n: number, title: string): Promise<void> {
      if ((await gh.getPull(n)).merged) return;
      await call('PUT', `/pulls/${n}/merge`, { merge_method: 'squash', commit_title: `${title} (#${n})` });
    },
    // Замечание - один раз: тот же текст этого приложения уже есть - второе не пишется.
    async comment(n: number, text: string): Promise<void> {
      const mine = await call<Json[]>('GET', `/issues/${n}/comments?per_page=100`);
      if (mine.some((c) => (c.user as Json | undefined)?.login === `${slug}[bot]` && c.body === text)) return;
      await call('POST', `/issues/${n}/comments`, { body: text });
    },
    async closePull(n: number): Promise<void> {
      await call('PATCH', `/pulls/${n}`, { state: 'closed' });
    },
    // Лёгкий тег на вершине ветки; тег уже есть - его коммит.
    async tag(name: string, branch = 'main'): Promise<string> {
      const have = (await gh.tags()).find((t) => t.name === name);
      if (have) return have.sha;
      const head = await call<{ object: { sha: string } }>('GET', `/git/ref/heads/${branch}`);
      await call('POST', '/git/refs', { ref: `refs/tags/${name}`, sha: head.object.sha });
      return head.object.sha;
    },
  };
  return gh;
}
