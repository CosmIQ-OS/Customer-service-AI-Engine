import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openDatabase, redactDatabaseUrl, type DB } from '../src/db/database.js';
import { AdminAuth, type AdminAuthOptions } from '../src/auth/admin-auth.js';
import { SupportEngine } from '../src/engine/support-engine.js';
import { MockLLMProvider } from '../src/llm/mock.js';
import { createApp, type AppOptions } from '../src/server/app.js';
import { loadConfig, resolveDatabaseTarget } from '../src/config/index.js';

export { openDatabase, redactDatabaseUrl, loadConfig, resolveDatabaseTarget };
export type { DB, AdminAuthOptions, AppOptions };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..');

export interface E2EServerOptions {
  dbTarget?: string;
  authOptions?: Partial<AdminAuthOptions>;
  adminUsername?: string;
  adminPassword?: string;
  adminDisplayName?: string;
  dashboardOrigin?: string;
  webhookSecret?: string;
  extraAppOptions?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
  rawText: string;
}

export interface E2EServer {
  baseUrl: string;
  cookie: string;
  db: DB;
  auth: AdminAuth;
  engine: SupportEngine;
  apiRaw: (routePath: string, init?: RequestInit) => Promise<Response>;
  apiJson: <T = any>(
    routePath: string,
    init?: Omit<RequestInit, 'body'> & { body?: unknown },
  ) => Promise<ApiResponse<T>>;
  publicPost: <T = any>(
    routePath: string,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ) => Promise<ApiResponse<T>>;
  publicGet: <T = any>(
    routePath: string,
    extraHeaders?: Record<string, string>,
  ) => Promise<ApiResponse<T>>;
  close: () => Promise<void>;
}

export async function startE2EServer(options: E2EServerOptions = {}): Promise<E2EServer> {
  const db = await openDatabase(options.dbTarget ?? ':memory:');
  const auth = new AdminAuth(db, {
    sessionHours: 1,
    maxFailures: 20,
    ...options.authOptions,
  });

  const adminUsername = options.adminUsername ?? 'e2e_owner';
  const adminPassword = options.adminPassword ?? 'e2e-admin-password-2026';
  const adminDisplayName = options.adminDisplayName ?? 'E2E Owner';
  await auth.createAdmin(adminUsername, adminPassword, adminDisplayName);

  const engine = new SupportEngine(db, {
    sessionTtlMinutes: 120,
    llm: new MockLLMProvider(),
    model: 'mock',
    maxSteps: 6,
    maxHistory: 12,
    temperature: 0,
    tenantId: 'e2e-test',
  });

  const baseAppOptions: AppOptions = {
    auth,
    sessionHours: 1,
    cookieSecure: false,
    dashboardOrigin: options.dashboardOrigin,
    webhookSecret: options.webhookSecret,
  };
  const appOptions: AppOptions = options.extraAppOptions
    ? { ...baseAppOptions, ...(options.extraAppOptions as Partial<AppOptions>) }
    : baseAppOptions;

  const app = createApp(engine, appOptions);
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (err) => reject(err));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  assert.equal(loginRes.status, 200, `Expected admin login 200, got ${loginRes.status}`);
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  const cookie = /cosmiq_admin=[^;]+/.exec(setCookie)?.[0] ?? '';
  assert.ok(cookie.length > 'cosmiq_admin='.length, 'Expected cosmiq_admin cookie from login');

  const parseRes = async <T>(res: Response): Promise<ApiResponse<T>> => {
    const rawText = await res.text();
    let data: unknown = rawText;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      // Leave data as rawText for non-JSON payloads
    }
    return { status: res.status, headers: res.headers, data: data as T, rawText };
  };

  const apiRaw = (routePath: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has('cookie')) headers.set('cookie', cookie);
    return fetch(`${baseUrl}${routePath}`, { ...init, headers });
  };

  const apiJson = async <T = any>(
    routePath: string,
    init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
  ): Promise<ApiResponse<T>> => {
    const headers = new Headers(init.headers);
    headers.set('cookie', cookie);
    let body: BodyInit | undefined;
    if (init.body !== undefined) {
      if (typeof init.body === 'string') {
        body = init.body;
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      } else {
        body = JSON.stringify(init.body);
        headers.set('content-type', 'application/json');
      }
    }
    const res = await fetch(`${baseUrl}${routePath}`, { ...init, headers, body });
    return parseRes<T>(res);
  };

  const publicPost = async <T = any>(
    routePath: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiResponse<T>> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...extraHeaders,
    };
    const serialized = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await fetch(`${baseUrl}${routePath}`, {
      method: 'POST',
      headers,
      body: serialized,
    });
    return parseRes<T>(res);
  };

  const publicGet = async <T = any>(
    routePath: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiResponse<T>> => {
    const res = await fetch(`${baseUrl}${routePath}`, {
      method: 'GET',
      headers: extraHeaders,
    });
    return parseRes<T>(res);
  };

  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  };

  return {
    baseUrl,
    cookie,
    db,
    auth,
    engine,
    apiRaw,
    apiJson,
    publicPost,
    publicGet,
    close,
  };
}

