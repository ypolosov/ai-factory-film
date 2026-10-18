// OBS WebSocket v5 для записи окна Discord (scripts/demo-discord.sh): версия, сцена, начать и
// закончить запись. Пароль - OBS_WS_PASSWORD из .state/obs.env, адрес - OBS_WS_URL (по умолчанию
// ws://127.0.0.1:4455: сеть WSL зеркальная, OBS на Windows виден как localhost). Ключ не печатается.
// Использование: node scripts/obs.mjs version | status | start | stop | scene ИМЯ
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(process.env.OBS_ENV ?? '.state/obs.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const [cmd = 'version', arg] = process.argv.slice(2);
const calls = {
  version: ['GetVersion', {}, (d) => `OBS ${d.obsVersion}, WebSocket ${d.obsWebSocketVersion}`],
  status: ['GetRecordStatus', {}, (d) => (d.outputActive ? 'идёт запись' : 'запись стоит')],
  start: ['StartRecord', {}, () => 'запись начата'],
  stop: ['StopRecord', {}, (d) => d.outputPath],
  scene: ['SetCurrentProgramScene', { sceneName: arg }, () => `сцена ${arg}`],
};
const call = calls[cmd];
if (!call) {
  console.error(`нет команды ${cmd}: ${Object.keys(calls).join(', ')}`);
  process.exit(2);
}
const sha = (s) => createHash('sha256').update(s).digest('base64');
const ws = new WebSocket(env.OBS_WS_URL ?? 'ws://127.0.0.1:4455', 'obswebsocket.json');
const timer = setTimeout(() => {
  console.error('OBS не ответил за 10 с');
  process.exit(1);
}, 10_000);
ws.onerror = () => {
  console.error('OBS WebSocket недоступен: OBS запущен, сервер WebSocket включён (Сервис - Настройки сервера WebSocket)?');
  process.exit(1);
};
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.op === 0) {
    const a = m.d.authentication;
    const auth = a ? sha(sha(`${env.OBS_WS_PASSWORD ?? ''}${a.salt}`) + a.challenge) : undefined;
    ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, ...(auth ? { authentication: auth } : {}) } }));
  } else if (m.op === 2) {
    ws.send(JSON.stringify({ op: 6, d: { requestType: call[0], requestId: cmd, requestData: call[1] } }));
  } else if (m.op === 7) {
    clearTimeout(timer);
    const s = m.d.requestStatus;
    if (!s.result) {
      console.error(`OBS: ${call[0]} - ${s.code} ${s.comment ?? ''}`);
      process.exit(1);
    }
    console.log(call[2](m.d.responseData ?? {}));
    ws.close();
    process.exit(0);
  }
};
ws.onclose = (e) => {
  if (e.code === 4009) {
    console.error('OBS: неверный пароль WebSocket (OBS_WS_PASSWORD в .state/obs.env)');
    process.exit(1);
  }
};
