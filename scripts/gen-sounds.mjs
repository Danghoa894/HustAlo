#!/usr/bin/env node
// scripts/gen-sounds.mjs — sinh âm báo cuộc gọi (FR-CALL-011) dạng WAV PCM 16-bit mono, chỉ dùng Node thuần.
// Output (commit vào repo): client/public/sounds/ringtone.wav (callee, lặp), client/public/sounds/ringback.wav (caller, lặp).
//   node scripts/gen-sounds.mjs
// Kết quả xác định (không ngẫu nhiên) → chạy lại cho ra đúng byte cũ.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'client', 'public', 'sounds');
const SAMPLE_RATE = 16_000;
const FADE_S = 0.01; // tránh tiếng "bụp" ở đầu/cuối mỗi nốt

/** Một đoạn: tần số (Hz, cộng nhiều sóng sin nếu là mảng) hoặc null = im lặng, kèm thời lượng (s). */
function render(segments, gain) {
  const total = segments.reduce((n, s) => n + Math.round(s.dur * SAMPLE_RATE), 0);
  const pcm = new Int16Array(total);
  let offset = 0;
  for (const { freq, dur } of segments) {
    const n = Math.round(dur * SAMPLE_RATE);
    const fade = Math.min(Math.round(FADE_S * SAMPLE_RATE), Math.floor(n / 2));
    const freqs = freq === null ? [] : [freq].flat();
    for (let i = 0; i < n && freqs.length > 0; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.min(1, i / fade, (n - 1 - i) / fade);
      const v = freqs.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t), 0) / freqs.length;
      pcm[offset + i] = Math.round(v * env * gain * 32_767);
    }
    offset += n;
  }
  return pcm;
}

function wav(pcm) {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // kích thước chunk fmt
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bit/mẫu
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return buf;
}

const note = (freq, dur) => ({ freq, dur });
const rest = (dur) => ({ freq: null, dur });

// Nhạc chuông: hai cụm nốt Mi6–Đô6 xen kẽ, nghỉ 1 s (chu kỳ 2.4 s).
const ringtone = [
  ...[1318.5, 1046.5, 1318.5, 1046.5].flatMap((f) => [note(f, 0.12), rest(0.03)]),
  rest(0.2),
  ...[1318.5, 1046.5, 1318.5, 1046.5].flatMap((f) => [note(f, 0.12), rest(0.03)]),
  rest(1.0),
];
// Âm chờ: 425 Hz, 1 s kêu / 4 s nghỉ (chu kỳ 5 s).
const ringback = [note(425, 1), rest(4)];

mkdirSync(outDir, { recursive: true });
for (const [name, segments, gain] of [
  ['ringtone.wav', ringtone, 0.5],
  ['ringback.wav', ringback, 0.4],
]) {
  const file = join(outDir, name);
  const bytes = wav(render(segments, gain));
  writeFileSync(file, bytes);
  console.log(`${file} (${bytes.length} byte)`);
}