// ---------------------------------------------------------------------------
// Pure Node.js PDF Inspector (node:zlib inflateSync + /ToUnicode CMap + Tj/TJ)
// ---------------------------------------------------------------------------

interface PdfObject {
  id: number;
  gen: number;
  dict: string;
  body: string;
  rawStream?: Buffer;
  decompressedStream?: string;
}

interface FontCMap {
  codeHexWidth: number;
  map: Map<string, string>;
}

export interface PdfInspectionResult {
  header: string;
  hasStartXref: boolean;
  hasEof: boolean;
  pageCount: number;
  fontCount: number;
  toUnicodeFontCount: number;
  imageObjectCount: number;
  textOperatorCount: number;
  vectorOperatorCount: number;
  rawText: string;
  normalizedText: string;
}

function decodeUtf16BeHex(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length === 0) return '';
  const padded = clean.length % 2 === 0 ? clean : `0${clean}`;
  let out = '';
  for (let i = 0; i + 3 < padded.length; i += 4) {
    const codeUnit = parseInt(padded.slice(i, i + 4), 16);
    out += String.fromCharCode(codeUnit);
  }
  if (padded.length === 2) {
    out += String.fromCharCode(parseInt(padded, 16));
  }
  return out;
}

function parseToUnicodeCMap(cmapText: string): FontCMap {
  let codeHexWidth = 4;
  const csMatch = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmapText);
  if (csMatch) {
    const hexMatch = /<([0-9a-fA-F]+)>/.exec(csMatch[1]);
    if (hexMatch) codeHexWidth = hexMatch[1].length;
  }

  const map = new Map<string, string>();

  const bfCharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = bfCharRe.exec(cmapText)) !== null) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let p: RegExpExecArray | null;
    while ((p = pairRe.exec(m[1])) !== null) {
      const src = p[1].toLowerCase().padStart(codeHexWidth, '0');
      map.set(src, decodeUtf16BeHex(p[2]));
    }
  }

  const bfRangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfRangeRe.exec(cmapText)) !== null) {
    const block = m[1];
    // Handle array form and sequential form in order
    const rangeTokenRe =
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:\[([\s\S]*?)\]|<([0-9a-fA-F]+)>)/g;
    let r: RegExpExecArray | null;
    while ((r = rangeTokenRe.exec(block)) !== null) {
      const start = parseInt(r[1], 16);
      const end = parseInt(r[2], 16);
      if (r[3] !== undefined) {
        const dstMatches = [...r[3].matchAll(/<([0-9a-fA-F]+)>/g)];
        for (let i = 0; i <= end - start && i < dstMatches.length; i += 1) {
          const src = (start + i).toString(16).padStart(codeHexWidth, '0').toLowerCase();
          map.set(src, decodeUtf16BeHex(dstMatches[i][1]));
        }
      } else if (r[4] !== undefined) {
        const dstStart = parseInt(r[4], 16);
        const dstWidth = r[4].length;
        for (let i = 0; i <= end - start; i += 1) {
          const src = (start + i).toString(16).padStart(codeHexWidth, '0').toLowerCase();
          const dstHex = (dstStart + i).toString(16).padStart(dstWidth, '0');
          map.set(src, decodeUtf16BeHex(dstHex));
        }
      }
    }
  }

  return { codeHexWidth, map };
}

