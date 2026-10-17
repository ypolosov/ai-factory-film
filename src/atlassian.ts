// Jira и Confluence учёткой участника съёмки - только то, что нужно режиссёру и камере. Ключи -
// из .state/atlassian-<участник>.env (scripts/persona-atlassian-add.sh); ключей фабрики здесь нет.
// Повторы - только у чтения и у правок, которые можно повторить без второго эффекта (PUT):
// неясный итог записи слепо не повторяется.

export interface Issue {
  key: string;
  url: string;
  title: string;
  labels: string[];
  state: 'open' | 'closed';
  creator?: string; // accountId
}

export interface Page {
  id: string;
  title: string;
  labels: string[];
  creator?: string; // accountId
}

export interface Comment {
  author: string; // accountId
  body: string;
  createdAt: string;
}

type Json = Record<string, unknown>;
type Adf = { type: string; version?: number; text?: string; content?: Adf[] };

// Простой текст -> документ ADF: абзац на строку.
export function textToAdf(text: string): Adf {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  };
}

// Документ ADF -> простой текст: текст узлов, блоки - через перевод строки.
export function adfToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const inline = (n: Adf): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(inline).join(''));
  return ((doc as Adf).content ?? []).map(inline).join('\n');
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Текст -> формат хранения Confluence: абзац на строку, ссылки кликабельны.
export function toStorage(text: string): string {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<p>${esc(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Запрос с повтором для чтения и повторяемых правок: 429 - по Retry-After, 5xx и обрыв - с паузой.
export async function request(url: string, init: RequestInit, label: string, attempts = 3): Promise<Response> {
  const repeatable = !init.method || init.method === 'GET' || init.method === 'PUT';
  for (let i = 1; ; i++) {
    let r: Response | undefined;
    try {
      r = await fetch(url, init);
    } catch (e) {
      if (!repeatable || i >= attempts) throw new Error(`${label}: нет связи (${(e as Error).message})`);
    }
    if (r && r.status !== 429 && r.status < 500) return r;
    if (r && (!repeatable || i >= attempts)) return r;
    const after = Number(r?.headers.get('retry-after') ?? '');
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 2000 * i);
  }
}

export function atlassian(env: Record<string, string>, who: string) {
  const site = (env.ATLASSIAN_SITE ?? '').replace(/\/$/, '');
  const basic = (token: string) => `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL ?? ''}:${token}`).toString('base64')}`;
  let cloud: Promise<string> | undefined;
  const cloudId = () => {
    cloud ??= fetch(`${site}/_edge/tenant_info`)
      .then((r) => r.json() as Promise<Json>)
      .then((j) => String(j.cloudId));
    return cloud;
  };

  async function call<T = Json>(api: 'jira' | 'wiki', method: string, path: string, body?: unknown): Promise<T> {
    const base =
      api === 'jira'
        ? `https://api.atlassian.com/ex/jira/${await cloudId()}/rest/api/3`
        : `https://api.atlassian.com/ex/confluence/${await cloudId()}/wiki/rest/api`;
    const token = api === 'jira' ? (env.JIRA_API_TOKEN ?? '') : (env.CONFLUENCE_API_TOKEN ?? '');
    const r = await request(
      `${base}${path}`,
      {
        method,
        headers: { authorization: basic(token), accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      `${api === 'jira' ? 'Jira' : 'Confluence'} (${who}) ${method} ${path.split('?')[0]}`,
    );
    if (!r.ok)
      throw new Error(
        `${api === 'jira' ? 'Jira' : 'Confluence'} (${who}) ${method} ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`,
      );
    return (r.status === 204 || r.headers.get('content-length') === '0' ? undefined : await r.json().catch(() => undefined)) as T;
  }

  const toIssue = (i: Json): Issue => {
    const f = i.fields as Json;
    const cat = ((f.status as Json | undefined)?.statusCategory as Json | undefined)?.key;
    return {
      key: String(i.key),
      url: `${site}/browse/${String(i.key)}`,
      title: String(f.summary ?? ''),
      labels: ((f.labels as string[] | undefined) ?? []).map(String),
      state: cat === 'done' ? 'closed' : 'open',
      ...((f.creator as Json | undefined)?.accountId ? { creator: String((f.creator as Json).accountId) } : {}),
    };
  };
  const key = (k: string) => encodeURIComponent(k);

  const tracker = {
    async getIssue(k: string): Promise<Issue> {
      return toIssue(await call('jira', 'GET', `/issue/${key(k)}?fields=summary,labels,status,creator`));
    },
    // Владелец мира в Jira - руководитель проекта.
    async owner(): Promise<string> {
      const p = await call('jira', 'GET', `/project/${key(env.JIRA_PROJECT ?? '')}`);
      return String((p.lead as Json | undefined)?.accountId ?? '');
    },
    async openIssues(limit = 100): Promise<Issue[]> {
      const r = await call<{ issues?: Json[] }>('jira', 'POST', '/search/jql', {
        jql: `project = "${env.JIRA_PROJECT ?? ''}" AND statusCategory != Done ORDER BY created DESC`,
        fields: ['summary', 'labels', 'status', 'creator'],
        maxResults: limit,
      });
      return (r.issues ?? []).map(toIssue);
    },
    // Сначала новые: в выборке по метке задача этого дубля не уступает задаче прошлого.
    async listIssues(q: { label: string; state?: 'open' | 'all'; limit?: number }): Promise<Issue[]> {
      const parts = [`project = "${env.JIRA_PROJECT ?? ''}"`, `labels = "${q.label.replace(/"/g, '\\"')}"`];
      if (q.state === 'open') parts.push('statusCategory != Done');
      const r = await call<{ issues?: Json[] }>('jira', 'POST', '/search/jql', {
        jql: `${parts.join(' AND ')} ORDER BY created DESC`,
        fields: ['summary', 'labels', 'status'],
        maxResults: q.limit ?? 20,
      });
      return (r.issues ?? []).map(toIssue);
    },
    async listDependencies(k: string): Promise<string[]> {
      const i = await call('jira', 'GET', `/issue/${key(k)}?fields=issuelinks`);
      const links = ((i.fields as Json).issuelinks as Json[] | undefined) ?? [];
      return links.filter((l) => (l.type as Json).name === 'Blocks' && l.outwardIssue).map((l) => String((l.outwardIssue as Json).key));
    },
    async listComments(k: string): Promise<Comment[]> {
      const r = await call<{ comments?: Json[] }>('jira', 'GET', `/issue/${key(k)}/comment?orderBy=created`);
      return (r.comments ?? []).map((c) => ({
        author: String((c.author as Json | undefined)?.accountId ?? ''),
        body: adfToText(c.body),
        createdAt: String(c.created ?? ''),
      }));
    },
    async addLabel(k: string, label: string): Promise<void> {
      await call('jira', 'PUT', `/issue/${key(k)}`, { update: { labels: [{ add: label }] } });
    },
    // Комментарий - один раз: тот же текст той же учётки уже есть - второй не пишется.
    async addComment(k: string, text: string, me?: string): Promise<void> {
      if (me && (await tracker.listComments(k)).some((c) => c.author === me && c.body === text)) return;
      await call('jira', 'POST', `/issue/${key(k)}/comment`, { body: textToAdf(text) });
    },
    async assign(k: string, account: string): Promise<void> {
      await call('jira', 'PUT', `/issue/${key(k)}/assignee`, { accountId: account });
    },
    async logWork(k: string, seconds: number, comment: string): Promise<void> {
      await call('jira', 'POST', `/issue/${key(k)}/worklog`, {
        timeSpentSeconds: Math.max(60, Math.round(seconds)),
        comment: textToAdf(comment),
      });
    },
    // Закрыть - переход в категорию done; уже закрыта - ничего не делать.
    async close(k: string): Promise<void> {
      if ((await tracker.getIssue(k)).state === 'closed') return;
      const t = await call<{ transitions: Json[] }>('jira', 'GET', `/issue/${key(k)}/transitions`);
      const to = t.transitions.find((x) => ((x.to as Json).statusCategory as Json).key === 'done');
      if (!to) throw new Error(`${k}: нет перехода в категорию done`);
      await call('jira', 'POST', `/issue/${key(k)}/transitions`, { transition: { id: to.id } });
    },
  };

  const wiki = env.CONFLUENCE_API_TOKEN
    ? {
        // Страница по названию в пространстве: есть - новая версия, нет - новая страница.
        async upsertPage(title: string, body: string): Promise<{ id: string; url: string }> {
          const cql = `space = "${env.CONFLUENCE_SPACE ?? ''}" and type = page and title = "${title.replace(/["\\]/g, ' ')}"`;
          const q = new URLSearchParams({ cql, expand: 'version', limit: '1' });
          const found = (await call<{ results: Json[] }>('wiki', 'GET', `/content/search?${q}`)).results[0];
          const page = {
            type: 'page',
            title,
            space: { key: env.CONFLUENCE_SPACE ?? '' },
            body: { storage: { value: toStorage(body), representation: 'storage' } },
          };
          const saved = found
            ? await call('wiki', 'PUT', `/content/${String(found.id)}`, {
                ...page,
                id: String(found.id),
                version: { number: Number((found.version as Json | undefined)?.number ?? 1) + 1 },
              })
            : await call('wiki', 'POST', '/content', page);
          return { id: String(saved.id), url: `${site}/wiki${String((saved._links as Json | undefined)?.webui ?? '')}` };
        },
        async addLabel(pageId: string, label: string): Promise<void> {
          await call('wiki', 'POST', `/content/${encodeURIComponent(pageId)}/label`, [{ prefix: 'global', name: label }]);
        },
        // Владелец мира в Confluence - автор главной страницы пространства.
        async owner(): Promise<string> {
          const s = await call('wiki', 'GET', `/space/${encodeURIComponent(env.CONFLUENCE_SPACE ?? '')}?expand=homepage.history`);
          return String((((s.homepage as Json | undefined)?.history as Json | undefined)?.createdBy as Json | undefined)?.accountId ?? '');
        },
        // Страницы пространства вне страницы-архива. Отбор поиска по предку отстаёт от записи, поэтому
        // страница ещё и сверяется со своими предками в выдаче. Чтение страницы по id ключ персонажа не
        // пускает (401 "scope does not match"), поиск - пускает.
        async pagesOutside(archive: string): Promise<Page[]> {
          const space = `space = "${env.CONFLUENCE_SPACE ?? ''}" and type = page`;
          const q = (cql: string, expand: string) => new URLSearchParams({ cql, expand, limit: '100' });
          const found = await call<{ results: Json[] }>('wiki', 'GET', `/content/search?${q(`${space} and title = "${archive}"`, '')}`);
          const a = found.results[0] ? String(found.results[0].id) : undefined;
          const where = a ? `${space} and id != ${a} and not ancestor = ${a}` : space;
          const pages: Page[] = [];
          let next: string | undefined = `/content/search?${q(where, 'history,metadata.labels,ancestors')}`;
          while (next) {
            const r: { results: Json[]; _links?: Json } = await call('wiki', 'GET', next);
            for (const p of r.results) {
              if (a && ((p.ancestors as Json[] | undefined) ?? []).some((x) => String(x.id) === a)) continue;
              const history = p.history as Json | undefined;
              const creator = (history?.createdBy as Json | undefined)?.accountId;
              pages.push({
                id: String(p.id),
                title: String(p.title ?? ''),
                labels: ((((p.metadata as Json | undefined)?.labels as Json | undefined)?.results as Json[] | undefined) ?? []).map((l) =>
                  String(l.name),
                ),
                ...(creator ? { creator: String(creator) } : {}),
              });
            }
            const link = (r._links as Json | undefined)?.next;
            next = typeof link === 'string' ? link.replace(/^\/rest\/api/, '') : undefined;
          }
          return pages;
        },
      }
    : undefined;

  return { tracker, wiki };
}
