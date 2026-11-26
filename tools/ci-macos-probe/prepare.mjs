import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const [sourceArgument, stageArgument] = process.argv.slice(2);
assert.ok(sourceArgument && stageArgument, 'Usage: node prepare.mjs SHARED_FRONTEND STAGE');
const source = resolve(sourceArgument);
const stage = resolve(stageArgument);
const here = dirname(fileURLToPath(import.meta.url));
assert.notEqual(source, stage);
const dist = join(stage, 'dist');
const icons = join(stage, 'src-tauri', 'icons');
await mkdir(dist, { recursive: false });
await cp(join(here, 'src-tauri'), join(stage, 'src-tauri'), { recursive: true });
await mkdir(icons);

const inputs = {};
for (const name of ['index.html', 'app.css', 'app.mjs']) {
  const file = await readFile(join(source, name));
  inputs[name] = createHash('sha256').update(file).digest('hex');
  if (name === 'index.html') {
    const html = file.toString('utf8');
    const original = '<script type="module" src="./app.mjs"></script>';
    assert.equal(html.split(original).length, 2, 'Expected one shared module entry');
    await writeFile(join(dist, name), html.replace(original, '<script type="module" src="./probe.mjs"></script>'));
  } else {
    await writeFile(join(dist, name), file);
  }
}
await cp(join(here, 'probe.mjs'), join(dist, 'probe.mjs'));
await writeFile(join(stage, 'shared-assets.json'), JSON.stringify(inputs, null, 2) + '\n');

function chunk(type, data) {
  const part = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(part));
  return Buffer.concat([length, part, checksum]);
}
const size = 128;
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const pixels = Buffer.alloc(size * (1 + 4 * size));
for (let row = 0; row < size; row++) pixels.fill(Buffer.from([79, 70, 184, 255]), row * (1 + 4 * size) + 1, (row + 1) * (1 + 4 * size));
const png = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
]);
await writeFile(join(icons, 'icon.png'), png);
const iconDirectory = Buffer.alloc(22);
iconDirectory.writeUInt16LE(1, 2);
iconDirectory.writeUInt16LE(1, 4);
iconDirectory[6] = size;
iconDirectory[7] = size;
iconDirectory.writeUInt16LE(1, 10);
iconDirectory.writeUInt16LE(32, 12);
iconDirectory.writeUInt32LE(png.length, 14);
iconDirectory.writeUInt32LE(iconDirectory.length, 18);
await writeFile(join(icons, 'icon.ico'), Buffer.concat([iconDirectory, png]));