function unescapePdfLiteral(raw: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      bytes.push(raw.charCodeAt(i) & 0xff);
      continue;
    }
    i += 1;
    if (i >= raw.length) break;
    const esc = raw[i];
    if (esc === 'n') bytes.push(0x0a);
    else if (esc === 'r') bytes.push(0x0d);
    else if (esc === 't') bytes.push(0x09);
    else if (esc === 'b') bytes.push(0x08);
    else if (esc === 'f') bytes.push(0x0c);
    else if (esc === '(' || esc === ')' || esc === '\\') bytes.push(esc.charCodeAt(0));
    else if (esc === '\r') {
      if (raw[i + 1] === '\n') i += 1;
    } else if (esc === '\n') {
      // line continuation
    } else if (esc >= '0' && esc <= '7') {
      let oct = esc;
      for (let k = 0; k < 2 && i + 1 < raw.length; k += 1) {
        const next = raw[i + 1];
        if (next >= '0' && next <= '7') {
          oct += next;
          i += 1;
        } else break;
      }
      bytes.push(parseInt(oct, 8) & 0xff);
    } else {
      bytes.push(esc.charCodeAt(0) & 0xff);
    }
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }
  return Buffer.from(bytes).toString('latin1');
}

function decodeHexOperand(hexRaw: string, cmap?: FontCMap): string {
  const clean = hexRaw.replace(/\s+/g, '').toLowerCase();
  if (!clean) return '';
  if (cmap && cmap.map.size > 0) {
    const step = cmap.codeHexWidth;
    let out = '';
    for (let i = 0; i + step <= clean.length; i += step) {
      const code = clean.slice(i, i + step);
      const mapped = cmap.map.get(code);
      if (mapped !== undefined) {
        out += mapped;
      } else {
        const codeNum = parseInt(code, 16);
        out += codeNum >= 32 && codeNum < 127 ? String.fromCharCode(codeNum) : '';
      }
    }
    return out;
  }
  if (clean.startsWith('feff')) {
    return decodeUtf16BeHex(clean.slice(4));
  }
  return Buffer.from(clean, 'hex').toString('latin1');
}

type StreamToken =
  | { kind: 'literal'; value: string }
  | { kind: 'hex'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'array'; items: StreamToken[] }
  | { kind: 'word'; value: string };

function tokenizeContentStream(src: string): StreamToken[] {
  const tokens: StreamToken[] = [];
  let i = 0;
  const len = src.length;

  const readToken = (): StreamToken | null => {
    while (i < len) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\0') {
        i += 1;
        continue;
      }
      if (ch === '%') {
        while (i < len && src[i] !== '\n' && src[i] !== '\r') i += 1;
        continue;
      }
      break;
    }
    if (i >= len) return null;

    const ch = src[i];
    if (ch === '(') {
      i += 1;
      let depth = 1;
      let raw = '';
      while (i < len && depth > 0) {
        const c = src[i];
        if (c === '\\') {
          raw += c;
          i += 1;
          if (i < len) {
            raw += src[i];
            i += 1;
          }
          continue;
        }
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) {
            i += 1;
            break;
          }
        }
        raw += c;
        i += 1;
      }
      return { kind: 'literal', value: raw };
    }

    if (ch === '<') {
      if (src[i + 1] === '<') {
        i += 2;
        return { kind: 'word', value: '<<' };
      }
      i += 1;
      const start = i;
      while (i < len && src[i] !== '>') i += 1;
      const hex = src.slice(start, i);
      if (src[i] === '>') i += 1;
      return { kind: 'hex', value: hex };
    }

    if (ch === '>' && src[i + 1] === '>') {
      i += 2;
      return { kind: 'word', value: '>>' };
    }

    if (ch === '[') {
      i += 1;
      const items: StreamToken[] = [];
      while (i < len) {
        while (i < len && /\s/.test(src[i])) i += 1;
        if (src[i] === ']') {
          i += 1;
          break;
        }
        const inner = readToken();
        if (!inner) break;
        items.push(inner);
      }
      return { kind: 'array', items };
    }

    if (ch === ']') {
      i += 1;
      return { kind: 'word', value: ']' };
    }

    if (ch === '/') {
      i += 1;
      const start = i;
      while (i < len && !/[\s()<>\[\]{}/%]/.test(src[i])) i += 1;
      return { kind: 'name', value: src.slice(start, i) };
    }

    const start = i;
    while (i < len && !/[\s()<>\[\]{}/%]/.test(src[i])) i += 1;
    const word = src.slice(start, i);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(word)) {
      return { kind: 'number', value: Number(word) };
    }
    return { kind: 'word', value: word };
  };

  while (i < len) {
    const tok = readToken();
    if (!tok) break;
    tokens.push(tok);
  }
  return tokens;
}

