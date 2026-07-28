import type { ImportJobStatus, ImportSourceStatus } from './config';
import { AgentMark } from './icons';
import { importProgressView, sourceStatusText } from './import-state';

export function ImportProgressPanel({
  status,
  mode = 'compact',
}: {
  status: ImportJobStatus;
  mode?: 'page' | 'compact';
}) {
  const progress = importProgressView(status);
  const active = status.active;
  const page = mode === 'page';
  const titleId = `import-progress-title-${mode}`;

  return (
    <section
      className={`import-progress import-progress-${mode}`}
      aria-busy={active}
      aria-labelledby={titleId}
    >
      <div className="import-progress-heading">
        <span
          className="import-progress-spinner"
          data-active={active ? 'true' : 'false'}
          aria-hidden="true"
        />
        <div>
          {page && <div className="import-progress-eyebrow">Local evidence preparation</div>}
          {page ? (
            <h1 id={titleId}>{progress.operationLabel}</h1>
          ) : (
            <h2 id={titleId}>{progress.operationLabel}</h2>
          )}
          <p>{active ? '正在读取可用来源并更新本地分析' : '本轮来源处理已经结束'}</p>
        </div>
        <div className="import-progress-count tnum">
          <strong>{progress.settledSources}</strong>
          <span>/ {progress.availableSources.length}</span>
          <small>来源已结束</small>
        </div>
      </div>

      <div
        className="import-progress-track"
        role="progressbar"
        aria-label="数据来源处理进度"
        aria-valuemin={0}
        aria-valuemax={progress.availableSources.length}
        aria-valuenow={progress.settledSources}
        aria-valuetext={`${progress.settledSources} / ${progress.availableSources.length} 个可用来源已结束`}
      >
        <span style={{ width: `${progress.progressPercent}%` }} />
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {progress.statusText}
      </div>

      {page ? (
        <>
          <p className="import-progress-intro">
            首次准备期间暂时没有可展示的 Session。完成后页面会自动刷新；离开此页不会中止 Server
            中的导入任务。这里只展示来源状态和计数，不返回原始对话内容。
          </p>
          <div className="import-source-grid">
            {progress.availableSources.map((source) => (
              <ImportSourceCard key={source.id} source={source} />
            ))}
          </div>
          {progress.unavailableSources.length > 0 && (
            <p className="import-progress-unavailable">
              本机未发现（不计入进度）：
              {progress.unavailableSources.map((source) => source.label).join('、')}
            </p>
          )}
          <p className="import-progress-note">
            这是来源级进度，不是文件或记录级百分比；单个大型来源处理期间，进度条可能暂时不变。
          </p>
        </>
      ) : (
        <div className="import-progress-compact-detail">
          {progress.activeSources.length > 0 && (
            <span>正在处理：{progress.activeSources.map((source) => source.label).join('、')}</span>
          )}
          {progress.failedSources.length > 0 && (
            <span data-failed="true">
              需要重试：{progress.failedSources.map((source) => source.label).join('、')}
            </span>
          )}
          <small>来源级进度 · 完成后自动刷新列表</small>
        </div>
      )}
    </section>
  );
}

function ImportSourceCard({ source }: { source: ImportSourceStatus }) {
  return (
    <article className="import-source-card" data-state={source.state}>
      <div className="import-source-heading">
        <AgentMark agent={source.id} size={24} />
        <strong>{source.label}</strong>
        <span className="import-source-state">
          {source.state === 'scanning'
            ? '处理中'
            : source.state === 'completed'
              ? '已完成'
              : source.state === 'failed'
                ? '失败'
                : '等待中'}
        </span>
      </div>
      <p>{sourceStatusText(source)}</p>
      {source.state === 'scanning' && (
        <span className="import-source-active-line" aria-hidden="true" />
      )}
    </article>
  );
}
