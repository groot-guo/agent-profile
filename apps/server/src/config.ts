export const config = {
  port: Number(process.env.PORT) || 3000,
  // AUTO_SCAN_DIR 未设置 → 默认扫描所有源
  // AUTO_SCAN_DIR 设为空字符串 → 不自动扫描
  // AUTO_SCAN_DIR 设为路径 → 扫描该路径
  autoScanDir:
    process.env.AUTO_SCAN_DIR !== undefined
      ? process.env.AUTO_SCAN_DIR || null
      : '~/.claude/projects',
  defaultScanDir: '~/.claude/projects',
  // 自动扫描的多源目录（AUTO_SCAN_DIR 未覆盖时使用）
  autoScanDirs: ['~/.claude/projects', '~/.codex/sessions'],
};
