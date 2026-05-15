import { useState, type ReactNode } from 'react';

type PanelProps = {
  title: string;
  meta?: string;
  summary?: string;
  children: ReactNode | ((expanded: boolean) => ReactNode);
  className?: string;
};

export function Panel({ title, meta, summary, children, className = '' }: PanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`panel ${expanded ? 'expanded' : ''} ${className}`}
      data-summary={summary}
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') setExpanded((current) => !current);
        if (event.key === 'Escape') setExpanded(false);
      }}
    >
      <div className="panel-head">
        <span>{title}</span>
        {meta ? <small>{meta}</small> : null}
      </div>
      <div className="panel-body">{typeof children === 'function' ? children(expanded) : children}</div>
    </div>
  );
}