const VECTOR_OPERATORS = new Set([
  're',
  'm',
  'l',
  'c',
  'v',
  'y',
  'h',
  'S',
  's',
  'f',
  'F',
  'f*',
  'B',
  'B*',
  'b',
  'b*',
  'n',
  'rg',
  'RG',
  'w',
]);

export function inspectPdfBuffer(buffer: Buffer): PdfInspectionResult {
  const header = buffer.subarray(0, 8).toString('latin1');
  const tail = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('latin1');
  const hasStartXref = tail.includes('startxref');
  const hasEof = tail.includes('%%EOF');

  const latin = buffer.toString('latin1');

  // Step 2: Parse indirect objects & slice streams accurately
  const objects = new Map<number, PdfObject>();
  const objHeaderRe = /(\d+)\s+(\d+)\s+obj\b/g;
  let cursor = 0;

  while (true) {
    objHeaderRe.lastIndex = cursor;
    const match = objHeaderRe.exec(latin);
    if (!match) break;

    const id = Number(match[1]);
    const gen = Number(match[2]);
    const bodyStart = match.index + match[0].length;

    const endobjIdx = latin.indexOf('endobj', bodyStart);
    const streamKeywordMatch = /\bstream(?:\r\n|\n)/.exec(latin.slice(bodyStart, endobjIdx === -1 ? undefined : endobjIdx));

    if (!streamKeywordMatch) {
      const end = endobjIdx === -1 ? latin.length : endobjIdx;
      const body = latin.slice(bodyStart, end);
      objects.set(id, { id, gen, dict: body, body });
      cursor = endobjIdx === -1 ? latin.length : endobjIdx + 6;
      continue;
    }

    const dictPart = latin.slice(bodyStart, bodyStart + streamKeywordMatch.index);
    const streamStart = bodyStart + streamKeywordMatch.index + streamKeywordMatch[0].length;

    let streamEnd = -1;
    const directLenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictPart);
    if (directLenMatch) {
      const len = Number(directLenMatch[1]);
      if (streamStart + len <= buffer.length) {
        streamEnd = streamStart + len;
      }
    }

    if (streamEnd === -1) {
      const indirectLenMatch = /\/Length\s+(\d+)\s+\d+\s+R/.exec(dictPart);
      if (indirectLenMatch) {
        const lenObj = objects.get(Number(indirectLenMatch[1]));
        const resolvedLen = lenObj ? Number(lenObj.body.trim()) : NaN;
        if (Number.isFinite(resolvedLen) && resolvedLen >= 0 && streamStart + resolvedLen <= buffer.length) {
          streamEnd = streamStart + resolvedLen;
        }
      }
    }

    if (streamEnd === -1) {
      const endstreamRe = /\r?\nendstream\b/g;
      endstreamRe.lastIndex = streamStart;
      const em = endstreamRe.exec(latin);
      streamEnd = em ? em.index : latin.indexOf('endstream', streamStart);
      if (streamEnd === -1) streamEnd = buffer.length;
    }

    const rawStream = buffer.subarray(streamStart, streamEnd);
    const postEndobj = latin.indexOf('endobj', streamEnd);
    cursor = postEndobj === -1 ? streamEnd : postEndobj + 6;

    objects.set(id, {
      id,
      gen,
      dict: dictPart,
      body: dictPart,
      rawStream,
    });
  }

  // Second pass: resolve indirect /Length if any stream had forward /Length ref and decompress FlateDecode
  for (const obj of objects.values()) {
    if (!obj.rawStream) continue;
    const isFlate = /\/FlateDecode\b/.test(obj.dict);
    const isBinaryNonText =
      /\/Type\s*\/XRef\b/.test(obj.dict) ||
      /\/Subtype\s*\/Image\b/.test(obj.dict) ||
      /\/Length1\b/.test(obj.dict);
    if (isBinaryNonText) continue;

    if (isFlate) {
      try {
        obj.decompressedStream = inflateSync(obj.rawStream).toString('latin1');
      } catch {
        // Fallback: try raw latin1 if inflation failed
        obj.decompressedStream = obj.rawStream.toString('latin1');
      }
    } else {
      obj.decompressedStream = obj.rawStream.toString('latin1');
    }
  }

  // Step 3: Build ToUnicode CMaps and Font resource mappings
  const fontCmaps = new Map<number, FontCMap>();
  const globalFontMap = new Map<string, number>();
  let fontCount = 0;
  let pageCount = 0;
  let imageObjectCount = 0;

  const extractFontBindings = (dictText: string, target: Map<string, number>) => {
    const bindingRe = /\/([A-Za-z0-9._+-]+)\s+(\d+)\s+\d+\s+R/g;
    let bm: RegExpExecArray | null;
    while ((bm = bindingRe.exec(dictText)) !== null) {
      target.set(bm[1], Number(bm[2]));
    }
  };

  for (const obj of objects.values()) {
    if (/\/Type\s*\/Page(?![a-zA-Z])/.test(obj.dict)) pageCount += 1;
    if (/\/Subtype\s*\/Image\b/.test(obj.dict)) imageObjectCount += 1;
    if (/\/Type\s*\/Font\b/.test(obj.dict)) {
      fontCount += 1;
      const tuMatch = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(obj.dict);
      if (tuMatch) {
        const cmapObj = objects.get(Number(tuMatch[1]));
        const cmapText = cmapObj?.decompressedStream ?? '';
        if (cmapText.includes('beginbfchar') || cmapText.includes('beginbfrange')) {
          fontCmaps.set(obj.id, parseToUnicodeCMap(cmapText));
        }
      }
    }

    const inlineFontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(obj.dict);
    if (inlineFontDict) {
      extractFontBindings(inlineFontDict[1], globalFontMap);
    }
    const indirectFontDict = /\/Font\s+(\d+)\s+\d+\s+R/.exec(obj.dict);
    if (indirectFontDict) {
      const fObj = objects.get(Number(indirectFontDict[1]));
      if (fObj) extractFontBindings(fObj.body, globalFontMap);
    }
  }

  // Step 4: Decode content streams
  let textOperatorCount = 0;
  let vectorOperatorCount = 0;
  const chunks: string[] = [];

  for (const obj of objects.values()) {
    const streamText = obj.decompressedStream;
    if (!streamText) continue;
    // Skip CMap streams
    if (streamText.includes('begincodespacerange') || streamText.includes('beginbfchar')) continue;
    const looksLikeContentStream =
      /\bBT\b/.test(streamText) ||
      /\b(?:Tj|TJ)\b/.test(streamText) ||
      /\b(?:re|m|l|S|f|rg|RG)\b/.test(streamText);
    if (!looksLikeContentStream) continue;

    const tokens = tokenizeContentStream(streamText);
    const operands: StreamToken[] = [];
    let currentFontName = '';

    const getActiveCmap = (): FontCMap | undefined => {
      const fontId = globalFontMap.get(currentFontName);
      return fontId !== undefined ? fontCmaps.get(fontId) : undefined;
    };

    const decodeToken = (tok: StreamToken): string => {
      if (tok.kind === 'hex') return decodeHexOperand(tok.value, getActiveCmap());
      if (tok.kind === 'literal') return unescapePdfLiteral(tok.value);
      return '';
    };

    for (const tok of tokens) {
      if (tok.kind !== 'word') {
        operands.push(tok);
        continue;
      }

      const op = tok.value;
      if (VECTOR_OPERATORS.has(op)) {
        vectorOperatorCount += 1;
      }

      if (op === 'Tf') {
        for (let idx = operands.length - 1; idx >= 0; idx -= 1) {
          const tokItem = operands[idx];
          if (tokItem.kind === 'name') {
            currentFontName = tokItem.value;
            break;
          }
        }
      } else if (op === 'Td' || op === 'TD' || op === 'Tm' || op === 'T*' || op === 'ET') {
        chunks.push('\n');
      } else if (op === 'Tj' || op === "'" || op === '"') {
        textOperatorCount += 1;
        const last = operands[operands.length - 1];
        if (last) chunks.push(decodeToken(last));
      } else if (op === 'TJ') {
        textOperatorCount += 1;
        const arr = operands[operands.length - 1];
        if (arr && arr.kind === 'array') {
          for (const item of arr.items) {
            if (item.kind === 'number') {
              if (item.value < -150) chunks.push(' ');
            } else {
              chunks.push(decodeToken(item));
            }
          }
        }
      }

      operands.length = 0;
    }
  }

  const rawText = chunks.join('');
  const normalizedText = rawText.replace(/\s+/g, ' ').trim();

  return {
    header,
    hasStartXref,
    hasEof,
    pageCount,
    fontCount,
    toUnicodeFontCount: fontCmaps.size,
    imageObjectCount,
    textOperatorCount,
    vectorOperatorCount,
    rawText,
    normalizedText,
  };
}

