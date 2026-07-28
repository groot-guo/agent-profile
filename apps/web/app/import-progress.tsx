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

  if (!page) {
    const hasFailures = progress.failedSources.length > 0;
    const compactTitle = active
      ? status.operation === 'rebuild'
        ? '正在重建分析'
        : '正在同步数据'
      : hasFailures
        ? '部分来源需要重试'
        : '同步已完成';
    const compactDetail = active
      ? progress.activeSources.map((source) => source.label).join('、') || '准备可用来源'
      : hasFailures
        ? progress.failedSources.map((source) => source.label).join('、')
        : '本地数据已更新';

    return (
      <section
        className="import-progress import-progress-compact"
        aria-busy={active}
        aria-labelledby={titleId}
        data-failed={hasFailures ? 'true' : 'false'}
      >
        <details>
          <summary className="import-progress-compact-summary">
            <span
              className="import-progress-spinner import-progress-spinner-compact"
              data-active={active ? 'true' : 'false'}
              data-failed={hasFailures ? 'true' : 'false'}
              aria-hidden="true"
            />
            <span className="import-progress-compact-copy">
              <strong id={titleId}>{compactTitle}</strong>
              <small title={compactDetail}>{compactDetail}</small>
            </span>
            <span className="import-progress-compact-count tnum">
              {progress.settledSources}/{progress.availableSources.length}
            </span>
            <span className="import-progress-compact-chevron" aria-hidden="true" />
          </summary>

          <div className="import-progress-compact-detail">
            <div className="import-progress-source-list">
              {progress.availableSources.map((source) => (
                <div
                  key={source.id}
                  className="import-progress-source-row"
                  data-state={source.state}
                >
                  <AgentMark agent={source.id} size={18} />
                  <span>{source.label}</span>
                  <small>{sourceStatusText(source)}</small>
                </div>
              ))}
            </div>
            {progress.unavailableSources.length > 0 && (
              <p>
                本机未发现（不计入进度）：
                {progress.unavailableSources.map((source) => source.label).join('、')}
              </p>
            )}
            <p>来源级进度；完成后会自动刷新 Session 列表。</p>
          </div>
        </details>

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
      </section>
    );
  }

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
          <div className="import-progress-eyebrow">Local evidence preparation</div>
          <h1 id={titleId}>{progress.operationLabel}</h1>
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
