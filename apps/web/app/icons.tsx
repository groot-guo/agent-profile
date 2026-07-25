import {
  Anthropic, Claude, ClaudeCode, Codex, Cursor, DeepSeek,
  Gemini, GeminiCLI, GithubCopilot, Kimi, OpenAI, OpenCode,
  Windsurf, XiaomiMiMo, Zencoder,
} from '@lobehub/icons';
import type { ReactNode } from 'react';

export function getAgentIcon(agent: string, size?: number): ReactNode {
  const s = size ?? 16;
  switch (agent) {
    case 'claude-code':   return <ClaudeCode size={s} />;
    case 'codex':         return <Codex size={s} />;
    case 'kimi-code':     return <Kimi size={s} />;
    case 'mimo-code':     return <XiaomiMiMo size={s} />;
    case 'opencode':      return <OpenCode size={s} />;
    case 'copilot':       return <GithubCopilot size={s} />;
    case 'cursor':        return <Cursor size={s} />;
    case 'windsurf':      return <Windsurf size={s} />;
    case 'gemini-cli':    return <GeminiCLI size={s} />;
    case 'zcode':         return <Zencoder size={s} />;
    case 'zed':           return <Zencoder size={s} />;
    default:              return <Anthropic size={s} />;
  }
}

export function getModelIcon(model: string, size?: number): ReactNode {
  const s = size ?? 16;
  const m = model.toLowerCase();
  if (m.includes('deepseek')) return <DeepSeek size={s} />;
  if (m.includes('kimi') || m.includes('moonshot')) return <Kimi size={s} />;
  if (m.includes('mimo')) return <XiaomiMiMo size={s} />;
  if (m.includes('openai') || m.includes('gpt')) return <OpenAI size={s} />;
  if (m.includes('opencode')) return <OpenCode size={s} />;
  if (m.includes('claude') || m.includes('anthropic')) return <Claude size={s} />;
  if (m.includes('gemini')) return <Gemini size={s} />;
  return <Anthropic size={s} />;
}

export {
  Anthropic, Claude, ClaudeCode, Codex, Cursor, DeepSeek,
  Gemini, GithubCopilot, Kimi, OpenAI, OpenCode,
  Windsurf, XiaomiMiMo, Zencoder,
};
