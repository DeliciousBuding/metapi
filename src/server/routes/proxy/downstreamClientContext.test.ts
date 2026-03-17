import { describe, expect, it } from 'vitest';
import {
  detectDownstreamClientContext,
  extractClaudeCodeSessionId,
  isCodexResponsesSurface,
} from './downstreamClientContext.js';

describe('extractClaudeCodeSessionId', () => {
  it('extracts session uuid from axonhub-compatible Claude Code user ids', () => {
    expect(extractClaudeCodeSessionId(
      'user_20836b5653ed68aa981604f502c0a491397f6053826a93c953423632578d38ad_account__session_f25958b8-e75c-455d-8b40-f006d87cc2a4',
    )).toBe('f25958b8-e75c-455d-8b40-f006d87cc2a4');
  });

  it('returns null for non-Claude-Code user ids', () => {
    expect(extractClaudeCodeSessionId('user_123')).toBe(null);
    expect(extractClaudeCodeSessionId('session_f25958b8-e75c-455d-8b40-f006d87cc2a4')).toBe(null);
  });
});

describe('isCodexResponsesSurface', () => {
  it('detects Codex responses surface from originator and stainless headers', () => {
    expect(isCodexResponsesSurface({
      originator: 'codex_cli_rs',
    })).toBe(true);

    expect(isCodexResponsesSurface({
      'x-stainless-lang': 'typescript',
    })).toBe(true);
  });

  it('returns false for generic responses clients', () => {
    expect(isCodexResponsesSurface({
      'content-type': 'application/json',
    })).toBe(false);
  });
});

describe('detectDownstreamClientContext', () => {
  it('recognizes Codex requests and attaches Session_id as session and trace hint', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        originator: 'codex_cli_rs',
        Session_id: 'codex-session-123',
      },
    })).toEqual({
      clientKind: 'codex',
      sessionId: 'codex-session-123',
      traceHint: 'codex-session-123',
    });
  });

  it('keeps Codex requests without Session_id as client-only context', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses/compact',
      headers: {
        'x-stainless-lang': 'typescript',
      },
    })).toEqual({
      clientKind: 'codex',
    });
  });

  it('recognizes Codex by user-agent token even when originator header is absent', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'user-agent': 'codex_exec/0.19.0',
      },
    })).toEqual({
      clientKind: 'codex',
    });
  });

  it('recognizes Codex by originator variants used by official clients', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        originator: 'codex_vscode',
      },
    })).toEqual({
      clientKind: 'codex',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        originator: 'Codex MCP',
      },
    })).toEqual({
      clientKind: 'codex',
    });
  });

  it('recognizes Claude Code requests from metadata.user_id without mutating the body', () => {
    const body = {
      model: 'claude-opus-4-6',
      metadata: {
        user_id: 'user_20836b5653ed68aa981604f502c0a491397f6053826a93c953423632578d38ad_account__session_f25958b8-e75c-455d-8b40-f006d87cc2a4',
      },
    };

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body,
    })).toEqual({
      clientKind: 'claude_code',
      sessionId: 'f25958b8-e75c-455d-8b40-f006d87cc2a4',
      traceHint: 'f25958b8-e75c-455d-8b40-f006d87cc2a4',
    });
    expect(body).toEqual({
      model: 'claude-opus-4-6',
      metadata: {
        user_id: 'user_20836b5653ed68aa981604f502c0a491397f6053826a93c953423632578d38ad_account__session_f25958b8-e75c-455d-8b40-f006d87cc2a4',
      },
    });
  });

  it('recognizes Claude Code by anthropic-beta header without metadata', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      headers: {
        'anthropic-beta': 'claude-code-20260218',
      },
      body: {},
    })).toEqual({
      clientKind: 'claude_code',
    });
  });

  it('recognizes gemini/cursor/opencode/openclaw header signatures', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-gemini-api-privileged-user-id': 'u_1',
      },
    })).toEqual({
      clientKind: 'gemini_cli',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'user-agent': 'GeminiCLI-vscode/0.1.7/gemini-2.0-flash (darwin; arm64; ide)',
      },
    })).toEqual({
      clientKind: 'gemini_cli',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-cursor-client-version': '1.0.0',
      },
    })).toEqual({
      clientKind: 'cursor',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-opencode-session': 'sess_123',
      },
    })).toEqual({
      clientKind: 'opencode',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'http-referer': 'https://opencode.ai/playground',
        'x-title': 'opencode',
      },
    })).toEqual({
      clientKind: 'opencode',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-opencode-workspace': '/tmp/demo',
      },
    })).toEqual({
      clientKind: 'opencode',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'http-referer': 'https://openclaw.ai/playground',
        'x-title': 'OpenClaw',
      },
    })).toEqual({
      clientKind: 'openclaw',
    });
  });

  it('falls back to generic when Claude metadata.user_id is missing or invalid', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        metadata: {
          user_id: 'user_123',
        },
      },
    })).toEqual({
      clientKind: 'generic',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/messages',
      body: {
        metadata: {
          session_id: 'abc123',
        },
      },
    })).toEqual({
      clientKind: 'generic',
    });
  });
});
