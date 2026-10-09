import { deflateSync } from 'node:zlib';

// Deterministic geometric test patterns, not generated creative deliverables.
export function canvasFixtureImage(width: number, height: number, variant: number): Buffer {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  const colors = [[206, 135, 48], [109, 136, 154], [72, 137, 104]];
  const accent = colors[variant % colors.length];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = x / width; const ny = y / height;
    let color = [241 - Math.round(ny * 12), 243 - Math.round(ny * 12), 244 - Math.round(ny * 10)];
    if (variant === 1) {
      if ((nx - 0.72) ** 2 + (ny - 0.48) ** 2 < 0.09) color = accent;
      if (nx > 0.08 && nx < 0.48 && (ny > 0.34 && ny < 0.41 || ny > 0.46 && ny < 0.49)) color = [36, 49, 58];
    } else {
      if (nx > 0.32 && nx < 0.68 && ny > 0.2 && ny < 0.83) color = accent;
      if (nx > 0.36 && nx < 0.64 && ny > 0.14 && ny < 0.22) color = [42, 49, 53];
      if (nx > 0.4 && nx < 0.6 && ny > 0.45 && ny < 0.65) color = [251, 250, 247];
    }
    const offset = y * (width * 4 + 1) + 1 + x * 4;
    scanlines[offset] = color[0]; scanlines[offset + 1] = color[1]; scanlines[offset + 2] = color[2]; scanlines[offset + 3] = 255;
  }
  const chunk = (name: string, payload: Buffer) => {
    const type = Buffer.from(name); const crcInput = Buffer.concat([type, payload]);
    let crc = 0xffffffff;
    for (const byte of crcInput) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const result = Buffer.alloc(payload.length + 12); result.writeUInt32BE(payload.length); type.copy(result, 4); payload.copy(result, 8); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, payload.length + 8); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
