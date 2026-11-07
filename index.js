#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

// function baseNameForArtifacts(filePath) {
//   const base = path.basename(filePath);
//   return base.replace(/\./g, '_');
// }

function artifactPath(filePath, suffix) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath).replace(/\./g, '_');
  return path.join(dir, base + suffix);
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function compress(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Файл не найден: ${sourcePath}`);
  }

  const hashPath = artifactPath(sourcePath, '.sha256');
  const gzPath   = artifactPath(sourcePath, '.gz');

  const hex = await sha256File(sourcePath);
  await fsp.writeFile(hashPath, hex + '\n', 'utf8');
  console.log(`✔ Хеш записан: ${hashPath}`);
  console.log(`  SHA-256: ${hex}`);

  await pipeline(
    fs.createReadStream(sourcePath),
    zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION }),
    fs.createWriteStream(gzPath)
  );
  const srcSize = (await fsp.stat(sourcePath)).size;
  const gzSize  = (await fsp.stat(gzPath)).size;
  console.log(`✔ Архив создан: ${gzPath}`);
  console.log(`  ${srcSize} B -> ${gzSize} B (${((gzSize / srcSize) * 100).toFixed(1)}%)`);
}

async function verify(sourcePath) {
  const hashPath = artifactPath(sourcePath, '.sha256');
  const gzPath   = artifactPath(sourcePath, '.gz');

  if (!fs.existsSync(gzPath))   throw new Error(`Нет архива: ${gzPath}`);
  if (!fs.existsSync(hashPath)) throw new Error(`Нет хеша:  ${hashPath}`);

  const expected = (await fsp.readFile(hashPath, 'utf8')).trim();
  console.log(`Эталонный хеш: ${expected}`);

  const dir = path.dirname(gzPath);
  const gzBase = path.basename(gzPath, '.gz');
  const outPath = path.join(dir, gzBase + '.recovered');

  await pipeline(
    fs.createReadStream(gzPath),
    zlib.createGunzip(),
    fs.createWriteStream(outPath)
  );
  console.log(`✔ Распаковано: ${outPath}`);

  const actual = await sha256File(outPath);

  console.log(`Фактический хеш: ${actual}`);
  if (crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(actual,   'hex'))) {
    console.log('✅ Целостность подтверждена: хеши совпадают');
    return true;
  } else {
    console.error('❌ ОШИБКА: хеши НЕ совпадают (данные повреждены)');
    return false;
  }
}

async function main() {
  const [, , cmd, file] = process.argv;

  if (!cmd || !file) {
    console.log('Использование:');
    console.log('  node index.js compress <file>');
    console.log('  node index.js verify <file>');
    process.exit(1);
  }

  try {
    if (cmd === 'compress') {
      await compress(file);
    } else if (cmd === 'verify') {
      const ok = await verify(file);
      process.exit(ok ? 0 : 2);
    } else {
      console.error(`Неизвестная команда: ${cmd}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Ошибка:', err.message);
    process.exit(1);
  }
}

main();