// ---------------------------------------------------------------------------
// Workspace File & HTTP Dashboard Inspection Helpers
// ---------------------------------------------------------------------------

export interface DashboardSourceSnapshot {
  indexHtml: string;
  files: Array<{ relPath: string; content: string }>;
  combinedSource: string;
  cssSource: string;
}

function collectFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(full));
    } else if (/\.(ts|tsx|css)$/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results.sort();
}

export function readDashboardSources(): DashboardSourceSnapshot {
  const indexHtmlPath = path.join(REPO_ROOT, 'dashboard', 'index.html');
  const indexHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, 'utf8') : '';
  const srcDir = path.join(REPO_ROOT, 'dashboard', 'src');
  const filePaths = collectFilesRecursive(srcDir);
  const files = filePaths.map((full) => ({
    relPath: path.relative(REPO_ROOT, full).replace(/\\/g, '/'),
    content: fs.readFileSync(full, 'utf8'),
  }));
  const combinedSource = files.map((f) => `// ${f.relPath}\n${f.content}`).join('\n');
  const cssSource = files
    .filter((f) => f.relPath.endsWith('.css'))
    .map((f) => f.content)
    .join('\n');
  return { indexHtml, files, combinedSource, cssSource };
}

export interface ServedDashboardBundle {
  indexStatus: number;
  indexHtml: string;
  jsUrl: string;
  jsStatus: number;
  jsText: string;
  cssUrl: string;
  cssStatus: number;
  cssText: string;
}

