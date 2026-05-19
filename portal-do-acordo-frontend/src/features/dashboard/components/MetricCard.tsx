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
  const hasVariation = variation !== null && Number.isFinite(variation);
  const variationClass = hasVariation && variation >= 0 ? 'positive' : 'negative';

  return (
    <div
      className={`metric-card ${tone} ${expanded ? 'expanded' : ''}`}
      data-summary={summary}
      role="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Fechar' : 'Expandir'} KPI ${label}`}
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
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{small}</small>
      {hasVariation ? <em className={`metric-variation ${variationClass}`}>{variation >= 0 ? '+' : ''}{variation.toFixed(1)}% vs mês anterior</em> : null}
      {expanded ? (
        <div className="metric-expanded">
          <b>Comparativo mensal</b>
          <em>{previous !== undefined ? `Mês anterior: ${number(previous)}` : 'Sem mês anterior carregado'}</em>
          <em>{hasVariation ? `Variação: ${variation >= 0 ? '+' : ''}${variation.toFixed(1)}%` : 'Variação indisponível'}</em>
        </div>
      ) : null}
    </div>
  );
}
