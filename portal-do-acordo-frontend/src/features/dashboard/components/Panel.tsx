import { useState, type ReactNode } from 'react';

type PanelProps = {
  title: string;
  meta?: string;
  summary?: string;
  children: ReactNode | ((expanded: boolean) => ReactNode);
  className?: string;
  expandable?: boolean;
};

export function Panel({ title, meta, summary, children, className = '', expandable = true }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = expandable && expanded;

  return (
    <div
      className={`panel ${isExpanded ? 'expanded' : ''} ${className}`}
      data-summary={summary}
      role={expandable ? 'button' : undefined}
      aria-expanded={expandable ? isExpanded : undefined}
      aria-label={expandable ? `${isExpanded ? 'Fechar' : 'Expandir'} painel ${title}` : title}
      tabIndex={expandable ? 0 : undefined}
      onClick={expandable ? () => setExpanded((current) => !current) : undefined}
      onKeyDown={(event) => {
        if (!expandable) return;
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
      <div className="panel-body">{typeof children === 'function' ? children(isExpanded) : children}</div>
    </div>
  );
}
