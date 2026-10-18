// Окно Discord в браузере (scripts/discord-browser.sh) по протоколу отладки браузера (CDP):
// status - окно на связи; open АДРЕС - перевести вкладку Discord по адресу сообщения дубля, дождаться
// загрузки и заголовка канала и напечатать заголовок (по нему OBS ловит окно: scripts/obs.mjs window).
// Только переходы: ничего не пишет и не нажимает (решение владельца 18.10).
// Порт - CDP_PORT (по умолчанию 9223); сеть WSL зеркальная, браузер на Windows виден как localhost.
// Использование: node scripts/cdp.mjs status | open АДРЕС
const base = `http://127.0.0.1:${process.env.CDP_PORT ?? '9223'}`;
const [cmd = 'status', url] = process.argv.slice(2);
const fail = (m) => {
  console.error(m);
  process.exit(1);
};
const tab = async () => {
  const r = await fetch(`${base}/json`).catch(() => undefined);
  if (!r?.ok) fail(`окна Discord нет (${base}): scripts/discord-browser.sh`);
  const targets = await r.json();
  return targets.find((t) => t.type === 'page' && /discord\.com/.test(t.url)) ?? targets.find((t) => t.type === 'page');
};
const page = await tab();
if (!page) fail('в окне браузера нет вкладки');
if (cmd === 'status') {
  console.log(`окно: ${page.title} - ${page.url}`);
  process.exit(0);
}
// Discord сначала ставит заголовок "Discord", а заголовок канала (Discord | #канал | сервер) - после
// отрисовки; ждём, пока он появится и полторы секунды не меняется.
const settled = async () => {
  let seen = '';
  let same = 0;
  for (let i = 0; i < 40; i++) {
    const t = (await tab())?.title ?? '';
    same = t === seen ? same + 1 : 0;
    seen = t;
    if (/ \| #/.test(t) && same >= 3) return t;
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`заголовок канала не установился за 20 с: ${seen}`);
};
if (cmd !== 'open' || !/^https:\/\/discord\.com\//.test(url ?? '')) fail('использование: cdp.mjs open https://discord.com/channels/...');
// Свёрнутое окно OBS не видит (захват Windows 10 его пропускает): развернуть, если свёрнуто.
const { webSocketDebuggerUrl } = await (await fetch(`${base}/json/version`)).json();
await new Promise((resolve) => {
  const b = new WebSocket(webSocketDebuggerUrl);
  b.onerror = () => fail('протокол отладки браузера недоступен');
  b.onopen = () => b.send(JSON.stringify({ id: 1, method: 'Browser.getWindowForTarget', params: { targetId: page.id } }));
  b.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id === 1 && m.result?.bounds.windowState === 'minimized') {
      const bounds = { windowState: 'normal' };
      b.send(JSON.stringify({ id: 2, method: 'Browser.setWindowBounds', params: { windowId: m.result.windowId, bounds } }));
      return;
    }
    b.close();
    resolve();
  };
});
const ws = new WebSocket(page.webSocketDebuggerUrl);
const timer = setTimeout(() => fail(`страница не загрузилась за 30 с: ${url}`), 30_000);
ws.onerror = () => fail('протокол отладки браузера недоступен');
ws.onopen = () => {
  ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
  // Вкладка - на передний план: окно за другими окнами браузер может не рисовать.
  ws.send(JSON.stringify({ id: 3, method: 'Page.bringToFront' }));
  ws.send(JSON.stringify({ id: 2, method: 'Page.navigate', params: { url } }));
};
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id === 2 && m.result?.errorText) fail(`переход не вышел: ${m.result.errorText}`);
  if (m.method === 'Page.loadEventFired') {
    clearTimeout(timer);
    ws.close();
    settled().then((t) => {
      console.log(t);
      process.exit(0);
    });
  }
};
