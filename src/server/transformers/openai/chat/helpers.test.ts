import { describe, expect, it } from 'vitest';

import { extractChatChoiceEvents, extractChatChoices } from './helpers.js';

describe('openai chat helpers', () => {
  it('does not surface reasoning-only deltas as content', () => {
    const events = extractChatChoiceEvents({
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          reasoning_content: '用户要求直接回答1+1等于几，不要解释。',
        },
        finish_reason: null,
      }],
    });

    expect(events).toEqual([{
      index: 0,
      role: 'assistant',
      reasoningDelta: '用户要求直接回答1+1等于几，不要解释。',
      finishReason: null,
    }]);
  });

  it('does not surface reasoning-only final messages as content', () => {
    const choices = extractChatChoices({
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          reasoning_content: '先在心里规划一句简短中文回复。',
        },
        finish_reason: 'stop',
      }],
    });

    expect(choices).toEqual([{
      index: 0,
      role: 'assistant',
      content: '',
      reasoningContent: '先在心里规划一句简短中文回复。',
      toolCalls: [],
      finishReason: 'stop',
    }]);
  });
});