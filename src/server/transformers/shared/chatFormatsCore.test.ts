import { describe, expect, it } from 'vitest';

import {
  createClaudeDownstreamContext,
  createStreamTransformContext,
  normalizeUpstreamStreamEvent,
  pullSseEventsWithDone,
  serializeNormalizedStreamEvent,
} from './chatFormatsCore.js';

describe('chatFormatsCore inline think parsing', () => {
  it('tracks split think tags across stream chunks', () => {
    const context = createStreamTransformContext('gpt-test');

    expect(normalizeUpstreamStreamEvent({
      id: 'chatcmpl-split-think',
      model: 'gpt-test',
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      }],
    }, context, 'gpt-test')).toMatchObject({
      role: 'assistant',
    });

    const openingFragment = normalizeUpstreamStreamEvent({
      id: 'chatcmpl-split-think',
      model: 'gpt-test',
      choices: [{
        index: 0,
        delta: { content: '<thin' },
        finish_reason: null,
      }],
    }, context, 'gpt-test');
    expect(openingFragment.contentDelta).toBeUndefined();
    expect(openingFragment.reasoningDelta).toBeUndefined();

    expect(normalizeUpstreamStreamEvent({
      id: 'chatcmpl-split-think',
      model: 'gpt-test',
      choices: [{
        index: 0,
        delta: { content: 'k>plan ' },
        finish_reason: null,
      }],
    }, context, 'gpt-test')).toMatchObject({
      reasoningDelta: 'plan ',
    });

    expect(normalizeUpstreamStreamEvent({
      id: 'chatcmpl-split-think',
      model: 'gpt-test',
      choices: [{
        index: 0,
        delta: { content: 'quietly</th' },
        finish_reason: null,
      }],
    }, context, 'gpt-test')).toMatchObject({
      reasoningDelta: 'quietly',
    });

    expect(normalizeUpstreamStreamEvent({
      id: 'chatcmpl-split-think',
      model: 'gpt-test',
      choices: [{
        index: 0,
        delta: { content: 'ink>visible answer' },
        finish_reason: null,
      }],
    }, context, 'gpt-test')).toMatchObject({
      contentDelta: 'visible answer',
    });
  });

  it('keeps reasoning-only openai deltas out of content', () => {
    const context = createStreamTransformContext('minimax-m2.5');
    const claudeContext = createClaudeDownstreamContext();

    const event = normalizeUpstreamStreamEvent({
      id: 'chatcmpl-test',
      model: 'MiniMax-M2.5',
      created: 1773135871,
      choices: [{
        index: 0,
        delta: {
          reasoning_content: '用户要求直接回答1+1等于几，不要解释。',
        },
        finish_reason: null,
      }],
    }, context, 'minimax-m2.5');

    expect(event.contentDelta).toBeUndefined();
    expect(event.reasoningDelta).toBe('用户要求直接回答1+1等于几，不要解释。');

    const chunks = serializeNormalizedStreamEvent('openai', event, context, claudeContext);
    const parsed = pullSseEventsWithDone(chunks.join('')).events.map((item) => JSON.parse(item.data));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      choices: [{
        delta: {
          role: 'assistant',
          reasoning_content: '用户要求直接回答1+1等于几，不要解释。',
        },
      }],
    });
    expect((parsed[0] as any).choices[0].delta.content).toBeUndefined();
  });
});
