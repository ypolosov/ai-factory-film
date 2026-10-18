// OBS WebSocket v5 для записи окна браузера (scripts/demo-window.sh): версия, сцена, окно, начать и
// закончить запись. Пароль - OBS_WS_PASSWORD из .state/obs.env, адрес - OBS_WS_URL (по умолчанию
// ws://127.0.0.1:4455: сеть WSL зеркальная, OBS на Windows виден как localhost). Ключ не печатается.
// window ЗАГОЛОВОК - захват окна текущей сцены ловит окно Discord в браузере (msedge.exe) строго по
// заголовку и вписывается в холст: заголовок меняется с каналом, а рядом бывают другие окна Discord.
// Использование: node scripts/obs.mjs version | status | start | stop | scene ИМЯ | window ЗАГОЛОВОК
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(process.env.OBS_ENV ?? '.state/obs.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const [cmd = 'version', arg] = process.argv.slice(2);
const fail = (m) => {
  console.error(m);
  process.exit(1);
};
const commands = {
  version: async (req) => {
    const d = await req('GetVersion');
    return `OBS ${d.obsVersion}, WebSocket ${d.obsWebSocketVersion}`;
  },
  status: async (req) => ((await req('GetRecordStatus')).outputActive ? 'идёт запись' : 'запись стоит'),
  start: async (req) => {
    await req('StartRecord');
    return 'запись начата';
  },
  stop: async (req) => (await req('StopRecord')).outputPath,
  scene: async (req) => {
    await req('SetCurrentProgramScene', { sceneName: arg });
    return `сцена ${arg}`;
  },
  window: async (req) => {
    if (!arg) fail('использование: obs.mjs window ЗАГОЛОВОК');
    const { currentProgramSceneName: sceneName } = await req('GetCurrentProgramScene');
    const { sceneItems } = await req('GetSceneItemList', { sceneName });
    const item = sceneItems.find((i) => i.inputKind === 'window_capture');
    if (!item) fail(`в сцене ${sceneName} нет захвата окна`);
    const { baseWidth, baseHeight } = await req('GetVideoSettings');
    // Строка окна OBS - заголовок:класс:программа, "#" и ":" в заголовке - #22 и #3A; priority 1 -
    // заголовок должен совпасть; method 2 - захват Windows 10 (окно можно перекрывать); без рамки окна
    // и без курсора.
    const title = arg.replaceAll('#', '#22').replaceAll(':', '#3A');
    await req('SetInputSettings', {
      inputName: item.sourceName,
      inputSettings: { window: `${title}:Chrome_WidgetWin_1:msedge.exe`, priority: 1, method: 2, client_area: true, cursor: false },
    });
    await req('SetSceneItemTransform', {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemTransform: {
        positionX: baseWidth / 2,
        positionY: baseHeight / 2,
        alignment: 0,
        boundsType: 'OBS_BOUNDS_SCALE_INNER',
        boundsAlignment: 0,
        boundsWidth: baseWidth,
        boundsHeight: baseHeight,
      },
    });
    return `окно "${arg}" - источник ${item.sourceName}, сцена ${sceneName}`;
  },
};
const run = commands[cmd];
if (!run) fail(`нет команды ${cmd}: ${Object.keys(commands).join(', ')}`);
const sha = (s) => createHash('sha256').update(s).digest('base64');
const ws = new WebSocket(env.OBS_WS_URL ?? 'ws://127.0.0.1:4455', 'obswebsocket.json');
const timer = setTimeout(() => fail('OBS не ответил за 10 с'), 10_000);
const waiting = new Map();
let last = 0;
const req = (requestType, requestData = {}) =>
  new Promise((resolve) => {
    const requestId = String(++last);
    waiting.set(requestId, (d) => {
      const s = d.requestStatus;
      if (!s.result) fail(`OBS: ${requestType} - ${s.code} ${s.comment ?? ''}`);
      resolve(d.responseData ?? {});
    });
    ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
ws.onerror = () => fail('OBS WebSocket недоступен: OBS запущен, сервер WebSocket включён (Сервис - Настройки сервера WebSocket)?');
ws.onmessage = async (e) => {
  const m = JSON.parse(String(e.data));
  if (m.op === 0) {
    const a = m.d.authentication;
    const auth = a ? sha(sha(`${env.OBS_WS_PASSWORD ?? ''}${a.salt}`) + a.challenge) : undefined;
    ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, ...(auth ? { authentication: auth } : {}) } }));
  } else if (m.op === 2) {
    const out = await run(req);
    clearTimeout(timer);
    console.log(out);
    ws.close();
    process.exit(0);
  } else if (m.op === 7) {
    waiting.get(m.d.requestId)?.(m.d);
  }
};
ws.onclose = (e) => {
  if (e.code === 4009) fail('OBS: неверный пароль WebSocket (OBS_WS_PASSWORD в .state/obs.env)');
};
