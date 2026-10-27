#!/usr/bin/env node
// scripts/spec-check.mjs — đối chiếu chéo các file trong .spec/ (npm run spec:check, development_guide.md §8.8b).
// Chỉ dùng Node built-in. Exit 1 khi có lỗi. `--fix-matrix`: sinh lại cột AC/EC/Test ID của Traceability Matrix từ PRD.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = path.join(ROOT, '.spec');
const FILES = {
  arch: 'system_architecture.md',
  prd: 'product_requirements.md',
  db: 'database_schema.md',
  api: 'api_spec.yaml',
  ui: 'ui_ux_spec.md',
  dev: 'development_guide.md',
};
const raw = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, readFileSync(path.join(SPEC, f), 'utf8')]));
const T = Object.fromEntries(Object.entries(raw).map(([k, t]) => [k, t.replace(/\r\n/g, '\n')]));
const FIX_MATRIX = process.argv.includes('--fix-matrix');

const errors = [];
const err = (check, msg) => errors.push(`[${check}] ${msg}`);
const section = (text, startRe, endRe) => {
  const s = text.search(startRe);
  if (s < 0) return '';
  const rest = text.slice(s);
  const nl = rest.indexOf('\n') + 1; // bỏ dòng tiêu đề trước khi tìm tiêu đề kết thúc
  const e = rest.slice(nl).search(endRe);
  return e < 0 ? rest : rest.slice(0, nl + e);
};
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const uniq = (a) => [...new Set(a)];
const diff = (a, b) => [...a].filter((x) => !b.has(x));

// ---------------------------------------------------------------- ID
const EC_GROUPS = 'AUTH|NET|MSG|GROUP|PRES|CALL-SIG|CALL-MEDIA|CALL-NET|INFRA|SEC|E2EE';
const EC_RE = new RegExp(`\\bEC-(?:${EC_GROUPS})-\\d{3}\\b`, 'g');
const EC_RANGE_RE = new RegExp(`\\b(EC-(?:${EC_GROUPS})-)(\\d{3})\\.\\.(?:EC-(?:${EC_GROUPS})-)?(\\d{3})\\b`, 'g');
const pad = (n) => String(n).padStart(3, '0');

function idsIn(text) {
  const ac = text.match(/\bAC-\d{3}\b/g) ?? [];
  const ec = [];
  for (const m of text.matchAll(EC_RANGE_RE)) for (let i = +m[2]; i <= +m[3]; i++) ec.push(m[1] + pad(i));
  ec.push(...(text.match(EC_RE) ?? []));
  return { ac: uniq(ac), ec: uniq(ec) };
}

