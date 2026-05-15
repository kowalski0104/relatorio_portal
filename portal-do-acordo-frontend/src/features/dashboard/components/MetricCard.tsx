import { useState } from 'react';
import { number } from '../utils/formatters';

type MetricCardProps = {
  tone: string;
  label: string;
  value: string;
  current: number;
  small: string;
  previous?: number;
  summary?: string;
};

export function MetricCard({ tone, label, value, current, small, previous, summary }: MetricCardProps) {
  const [expanded, setExpanded] = useState(false);
  const variation = previous && previous !== 0 ? ((current - previous) / previous) * 100 : null;

  return (
    <div
      className={`metric-card ${tone} ${expanded ? 'expanded' : ''}`}
      data-summary={summary}
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') setExpanded((current) => !current);
        if (event.key === 'Escape') setExpanded(false);
      }}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{small}</small>
      {expanded ? (
        <div className="metric-expanded">
          <b>Comparativo mensal</b>
          <em>{previous !== undefined ? `Mês anterior: ${number(previous)}` : 'Sem mês anterior carregado'}</em>
          <em>{variation !== null && Number.isFinite(variation) ? `Variação: ${variation.toFixed(1)}%` : 'Variação indisponível'}</em>
        </div>
      ) : null}
    </div>
  );
}
