// Окно Discord в браузере (scripts/discord-browser.sh) по протоколу отладки браузера (CDP):
// status - окно на связи; open АДРЕС - перевести вкладку Discord по адресу сообщения дубля и
// дождаться загрузки. Только переходы: ничего не пишет и не нажимает (решение владельца 18.10).
// Порт - CDP_PORT (по умолчанию 9223); сеть WSL зеркальная, браузер на Windows виден как localhost.
// Использование: node scripts/cdp.mjs status | open АДРЕС
const base = `http://127.0.0.1:${process.env.CDP_PORT ?? '9223'}`;
const [cmd = 'status', url] = process.argv.slice(2);
const fail = (m) => {
  console.error(m);
  process.exit(1);
};
const r = await fetch(`${base}/json`).catch(() => undefined);
if (!r?.ok) fail(`окна Discord нет (${base}): scripts/discord-browser.sh`);
const targets = await r.json();
const page = targets.find((t) => t.type === 'page' && /discord\.com/.test(t.url)) ?? targets.find((t) => t.type === 'page');
if (!page) fail('в окне браузера нет вкладки');
if (cmd === 'status') {
  console.log(`окно: ${page.title} - ${page.url}`);
  process.exit(0);
}
if (cmd !== 'open' || !/^https:\/\/discord\.com\//.test(url ?? '')) fail('использование: cdp.mjs open https://discord.com/channels/...');
const ws = new WebSocket(page.webSocketDebuggerUrl);
const timer = setTimeout(() => fail(`страница не загрузилась за 30 с: ${url}`), 30_000);
ws.onerror = () => fail('протокол отладки браузера недоступен');
ws.onopen = () => {
  ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
  ws.send(JSON.stringify({ id: 2, method: 'Page.navigate', params: { url } }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id === 2 && m.result?.errorText) fail(`переход не вышел: ${m.result.errorText}`);
  if (m.method === 'Page.loadEventFired') {
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
};
