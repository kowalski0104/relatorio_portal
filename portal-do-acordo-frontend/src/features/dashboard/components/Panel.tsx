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
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Fechar' : 'Expandir'} painel ${title}`}
      tabIndex={0}
      onClick={() => setExpanded((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setExpanded((current) => !current);
        }
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
