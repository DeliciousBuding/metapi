import { appendFileSync } from 'fs';

export type DownstreamClientKind =
  | 'generic'
  | 'codex'
  | 'claude_code'
  | 'gemini_cli'
  | 'cursor'
  | 'opencode'
  | 'openclaw';

export type DownstreamClientContext = {
  clientKind: DownstreamClientKind;
  sessionId?: string;
  traceHint?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function headerValueToString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (trimmed) return trimmed;
    }
  }

  return null;
}

function getHeaderValue(headers: Record<string, unknown> | undefined, targetKey: string): string | null {
  if (!headers) return null;
  const normalizedTarget = targetKey.trim().toLowerCase();

  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (rawKey.trim().toLowerCase() !== normalizedTarget) continue;
    return headerValueToString(rawValue);
  }

  return null;
}

const FINGERPRINT_DEBUG = process.env.CLIENT_FINGERPRINT_DEBUG === '1';
const FINGERPRINT_DEBUG_FILE = (process.env.CLIENT_FINGERPRINT_DEBUG_FILE || '').trim();

function pickDebugHeaders(headers?: Record<string, unknown>): Record<string, string> {
  if (!headers) return {};
  const allowExact = new Set([
    'user-agent',
    'originator',
    'openai-beta',
    'anthropic-beta',
    'anthropic-version',
    'anthropic-dangerous-direct-browser-access',
    'content-type',
    'accept',
    'accept-encoding',
    'accept-language',
    'x-request-id',
    'x-session-id',
    'session_id',
    'session-id',
    'x-gemini-api-privileged-user-id',
    'x-opencode-directory',
    'x-opencode-workspace',
    'x-cursor-client-version',
    'http-referer',
    'x-title',
  ]);
  const allowPrefixes = ['x-stainless-', 'anthropic-', 'x-client-', 'x-app-', 'x-openai-'];
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = rawKey.trim().toLowerCase();
    if (!key) continue;
    if (key === 'authorization' || key === 'x-api-key' || key === 'x-goog-api-key' || key === 'cookie') continue;
    if (allowExact.has(key) || allowPrefixes.some((prefix) => key.startsWith(prefix))) {
      const value = headerValueToString(rawValue);
      if (value) result[key] = value;
    }
  }
  return result;
}

function buildBodyFingerprint(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const payload = body as Record<string, unknown>;
  const metadata = payload.metadata && typeof payload.metadata === 'object'
    ? payload.metadata as Record<string, unknown>
    : null;
  const rawUserId = typeof metadata?.user_id === 'string' ? metadata.user_id.trim() : '';
  const userIdKind = rawUserId
    ? (claudeCodeUserIdPattern.test(rawUserId) ? 'claude_code' : 'other')
    : 'missing';
  return {
    keys: Object.keys(payload).slice(0, 16),
    hasMessages: Array.isArray(payload.messages),
    hasInput: Object.prototype.hasOwnProperty.call(payload, 'input'),
    hasMetadata: !!metadata,
    metadataUserIdKind: userIdKind,
  };
}

function logDownstreamFingerprint(input: { downstreamPath: string; headers?: Record<string, unknown>; body?: unknown }) {
  if (!FINGERPRINT_DEBUG) return;
  const authHeader = getHeaderValue(input.headers, 'authorization');
  const payload = {
    path: input.downstreamPath,
    headers: pickDebugHeaders(input.headers),
    body: buildBodyFingerprint(input.body),
    auth: {
      authorization: !!authHeader,
      authScheme: authHeader ? (authHeader.split(/\s+/)[0]?.trim().toLowerCase() || null) : null,
      xApiKey: !!getHeaderValue(input.headers, 'x-api-key'),
      xGoogApiKey: !!getHeaderValue(input.headers, 'x-goog-api-key'),
    },
  };
  const line = `[fingerprint] ${JSON.stringify(payload)}`;
  if (FINGERPRINT_DEBUG_FILE) {
    appendFileSync(FINGERPRINT_DEBUG_FILE, `${line}\n`);
    return;
  }
  console.log(line);
}