// FR trong PRD
const frs = new Map();
for (const m of T.prd.matchAll(/^#### (FR-[A-Z0-9]+-\d{3}) — [^\n]*\n([\s\S]*?)(?=^#### |^### |^## )/gm)) {
  const acLine = m[2].match(/\*\*AC:\*\*([^\n]*?)(?:\*\*EC:\*\*([^\n]*))?$/m);
  if (!acLine) { err('FR', `${m[1]} không có dòng **AC:**`); frs.set(m[1], { ac: [], ec: [] }); continue; }
  frs.set(m[1], { ac: idsIn(acLine[1]).ac, ec: idsIn(acLine[2] ?? '').ec });
}
// AC trong PRD
const acRows = new Map();
for (const m of T.prd.matchAll(/^\| (AC-\d{3}) \| ([^|]*) \|/gm)) acRows.set(m[1], uniq(m[2].match(/FR-[A-Z0-9]+-\d{3}/g) ?? []));
// EC trong ma trận PRD
const ecRows = new Map();
for (const m of T.prd.matchAll(new RegExp(`^\\| (EC-(?:${EC_GROUPS})-\\d{3}) \\|[^\\n]*\\| ([^|\\n]*) \\|\\s*$`, 'gm'))) ecRows.set(m[1], m[2].trim());
// Registry kiến trúc Phụ lục C
const archC = section(T.arch, /^## Phụ lục C/m, /^## /m);
const archEc = new Set([...archC.matchAll(new RegExp(`^\\| (EC-(?:${EC_GROUPS})-\\d{3}) \\|`, 'gm'))].map((m) => m[1]));
const archAcArch = new Set([...T.arch.matchAll(/^\| (AC-ARCH-\d{3}) \|/gm)].map((m) => m[1]));
const dbTc = new Set([...T.db.matchAll(/^\| (TC-DB-\d{3}) \|/gm)].map((m) => m[1]));

// 1. FR ↔ AC
for (const [fr, { ac }] of frs) {
  if (ac.length === 0) err('FR-AC', `${fr} không có AC`);
  for (const a of ac) {
    if (!acRows.has(a)) err('FR-AC', `${fr} liệt kê ${a} không tồn tại`);
    else if (!acRows.get(a).includes(fr)) err('FR-AC', `${fr} liệt kê ${a} nhưng cột FR của ${a} là ${acRows.get(a).join(', ')}`);
  }
}
for (const [a, list] of acRows) {
  for (const fr of list) {
    if (!frs.has(fr)) err('FR-AC', `${a} tham chiếu ${fr} không tồn tại`);
    else if (!frs.get(fr).ac.includes(a)) err('FR-AC', `${a} ghi ${fr} nhưng ${fr} không liệt kê ${a}`);
  }
}
// 2. EC: registry, Test ID, FR tham chiếu
const prdEc = new Set(ecRows.keys());
for (const e of diff(archEc, prdEc)) err('EC', `${e} có trong kiến trúc Phụ lục C nhưng thiếu ở ma trận PRD`);
for (const e of diff(prdEc, archEc)) err('EC', `${e} có trong ma trận PRD nhưng thiếu ở kiến trúc Phụ lục C`);
for (const [e, tc] of ecRows) if (tc !== `TC-${e.slice(3)}`) err('EC', `${e} có Test ID "${tc}", phải là TC-${e.slice(3)}`);
const frEc = new Set([...frs.values()].flatMap((v) => v.ec));
for (const e of prdEc) if (!frEc.has(e)) err('EC', `${e} không được FR nào tham chiếu`);
for (const e of frEc) if (!prdEc.has(e)) err('EC', `FR tham chiếu ${e} không tồn tại`);
const total = archC.match(/Tổng: (\d+) edge case/);
if (!total || +total[1] !== archEc.size) err('EC', `kiến trúc ghi "Tổng: ${total?.[1]}" nhưng registry có ${archEc.size} EC`);

// 3. ID tham chiếu phải tồn tại
const knownFr = new Set(frs.keys());
const knownAc = new Set(acRows.keys());
for (const [k, text] of Object.entries(T)) {
  for (const m of text.matchAll(/\b(?:FR-[A-Z0-9]+-\d{3}|AC-ARCH-\d{3}|AC-\d{3}|TC-[A-Z0-9]+(?:-[A-Z]+)?-\d{3})\b/g)) {
    const id = m[0];
    let ok = true;
    if (id.startsWith('FR-')) ok = knownFr.has(id);
    else if (id.startsWith('AC-ARCH-')) ok = archAcArch.has(id);
    else if (id.startsWith('AC-')) ok = knownAc.has(id);
    else if (id.startsWith('TC-AC-')) ok = knownAc.has(id.slice(3));
    else if (id.startsWith('TC-ARCH-')) ok = archAcArch.has(`AC-${id.slice(3)}`);
    else if (id.startsWith('TC-DB-')) ok = dbTc.has(id);
    else ok = prdEc.has(`EC-${id.slice(3)}`);
    if (!ok) err('ID', `${FILES[k]}:${lineOf(text, m.index)} tham chiếu ${id} không tồn tại`);
  }
  for (const m of text.matchAll(EC_RE)) {
    if (!prdEc.has(m[0])) err('ID', `${FILES[k]}:${lineOf(text, m.index)} tham chiếu ${m[0]} không tồn tại`);
  }
}

// 4. Traceability Matrix ↔ PRD
const devLines = raw.dev.split('\n');
const tmStart = devLines.findIndex((l) => /^## Traceability Matrix/.test(l));
const tmRows = new Map();
let matrixChanged = false;
for (let i = tmStart; i >= 0 && i < devLines.length; i++) {
  const line = devLines[i].replace(/\r$/, '');
  if (i > tmStart && /^## /.test(line)) break;
  const m = line.match(/^\| (FR-[A-Z0-9]+-\d{3}) \|/);
  if (!m) continue;
  const cols = line.split(' | ');
  cols[0] = cols[0].replace(/^\| /, '');
  cols[cols.length - 1] = cols[cols.length - 1].replace(/ \|$/, '');
  if (cols.length !== 8) { err('TM', `development_guide.md:${i + 1} dòng ${m[1]} không đủ 8 cột`); continue; }
  tmRows.set(m[1], i);
  const fr = frs.get(m[1]);
  if (!fr) { err('TM', `${m[1]} trong Traceability Matrix không có trong PRD`); continue; }
  const tmAc = cols[1].match(/\bAC-\d{3}\b/g) ?? [];
  const tmArch = cols[1].match(/\bAC-ARCH-\d{3}\b/g) ?? [];
  const tmEc = idsIn(cols[2]).ec;
  const tcs = cols[6].match(/\bTC-[A-Z0-9]+(?:-[A-Z]+)?-\d{3}\b/g) ?? [];
  if (FIX_MATRIX) {
    const ac = [...fr.ac].sort();
    cols[1] = [...ac, ...tmArch].join(', ') || '—';
    cols[2] = fr.ec.join(', ') || '—';
    const tcArch = uniq([...tmArch.map((a) => `TC-${a.slice(3)}`), ...tcs.filter((t) => t.startsWith('TC-ARCH-'))]);
    const tcDb = tcs.filter((t) => t.startsWith('TC-DB-'));
    cols[6] = uniq([...ac.map((a) => `TC-${a}`), ...tcArch, ...fr.ec.map((e) => `TC-${e.slice(3)}`), ...tcDb]).join(', ');
    const next = `| ${cols.join(' | ')} |${devLines[i].endsWith('\r') ? '\r' : ''}`;
    if (next !== devLines[i]) { devLines[i] = next; matrixChanged = true; }
    continue;
  }
  const sa = new Set(fr.ac), st = new Set(tmAc);
  if (diff(sa, st).length || diff(st, sa).length) err('TM', `${m[1]} AC lệch PRD: thiếu [${diff(sa, st)}], thừa [${diff(st, sa)}]`);
  const se = new Set(fr.ec), ste = new Set(tmEc);
  if (diff(se, ste).length || diff(ste, se).length) err('TM', `${m[1]} EC lệch PRD: thiếu [${diff(se, ste)}], thừa [${diff(ste, se)}]`);
  const need = [...tmAc.map((a) => `TC-${a}`), ...tmArch.map((a) => `TC-${a.slice(3)}`), ...tmEc.map((e) => `TC-${e.slice(3)}`)];
  const miss = need.filter((t) => !tcs.includes(t));
  if (miss.length) err('TM', `${m[1]} cột Test ID thiếu ${miss.join(', ')}`);
}
for (const fr of frs.keys()) if (!tmRows.has(fr)) err('TM', `${fr} không có dòng trong Traceability Matrix`);
if (FIX_MATRIX && matrixChanged) {
  writeFileSync(path.join(SPEC, FILES.dev), devLines.join('\n'));
  console.log('Đã sinh lại Traceability Matrix từ PRD. Chạy lại không có --fix-matrix để kiểm.');
}

// 5. Gate milestone phủ mọi TC-AC / TC-EC
const gateText = T.dev.split('\n').filter((l) => l.startsWith('Gate:')).join('\n');
const gateIds = new Set(gateText.match(/\bTC-[A-Z0-9]+(?:-[A-Z]+)?-\d{3}\b/g) ?? []);
for (const m of gateText.matchAll(/\b(TC-[A-Z0-9]+(?:-[A-Z]+)?-)(\d{3})\.\.(\d{3})\b/g)) for (let i = +m[2]; i <= +m[3]; i++) gateIds.add(m[1] + pad(i));
for (const a of knownAc) if (!gateIds.has(`TC-${a}`)) err('GATE', `TC-${a} không nằm trong Gate milestone nào`);
for (const e of prdEc) if (!gateIds.has(`TC-${e.slice(3)}`)) err('GATE', `TC-${e.slice(3)} không nằm trong Gate milestone nào`);

// ---------------------------------------------------------------- api_spec.yaml (parse theo thụt lề)
const apiLines = T.api.split('\n');
function yamlBlock(name, indent = 4) {
  const head = new RegExp(`^${' '.repeat(indent)}${name}:\\s*$`);
  const i = apiLines.findIndex((l) => head.test(l));
  if (i < 0) return null;
  const out = [];
  for (let j = i + 1; j < apiLines.length; j++) {
    const l = apiLines[j];
    if (l.trim() !== '' && l.search(/\S/) <= indent && !l.trimStart().startsWith('#')) break;
    out.push(l);
  }
  return out;
}
function yamlEnum(name) {
  const b = yamlBlock(name);
  if (!b) return null;
  const k = b.findIndex((l) => /^\s+enum:/.test(l));
  if (k < 0) return null;
  const inline = b[k].match(/enum:\s*\[(.*)\]/);
  if (inline) return inline[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  const vals = [];
  for (let j = k + 1; j < b.length && /^\s+- /.test(b[j]); j++) vals.push(b[j].replace(/^\s+- /, '').trim().replace(/^'|'$/g, ''));
  return vals;
}
const ops = [];
{
  const s = apiLines.findIndex((l) => l === 'paths:');
  let curPath = null, cur = null, inResp = false;
  for (let j = s + 1; j < apiLines.length && !/^\S/.test(apiLines[j]); j++) {
    const l = apiLines[j];
    let m;
    if ((m = l.match(/^  (\/\S*):\s*$/))) { curPath = m[1]; continue; }
    if ((m = l.match(/^    (get|post|put|patch|delete):\s*$/))) { cur = { method: m[1].toUpperCase(), path: curPath, responses: [], rateLimit: null, line: j + 1 }; ops.push(cur); inResp = false; continue; }
    if (!cur) continue;
    if ((m = l.match(/^      operationId: (\S+)/))) cur.operationId = m[1];
    if ((m = l.match(/^      x-rate-limit: (\S+)/))) cur.rateLimit = m[1];
    if (/^      responses:\s*$/.test(l)) { inResp = true; continue; }
    if (/^      \S/.test(l)) inResp = false;
    if (inResp && (m = l.match(/^        '(\d{3})':/))) cur.responses.push(m[1]);
  }
}

// 6. Endpoint: api ↔ kiến trúc §4.6
const normPath = (p) => p.split('?')[0].replace(/\{[^}]+\}/g, '{}');
const arch46 = section(T.arch, /^### 4\.6 /m, /^## |^### /m);
const archEps = new Map();
for (const m of arch46.matchAll(/^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)`[^|]*\| [^|]*\| ([^|]*) \|/gm)) archEps.set(`${m[1]} ${normPath(m[2])}`, m[3].trim());
const apiEps = new Map(ops.map((o) => [`${o.method} ${normPath(o.path)}`, o]));
for (const k of diff(new Set(archEps.keys()), new Set(apiEps.keys()))) err('ENDPOINT', `${k} có ở kiến trúc §4.6 nhưng thiếu trong api_spec`);
for (const k of diff(new Set(apiEps.keys()), new Set(archEps.keys()))) err('ENDPOINT', `${k} có trong api_spec nhưng thiếu ở kiến trúc §4.6`);
// 7. Mọi operation (trừ /health) có 503; rate limit khớp kiến trúc
for (const o of ops) {
  if (o.path === '/health') continue;
  if (!o.responses.includes('503')) err('API-503', `${o.method} ${o.path} (api_spec.yaml:${o.line}) thiếu response 503`);
  const a = archEps.get(`${o.method} ${normPath(o.path)}`);
  if (a !== undefined && a !== (o.rateLimit ?? '—')) err('RATE', `${o.method} ${o.path}: x-rate-limit "${o.rateLimit}" ≠ kiến trúc §4.6 "${a}"`);
}

// 8. Event: bảng §4.5 ↔ x-socket-events; mọi event được nhắc phải hợp lệ
const arch45 = section(T.arch, /^### 4\.5 /m, /^### 4\.6 /m);
const archEvents = new Set([...arch45.matchAll(/^\| `([a-z0-9]+:[a-z-]+)` \|/gm)].map((m) => m[1]));
const apiEventsSec = T.api.slice(T.api.indexOf('\nx-socket-events:'));
const apiEvents = new Set([...apiEventsSec.matchAll(/^    ([a-z0-9]+:[a-z-]+):\s*$/gm)].map((m) => m[1]));
for (const e of diff(archEvents, apiEvents)) err('EVENT', `${e} có ở kiến trúc §4.5 nhưng thiếu trong x-socket-events`);
for (const e of diff(apiEvents, archEvents)) err('EVENT', `${e} có trong x-socket-events nhưng thiếu ở kiến trúc §4.5`);
const archA = section(T.arch, /^## Phụ lục A/m, /^## /m);
const redisPrefixes = new Set([...archA.matchAll(/^\| `([a-z0-9]+:[a-z-]+)/gm)].map((m) => m[1]));
const BANNED_EVENTS = new Set(['message:ack', 'call:initiate']); // chỉ được nhắc trong câu phủ định
for (const [k, text] of Object.entries(T)) {
  for (const m of text.matchAll(/(?<![\w/:.-])((?:session|conversation|message|typing|presence|call|e2ee):[a-z][a-z-]*)(?![\p{L}\w-])/gu)) {
    const e = m[1];
    if (archEvents.has(e) || redisPrefixes.has(e) || BANNED_EVENTS.has(e)) continue;
    err('EVENT', `${FILES[k]}:${lineOf(text, m.index)} nhắc "${e}" không phải event/Redis key hợp lệ`);
  }
}

// 9. Enum và ErrorCode: api ↔ kiến trúc §4.4
const arch442 = section(T.arch, /^#### 4\.4\.2 /m, /^#### 4\.4\.3 /m);
const arch443 = section(T.arch, /^#### 4\.4\.3 /m, /^### 4\.5 /m);
const archEnums = new Map();
for (const m of arch442.matchAll(/export const (\w+) = \{([\s\S]*?)\} as const;/g)) {
  archEnums.set(m[1], [...m[2].matchAll(/\w+: (?:'([^']+)'|(\d+))/g)].map((v) => v[1] ?? v[2]));
}
const ec443 = arch443.match(/export const ErrorCode = \{([\s\S]*?)\} as const;/);
archEnums.set('ErrorCode', ec443 ? [...ec443[1].matchAll(/\w+: '([^']+)'/g)].map((v) => v[1]) : []);
const API_ENUM_OPTIONAL = new Set(['CallLocalPhase', 'UserStatus']); // client-only / không lộ ra API
for (const [name, vals] of archEnums) {
  const apiVals = yamlEnum(name);
  if (!apiVals) { if (!API_ENUM_OPTIONAL.has(name)) err('ENUM', `${name} thiếu trong api_spec components/schemas`); continue; }
  if (apiVals.join(',') !== vals.join(',')) err('ENUM', `${name}: api [${apiVals}] ≠ kiến trúc [${vals}]`);
}

// 10. Hằng số: tên phải được định nghĩa, giá trị ghi kèm phải khớp
const arch441 = section(T.arch, /^#### 4\.4\.1 /m, /^#### 4\.4\.2 /m);
const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const consts = new Map();
for (const m of arch441.replace(/\/\/[^\n]*/g, '').matchAll(/export const (\w+) = ([^;]+);/g)) {
  const expr = m[2].replace(/\s+as const$/, '');
  try { consts.set(m[1], new Function('SECOND', 'MINUTE', 'HOUR', 'DAY', `return (${expr});`)(SECOND, MINUTE, HOUR, DAY)); } catch { consts.set(m[1], null); }
}
const rateRules = new Set(Object.keys(consts.get('RATE_LIMITS') ?? {}));
const envVars = new Set([...T.dev.matchAll(/^#? ?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const archD = section(T.arch, /^## Phụ lục D/m, /^## /m);
for (const m of archD.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm)) envVars.add(m[1]);
const enumNames = new Set([...T.arch.matchAll(/export const (\w+)/g)].map((m) => m[1]));
const enumValues = new Set([...archEnums.values()].flat());
// Token không phải hằng số: actor state machine (§8.2), kết quả Lua (database_schema §5.4), ví dụ cấm trong PRD.
const NON_CONST = new Set(['CALLER_TAB', 'CALLEE_ANY', 'CALLEE_TAB', 'CALLER_IN_CALL', 'VITE_XIRSYS_SECRET']);
const isKnown = (n) => consts.has(n) || enumNames.has(n) || enumValues.has(n) || envVars.has(n) || NON_CONST.has(n);
const UNIT = { ms: 1, s: SECOND, 'giây': SECOND, 'phút': MINUTE, "'": MINUTE, h: HOUR, 'giờ': HOUR, 'ngày': DAY, kb: 1024, kib: 1024 };
const numericConsts = [...consts.entries()].filter(([, v]) => typeof v === 'number').map(([k]) => k).sort((a, b) => b.length - a.length);
const valueRe = new RegExp(`\`(${numericConsts.join('|')})\`\\s*(?:\\(|=)\\s*([\\d.,]+)\\s*(ms|s|giây|phút|h|giờ|ngày|KB|KiB|')?(?![\\w])`, 'g');
for (const [k, text] of Object.entries(T)) {
  const scan = k === 'arch' ? text.replace(arch441, '') : text;
  for (const m of scan.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)) {
    if (!isKnown(m[1])) err('CONST', `${FILES[k]}:${lineOf(scan, m.index)} \`${m[1]}\` không có trong constants.ts / enum / env`);
  }
  for (const m of scan.matchAll(valueRe)) {
    const [, name, num, unitRaw] = m;
    const v = consts.get(name);
    const n = Number(num.replace(',', '.'));
    const unit = unitRaw ? UNIT[unitRaw.toLowerCase()] : null;
    let expected = v, got = n;
    if (name.endsWith('_MS')) got = n * (unit ?? 1);
    else if (name.endsWith('_S')) { expected = v * SECOND; got = n * (unit ?? SECOND); }
    else if (name.endsWith('_BYTES')) got = n * (unit ?? 1);
    if (Math.abs(expected - got) > 1e-6) err('CONST', `${FILES[k]}:${lineOf(scan, m.index)} ${name} ghi ${num}${unitRaw ?? ''} nhưng constants.ts = ${v}`);
  }
}
// Rule rate limit được nhắc trong api/kiến trúc phải tồn tại
for (const o of ops) if (o.rateLimit && !rateRules.has(o.rateLimit)) err('RATE', `${o.method} ${o.path}: rule "${o.rateLimit}" không có trong RATE_LIMITS`);
for (const m of apiEventsSec.matchAll(/^      rateLimit: (\S+)/gm)) if (!rateRules.has(m[1])) err('RATE', `x-socket-events rateLimit "${m[1]}" không có trong RATE_LIMITS`);

// 11. Chuỗi UI chính thức phải có trong ui_ux_spec.md
const uiText = T.ui;
const quoted = (s) => [...s.matchAll(/"([^"\n]{2,})"/g)].map((m) => m[1]);
const s86 = section(T.arch, /^### 8\.6 /m, /^## |^### /m);
const prdSystem = section(T.prd, /^#### FR-CHAT-011 /m, /^#### /m);
const prdLastSeen = section(T.prd, /^#### FR-PRES-002 /m, /^#### /m);
for (const [src, s] of [['kiến trúc §8.6', s86], ['PRD FR-CHAT-011', prdSystem], ['PRD FR-PRES-002', prdLastSeen]]) {
  for (const str of uniq(quoted(s))) if (!uiText.includes(str)) err('UI', `chuỗi "${str}" (${src}) không có trong ui_ux_spec.md`);
}

// ---------------------------------------------------------------- kết quả
const summary = `FR ${frs.size} · AC ${acRows.size} · EC ${prdEc.size} · event ${archEvents.size} · endpoint ${apiEps.size} · hằng số ${consts.size}`;
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\nspec-check: ${errors.length} lỗi (${summary})`);
  process.exit(1);
}
console.log(`spec-check: OK (${summary})`);
