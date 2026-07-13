const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const SCALE = 4;
const HI = SIZE * SCALE;

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function blend(base, over) {
  const alpha = over[3] / 255;
  return [
    Math.round(base[0] * (1 - alpha) + over[0] * alpha),
    Math.round(base[1] * (1 - alpha) + over[1] * alpha),
    Math.round(base[2] * (1 - alpha) + over[2] * alpha),
    Math.round(Math.max(base[3], over[3])),
  ];
}

function sample(x, y) {
  if (!insideRoundedRect(x, y, 10, 10, 246, 246, 56)) return [0, 0, 0, 0];

  const glow = Math.max(0, 1 - Math.hypot(x - 44, y - 38) / 250);
  let color = [
    Math.round(8 + 31 * glow),
    Math.round(7 + 3 * glow),
    Math.round(12 + 6 * glow),
    255,
  ];

  if (!insideRoundedRect(x, y, 15, 15, 241, 241, 51)) {
    color = [220, 38, 56, 255];
  }

  if (insideRoundedRect(x, y, 24, 24, 232, 232, 44) && y < 52) {
    color = blend(color, [255, 255, 255, 18]);
  }

  const white = [255, 248, 248, 255];
  const pink = [254, 202, 202, 255];
  const red = [251, 82, 104, 255];

  const rShapes = [
    [[49, 67], [78, 67], [78, 190], [49, 190]],
    [[70, 67], [123, 67], [140, 82], [140, 116], [124, 133], [76, 133], [76, 108], [111, 108], [114, 104], [114, 91], [109, 87], [70, 87]],
    [[91, 125], [121, 125], [155, 190], [124, 190]],
  ];
  if (rShapes.some((shape) => insidePolygon(x, y, shape))) color = blend(color, white);

  const xShapes = [
    [[151, 69], [180, 69], [224, 190], [195, 190]],
    [[195, 69], [224, 69], [180, 190], [151, 190]],
  ];
  if (xShapes.some((shape) => insidePolygon(x, y, shape))) color = blend(color, pink);

  const slashY = 184 - 0.445 * x;
  const slashDistance = Math.abs(y - slashY);
  if (x > 18 && x < 238 && slashDistance < 5.5) {
    const mix = Math.max(0, Math.min(1, (x - 45) / 165));
    color = blend(color, [
      Math.round(255 - 4 * mix),
      Math.round(255 - 173 * mix),
      Math.round(255 - 151 * mix),
      255,
    ]);
  } else if (x > 60 && x < 214 && slashDistance < 9) {
    color = blend(color, [239, 68, 68, 85]);
  }

  const subSlashY = 204 - 0.445 * x;
  if (x > 82 && x < 222 && Math.abs(y - subSlashY) < 2.2) color = blend(color, red);

  const dotDistance = Math.hypot(x - 205, y - 196);
  if (dotDistance < 6) color = blend(color, red);

  return color;
}

function render() {
  const output = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const total = [0, 0, 0, 0];
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const pixel = sample(x + (sx + 0.5) / SCALE, y + (sy + 0.5) / SCALE);
          for (let channel = 0; channel < 4; channel += 1) total[channel] += pixel[channel];
        }
      }
      const offset = (y * SIZE + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[offset + channel] = Math.round(total[channel] / (SCALE * SCALE));
      }
    }
  }
  return output;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const chunk = Buffer.concat([name, data]);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  chunk.copy(output, 4);
  output.writeUInt32BE(crc32(chunk), data.length + 8);
  return output;
}

function createPng(rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createIco(rgba) {
  const maskStride = Math.ceil(SIZE / 32) * 4;
  const dibSize = 40 + SIZE * SIZE * 4 + maskStride * SIZE;
  const output = Buffer.alloc(22 + dibSize);
  output.writeUInt16LE(0, 0);
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(1, 4);
  output[6] = 0;
  output[7] = 0;
  output.writeUInt16LE(1, 10);
  output.writeUInt16LE(32, 12);
  output.writeUInt32LE(dibSize, 14);
  output.writeUInt32LE(22, 18);
  output.writeUInt32LE(40, 22);
  output.writeInt32LE(SIZE, 26);
  output.writeInt32LE(SIZE * 2, 30);
  output.writeUInt16LE(1, 34);
  output.writeUInt16LE(32, 36);
  output.writeUInt32LE(SIZE * SIZE * 4, 42);

  let cursor = 62;
  for (let y = SIZE - 1; y >= 0; y -= 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const source = (y * SIZE + x) * 4;
      output[cursor++] = rgba[source + 2];
      output[cursor++] = rgba[source + 1];
      output[cursor++] = rgba[source];
      output[cursor++] = rgba[source + 3];
    }
  }
  return output;
}

const buildDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });
const rgba = render();
fs.writeFileSync(path.join(buildDir, 'icon.png'), createPng(rgba));
fs.writeFileSync(path.join(buildDir, 'icon.ico'), createIco(rgba));
console.log(`Iconite generate in ${buildDir}`);