export function isCodexResponsesSurface(headers?: Record<string, unknown>): boolean {
  if (!headers) return false;

  let sawOpenAiBeta = false;
  let sawStainless = false;

  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = rawKey.trim().toLowerCase();
    const value = headerValueToString(rawValue);
    if (!key || !value) continue;

    if (key === 'originator' && value.toLowerCase() === 'codex_cli_rs') {
      return true;
    }
    if (key === 'originator' && value.toLowerCase() === 'codex_exec') {
      return true;
    }
    if (key === 'originator' && value.toLowerCase() === 'codex_cli') {
      return true;
    }
    if (key === 'user-agent' && value.toLowerCase().includes('codex_exec')) {
      return true;
    }
    if (key === 'openai-beta') {
      sawOpenAiBeta = true;
    }
    if (key.startsWith('x-stainless-')) {
      sawStainless = true;
    }
  }

  return sawOpenAiBeta || sawStainless;
}

const claudeCodeUserIdPattern = /^user_[0-9a-f]{64}_account__session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const claudeCodeBetaPattern = /(?:^|,)\s*claude-code-\d{8}(?:\s*,|$)/i;
const codexOriginators = new Set(['codex_cli_rs', 'codex_exec', 'codex_cli']);
const codexUserAgentTokens = ['codex_exec', 'codex-cli', 'codex_cli'];
const geminiCliUserAgentPattern = /^geminicli\//i;
const cursorUserAgentPattern = /(?:^|[\s(])cursor(?:\/|[-_ ]agent)/i;
const opencodeUserAgentPattern = /(?:^|[\s(])opencode(?:\/|[-_ ])/i;
const openclawUserAgentPattern = /(?:^|[\s(])openclaw(?:\/|[-_ ])/i;

export function extractClaudeCodeSessionId(userId: string): string | null {
  const trimmed = userId.trim();
  if (!claudeCodeUserIdPattern.test(trimmed)) return null;

  const sessionPrefix = '__session_';
  const sessionIndex = trimmed.lastIndexOf(sessionPrefix);
  if (sessionIndex === -1) return null;

  const sessionId = trimmed.slice(sessionIndex + sessionPrefix.length).trim();
  return sessionId || null;
}

function extractCodexSessionId(headers?: Record<string, unknown>): string | null {
  return getHeaderValue(headers, 'session_id')
    || getHeaderValue(headers, 'session-id')
    || getHeaderValue(headers, 'x-session-id')
    || getHeaderValue(headers, 'x-codex-session');
}

function hasClaudeCodeHeaderSignal(headers?: Record<string, unknown>): boolean {
  if (!headers) return false;
  const beta = getHeaderValue(headers, 'anthropic-beta');
  if (beta && claudeCodeBetaPattern.test(beta)) return true;
  const ua = getHeaderValue(headers, 'user-agent');
  if (ua && ua.toLowerCase().includes('claude-cli/')) return true;
  const dangerous = getHeaderValue(headers, 'anthropic-dangerous-direct-browser-access');
  if (dangerous && dangerous.toLowerCase() === 'true') return true;
  return false;
}

function hasCodexHeaderSignal(headers?: Record<string, unknown>): boolean {
  if (!headers) return false;
  const originator = getHeaderValue(headers, 'originator');
  if (originator && codexOriginators.has(originator.toLowerCase())) return true;
  const ua = getHeaderValue(headers, 'user-agent');
  if (ua && codexUserAgentTokens.some((token) => ua.toLowerCase().includes(token))) return true;
  return false;
}

function hasGeminiCliHeaderSignal(headers?: Record<string, unknown>): boolean {
  if (!headers) return false;
  const ua = getHeaderValue(headers, 'user-agent');
  if (ua && geminiCliUserAgentPattern.test(ua)) return true;
  if (getHeaderValue(headers, 'x-gemini-api-privileged-user-id')) return true;
  return false;
}

function hasCursorHeaderSignal(headers?: Record<string, unknown>): boolean {
  if (!headers) return false;
  if (getHeaderValue(headers, 'x-cursor-client-version')) return true;
  const ua = getHeaderValue(headers, 'user-agent');
  if (ua && cursorUserAgentPattern.test(ua)) return true;
  return false;
}

function hasOpencodeHeaderSignal(headers?: Record<string, unknown>): boolean {
  if (!headers) return false;
  if (getHeaderValue(headers, 'x-opencode-directory')) return true;
  if (getHeaderValue(headers, 'x-opencode-workspace')) return true;
  const ua = getHeaderValue(headers, 'user-agent');
  if (ua && opencodeUserAgentPattern.test(ua)) return true;
  return false;
}

function hasOpenclawHeaderSignal(headers?: Record<string, unknown>): boolean {
  if (!headers) return false;
  const ua = getHeaderValue(headers, 'user-agent');
  if (ua && openclawUserAgentPattern.test(ua)) return true;
  const referer = getHeaderValue(headers, 'http-referer');
  const title = getHeaderValue(headers, 'x-title');
  if (referer && referer.toLowerCase().includes('openclaw.ai') && title?.toLowerCase() === 'openclaw') {
    return true;
  }
  return false;
}

export function detectDownstreamClientContext(input: {
  downstreamPath: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}): DownstreamClientContext {
  logDownstreamFingerprint(input);
  if (hasClaudeCodeHeaderSignal(input.headers)) {
    let sessionId: string | null = null;
    if (isRecord(input.body) && isRecord(input.body.metadata)) {
      const userId = typeof input.body.metadata.user_id === 'string'
        ? input.body.metadata.user_id.trim()
        : '';
      sessionId = userId ? extractClaudeCodeSessionId(userId) : null;
    }
    if (sessionId) {
      return {
        clientKind: 'claude_code',
        sessionId,
        traceHint: sessionId,
      };
    }
    return { clientKind: 'claude_code' };
  }

  if (hasCodexHeaderSignal(input.headers)) {
    const sessionId = extractCodexSessionId(input.headers);
    if (sessionId) {
      return {
        clientKind: 'codex',
        sessionId,
        traceHint: sessionId,
      };
    }
    return { clientKind: 'codex' };
  }

  if (hasGeminiCliHeaderSignal(input.headers)) {
    return { clientKind: 'gemini_cli' };
  }

  if (hasCursorHeaderSignal(input.headers)) {
    return { clientKind: 'cursor' };
  }

  if (hasOpencodeHeaderSignal(input.headers)) {
    return { clientKind: 'opencode' };
  }

  if (hasOpenclawHeaderSignal(input.headers)) {
    return { clientKind: 'openclaw' };
  }

  const normalizedPath = input.downstreamPath.trim().toLowerCase();

  if (normalizedPath === '/v1/messages' || normalizedPath === '/anthropic/v1/messages') {
    if (isRecord(input.body) && isRecord(input.body.metadata)) {
      const userId = typeof input.body.metadata.user_id === 'string'
        ? input.body.metadata.user_id.trim()
        : '';
      const sessionId = userId ? extractClaudeCodeSessionId(userId) : null;
      if (sessionId) {
        return {
          clientKind: 'claude_code',
          sessionId,
          traceHint: sessionId,
        };
      }
    }

    return { clientKind: 'generic' };
  }

  if (normalizedPath.startsWith('/v1/responses') && isCodexResponsesSurface(input.headers)) {
    const sessionId = getHeaderValue(input.headers, 'session_id') || getHeaderValue(input.headers, 'session-id');
    if (sessionId) {
      return {
        clientKind: 'codex',
        sessionId,
        traceHint: sessionId,
      };
    }

    return { clientKind: 'codex' };
  }

  return { clientKind: 'generic' };
}
