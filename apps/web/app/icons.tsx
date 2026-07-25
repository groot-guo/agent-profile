// 轻量 inline SVG 图标组件，替代 emoji

type IconProps = { size?: number };

// Anthropic Claude
export function ClaudeIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="6" fill="#D97706" />
      <path d="M12 4C9.5 4 7.5 6 7.5 8.5C7.5 9.5 7.8 10.4 8.3 11.1L12 20L15.7 11.1C16.2 10.4 16.5 9.5 16.5 8.5C16.5 6 14.5 4 12 4Z" fill="#FEF3C7" />
    </svg>
  );
}

// OpenAI / Codex
export function CodexIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="6" fill="#10A37F" />
      <path d="M6 12C6 8.7 8.7 6 12 6C13.8 6 15.4 6.8 16.5 8L18 6.5C16.4 4.8 14.3 3.8 12 3.8C7.5 3.8 3.8 7.5 3.8 12C3.8 14.3 4.8 16.4 6.5 18L8 16.5C6.8 15.4 6 13.8 6 12Z" fill="white" fillOpacity="0.9" />
      <path d="M18 12C18 15.3 15.3 18 12 18C10.2 18 8.6 17.2 7.5 16L6 17.5C7.6 19.2 9.7 20.2 12 20.2C16.5 20.2 20.2 16.5 20.2 12C20.2 9.7 19.2 7.6 17.5 6L16 7.5C17.2 8.6 18 10.2 18 12Z" fill="white" fillOpacity="0.9" />
      <circle cx="12" cy="12" r="3" fill="white" />
    </svg>
  );
}

// Zed editor - stylized Z
export function ZedIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="5" fill="#1A1A1A" />
      <path d="M7 6H17L9 18H17" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// DeepSeek
export function DeepSeekIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="5" fill="#4D6BFE" />
      <text x="12" y="16" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold" fontFamily="system-ui">D</text>
    </svg>
  );
}

// Kimi / Moonshot
export function KimiIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="5" fill="#8B5CF6" />
      <text x="12" y="16" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold" fontFamily="system-ui">K</text>
    </svg>
  );
}

// OpenAI model icon
export function OpenAIIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="5" fill="#10A37F" />
      <text x="12" y="16" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="system-ui">OA</text>
    </svg>
  );
}

// 通用 agent 图标
export function UnknownIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="5" fill="#6E7681" />
      <text x="12" y="16" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" fontFamily="system-ui">?</text>
    </svg>
  );
}

// ===== 图标映射 =====
import type { ReactNode } from 'react';

export function getAgentIcon(agent: string, size?: number): ReactNode {
  switch (agent) {
    case 'claude-code': return <ClaudeIcon size={size} />;
    case 'codex': return <CodexIcon size={size} />;
    case 'zed': return <ZedIcon size={size} />;
    default: return <UnknownIcon size={size} />;
  }
}

export function getModelIcon(model: string, size?: number): ReactNode {
  const m = model.toLowerCase();
  if (m.includes('deepseek')) return <DeepSeekIcon size={size} />;
  if (m.includes('kimi') || m.includes('moonshot')) return <KimiIcon size={size} />;
  if (m.includes('openai') || m.includes('gpt')) return <OpenAIIcon size={size} />;
  if (m.includes('claude') || m.includes('anthropic')) return <ClaudeIcon size={size} />;
  return <UnknownIcon size={size} />;
}
