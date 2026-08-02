import { describe, expect, it } from 'vitest';
import { identifyModel } from '../model-identity';

describe('identifyModel', () => {
  it('recognizes explicit concrete model IDs and combines only explicit aliases', () => {
    expect(identifyModel('gpt-5.6-sol')).toMatchObject({
      key: 'model:gpt-5.6-sol',
      kind: 'model',
    });
    expect(identifyModel('gpt-4o')).toMatchObject({ key: 'model:gpt-4o', kind: 'model' });
    expect(identifyModel('claude-sonnet-5')).toMatchObject({
      key: 'model:claude-sonnet-5',
      kind: 'model',
    });
    expect(identifyModel('gemini-2.5-pro')).toMatchObject({
      key: 'model:gemini-2.5-pro',
      kind: 'model',
    });
    expect(identifyModel('DeepSeek-V4-Flash')).toMatchObject({ key: 'model:deepseek-v4-flash' });
    expect(identifyModel('deepseek-ai/DeepSeek-V4-Pro')).toMatchObject({
      key: 'model:deepseek-v4-pro',
    });
    expect(identifyModel('glm-5-2')).toMatchObject({ key: 'model:glm-5.2' });
  });

  it('keeps known runtime modes out of concrete model identity', () => {
    expect(identifyModel('codex-auto-review')).toMatchObject({
      key: 'runtime:codex-auto-review',
      kind: 'runtime_mode',
    });
  });

  it('keeps provider-only and versioned unknown values distinct', () => {
    expect(identifyModel('litellm')).toMatchObject({ kind: 'provider_only' });
    expect(identifyModel('openai')).toMatchObject({ kind: 'provider_only' });
    expect(identifyModel('glm-5-2-origin')).toMatchObject({ kind: 'unknown' });
    expect(identifyModel()).toMatchObject({ key: 'unknown', kind: 'unknown' });
  });
});
