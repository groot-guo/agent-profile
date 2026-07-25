import { Anthropic, Claude, ClaudeCode, DeepSeek, Kimi, OpenAI } from '@lobehub/icons';
import type { ReactNode } from 'react';

export function getAgentIcon(agent: string, size?: number): ReactNode {
  const s = size ?? 16;
  switch (agent) {
    case 'claude-code':
      return <ClaudeCode size={s} />;
    case 'codex':
      return <OpenAI size={s} />;
    case 'kimi-code':
      return <Kimi size={s} />;
    case 'mimo-code':
      return <OpenAI size={s} />; // MiMo 基于 OpenCode
    case 'opencode':
      return <OpenAI size={s} />;
    case 'zed':
      return <OpenAI size={s} />; // Zed 暂无专属图标
    default:
      return <Anthropic size={s} />;
  }
}

export function getModelIcon(model: string, size?: number): ReactNode {
  const s = size ?? 16;
  const m = model.toLowerCase();
  if (m.includes('deepseek')) return <DeepSeek size={s} />;
  if (m.includes('kimi') || m.includes('moonshot')) return <Kimi size={s} />;
  if (m.includes('openai') || m.includes('gpt')) return <OpenAI size={s} />;
  if (m.includes('claude') || m.includes('anthropic')) return <Claude size={s} />;
  return <Anthropic size={s} />;
}

// 直接导出组件供外部使用
export { Anthropic, Claude, ClaudeCode, DeepSeek, Kimi, OpenAI };
