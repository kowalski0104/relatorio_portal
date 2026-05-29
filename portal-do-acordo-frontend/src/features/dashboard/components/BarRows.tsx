import { CHART_PALETTE } from '../config/constants';
import { number, percent } from '../utils/formatters';

type BarRow = {
  name: string;
  value: number;
};

type BarRowsProps = {
  rows: BarRow[];
  color: string;
  valueFormatter?: (value: number) => string;
  showPercent?: boolean;
  valueLabel?: string;
  visualLabel?: string;
};

export function BarRows({ rows, color, valueFormatter = number, showPercent = false, valueLabel = 'Valor', visualLabel = 'Participação visual' }: BarRowsProps) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  if (rows.length === 0) return <div className="empty-state">Sem dados no período.</div>;

  return (
    <div className="bar-list">
      <div className="bar-table-head">
        <span>Grupo</span>
        <span>{visualLabel}</span>
        <span>{valueLabel}</span>
        {showPercent ? <span>%</span> : null}
      </div>
      {rows.map((row, index) => (
        <div className="bar-row" key={row.name}>
          <span className="bar-label">{row.name}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(row.value / max) * 100}%`, background: CHART_PALETTE[index % CHART_PALETTE.length] || color }}
            />
          </div>
          <span className="bar-value">{valueFormatter(row.value)}</span>
          {showPercent ? <span className="bar-percent">{percent(row.value, total)}</span> : null}
        </div>
      ))}
    </div>
  );
}
