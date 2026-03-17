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
  it('recognizes Codex from originator header without relying on path', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        originator: 'codex_exec',
        'User-Agent': 'codex_exec/0.114.0 (Windows)',
        session_id: 'codex-session-xyz',
      },
    })).toEqual({
      clientKind: 'codex',
      sessionId: 'codex-session-xyz',
      traceHint: 'codex-session-xyz',
    });
  });

  it('recognizes Claude Code from anthropic-beta header without relying on path', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'anthropic-beta': 'claude-code-20250219,adaptive-thinking-2026-01-28',
        'User-Agent': 'claude-cli/2.1.69 (external, sdk-cli)',
      },
    })).toEqual({
      clientKind: 'claude_code',
    });
  });

  it('recognizes Gemini CLI from user-agent and privileged id headers', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'User-Agent': 'GeminiCLI/0.33.1/gemini-2.5-pro (linux; x64)',
      },
    })).toEqual({
      clientKind: 'gemini_cli',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-gemini-api-privileged-user-id': 'b96bb53b-5606-4e6a-a182-f047f68f8f94',
      },
    })).toEqual({
      clientKind: 'gemini_cli',
    });
  });

  it('recognizes Cline from originator and user-agent headers', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/responses',
      headers: {
        originator: 'cline',
        'User-Agent': 'cline/1.2.3 (linux)',
        session_id: 'cline-session-123',
      },
    })).toEqual({
      clientKind: 'cline',
      sessionId: 'cline-session-123',
      traceHint: 'cline-session-123',
    });
  });

  it('recognizes KiloCode from user-agent and x-kilocode headers', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'User-Agent': 'opencode-kilo-provider',
      },
    })).toEqual({
      clientKind: 'kilocode',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-kilocode-editorname': 'Kilo CLI',
      },
    })).toEqual({
      clientKind: 'kilocode',
    });
  });

  it('recognizes Copilot headers', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'Copilot-Integration-Id': 'vscode-chat',
        'User-Agent': 'GitHubCopilotChat/0.26.7',
        'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      },
    })).toEqual({
      clientKind: 'copilot_cli',
    });
  });

  it('recognizes Cherry Studio from user-agent', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'User-Agent': 'CherryAI',
      },
    })).toEqual({
      clientKind: 'cherrystudio',
    });
  });

  it('recognizes Cherry Studio from condensed user-agent', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'User-Agent': 'CherryStudio/1.1.0',
      },
    })).toEqual({
      clientKind: 'cherrystudio',
    });
  });

  it('recognizes Open WebUI from forwarded user headers', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'X-OpenWebUI-User-Id': 'user-123',
        'X-OpenWebUI-Chat-Id': 'chat-456',
      },
    })).toEqual({
      clientKind: 'openwebui',
    });
  });

  it('recognizes Cursor from client version or user-agent', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-cursor-client-version': '0.50.1',
      },
    })).toEqual({
      clientKind: 'cursor',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'user-agent': 'Cursor/0.50.1 (Electron)',
      },
    })).toEqual({
      clientKind: 'cursor',
    });
  });

  it('recognizes Opencode from x-opencode headers', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'x-opencode-directory': '%2Fhome%2Fding%2Fproject',
      },
    })).toEqual({
      clientKind: 'opencode',
    });
  });

  it('recognizes OpenClaw from openrouter app headers and user-agent', () => {
    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'HTTP-Referer': 'https://openclaw.ai',
        'X-Title': 'OpenClaw',
      },
    })).toEqual({
      clientKind: 'openclaw',
    });

    expect(detectDownstreamClientContext({
      downstreamPath: '/v1/chat/completions',
      headers: {
        'user-agent': 'OpenClaw/2026.3.13 (linux)',
      },
    })).toEqual({
      clientKind: 'openclaw',
    });
  });

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