export async function fetchServedDashboardBundle(baseUrl: string): Promise<ServedDashboardBundle> {
  const indexRes = await fetch(`${baseUrl}/`);
  const indexHtml = await indexRes.text();
  const jsMatch = /<script[^>]+src="([^"]+\.js)"/i.exec(indexHtml);
  const cssMatch = /<link[^>]+href="([^"]+\.css)"/i.exec(indexHtml);

  const jsUrl = jsMatch ? jsMatch[1] : '';
  const cssUrl = cssMatch ? cssMatch[1] : '';

  let jsStatus = 0;
  let jsText = '';
  if (jsUrl) {
    const jsRes = await fetch(`${baseUrl}${jsUrl.startsWith('/') ? jsUrl : `/${jsUrl}`}`);
    jsStatus = jsRes.status;
    jsText = await jsRes.text();
  }

  let cssStatus = 0;
  let cssText = '';
  if (cssUrl) {
    const cssRes = await fetch(`${baseUrl}${cssUrl.startsWith('/') ? cssUrl : `/${cssUrl}`}`);
    cssStatus = cssRes.status;
    cssText = await cssRes.text();
  }

  return {
    indexStatus: indexRes.status,
    indexHtml,
    jsUrl,
    jsStatus,
    jsText,
    cssUrl,
    cssStatus,
    cssText,
  };
}

export function readIntegrationDoc(): { exists: boolean; filePath: string; content: string } {
  const filePath = path.join(REPO_ROOT, 'docs', 'cosmiqos-website-integration.md');
  const exists = fs.existsSync(filePath);
  return {
    exists,
    filePath,
    content: exists ? fs.readFileSync(filePath, 'utf8') : '',
  };
}

export function createTempDir(prefix = 'cosmiq-e2e-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeTempDir(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

export function formatInrAmount(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** Matches an INR figure in extracted PDF text regardless of spacing or trailing .00 */
export function buildInrAmountRegex(paise: number): RegExp {
  const rupees = paise / 100;
  const formattedInt = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.floor(rupees));
  const formattedDec = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
  const plainInt = String(Math.floor(rupees));
  const escaped = [formattedDec, formattedInt, plainInt].map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  // Derived only from a numeric amount, with every regex metacharacter escaped above.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  return new RegExp(`(?:₹|INR)\\s*(?:${escaped.join('|')})(?:\\.00)?`, 'i');
}
