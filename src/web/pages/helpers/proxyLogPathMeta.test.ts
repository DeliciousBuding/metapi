import { describe, expect, it } from 'vitest';
import { parseProxyLogPathMeta } from './proxyLogPathMeta.js';

describe('parseProxyLogPathMeta', () => {
  it('parses downstream and upstream paths from prefixed message', () => {
    const parsed = parseProxyLogPathMeta('[client:codex] [session:req-123] [downstream:/v1/responses] [upstream:/v1/chat/completions] {"error":"x"}');
    expect(parsed.clientKind).toBe('codex');
    expect(parsed.sessionId).toBe('req-123');
    expect(parsed.downstreamPath).toBe('/v1/responses');
    expect(parsed.upstreamPath).toBe('/v1/chat/completions');
    expect(parsed.errorMessage).toBe('{"error":"x"}');
  });

  it('supports historical upstream-only logs', () => {
    const parsed = parseProxyLogPathMeta('[upstream:/v1/messages] messages is required');
    expect(parsed.clientKind).toBe(null);
    expect(parsed.sessionId).toBe(null);
    expect(parsed.downstreamPath).toBe(null);
    expect(parsed.upstreamPath).toBe('/v1/messages');
    expect(parsed.errorMessage).toBe('messages is required');
  });

  it('keeps plain message when no metadata exists', () => {
    const parsed = parseProxyLogPathMeta('network timeout');
    expect(parsed.clientKind).toBe(null);
    expect(parsed.sessionId).toBe(null);
    expect(parsed.downstreamPath).toBe(null);
    expect(parsed.upstreamPath).toBe(null);
    expect(parsed.errorMessage).toBe('network timeout');
  });
});
