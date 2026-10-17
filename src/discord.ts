// Discord REST учёткой бота съёмки: бот камеры читает каналы, бот персонажа пишет реплику.
// Ключи - из .state/discord-<id>.env; токена бота фабрики здесь нет.
import { request } from './atlassian.ts';
import type { ChatMessage } from './script.ts';

const API = 'https://discord.com/api/v10';

export function discordBot(token: string, who: string) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Сообщение с вложением - форма (multipart): тип с границей ставит fetch.
    const form = body instanceof FormData;
    const r = await request(
      `${API}${path}`,
      {
        method,
        headers: { authorization: `Bot ${token}`, ...(form ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
      },
      `Discord (${who}) ${path.split('?')[0]}`,
    );
    if (!r.ok) throw new Error(`Discord (${who}) ${method} ${path.split('?')[0]}: ${r.status}`);
    return (await r.json()) as T;
  }

  return {
    me: () => call<{ id: string }>('GET', '/users/@me'),
    guilds: () => call<{ id: string; name: string }[]>('GET', '/users/@me/guilds'),
    channels: (guild: string) => call<{ id: string; name: string }[]>('GET', `/guilds/${guild}/channels`),
    send: (channel: string, body: unknown) => call<{ id: string }>('POST', `/channels/${channel}/messages`, body),
    message: (channel: string, id: string) => call<ChatMessage>('GET', `/channels/${channel}/messages/${id}`),
    // Сообщения канала после данного, от старых к новым; страницами по 100, не больше limit.
    async after(channel: string, after: string, limit = 500): Promise<ChatMessage[]> {
      const out: ChatMessage[] = [];
      let from = after;
      while (out.length < limit) {
        const page = await call<ChatMessage[]>('GET', `/channels/${channel}/messages?after=${from}&limit=100`);
        page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        out.push(...page);
        if (page.length < 100) break;
        from = page.at(-1)?.id ?? from;
      }
      return out;
    },
  };
}
