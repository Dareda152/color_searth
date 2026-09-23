import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const executable = resolve('tools', 'cloudflared.exe');
const downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

if (process.platform !== 'win32') {
  console.error('Этот скрипт рассчитан на Windows. На другой системе установите cloudflared и запустите cloudflared tunnel --url http://localhost:3000.');
  process.exit(1);
}

if (!existsSync(executable)) {
  mkdirSync(resolve('tools'), { recursive: true });
  console.log('Скачиваем cloudflared с официальной страницы релизов Cloudflare…');
  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) throw new Error(`Не удалось скачать cloudflared: HTTP ${response.status}`);
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(executable));
    if (statSync(executable).size < 10_000_000) throw new Error('Скачанный файл слишком мал.');
  } catch (error) {
    if (existsSync(executable)) unlinkSync(executable);
    throw error;
  }
}

console.log('Запускаем временный Cloudflare Tunnel для http://127.0.0.1:3000');
console.log('Скопируйте адрес https://….trycloudflare.com из строки внизу и откройте его у игроков.');
const processCloudflared = spawn(executable, ['tunnel', '--url', 'http://127.0.0.1:3000'], { stdio: 'inherit', windowsHide: true });
processCloudflared.on('exit', (code) => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => processCloudflared.kill('SIGINT'));
