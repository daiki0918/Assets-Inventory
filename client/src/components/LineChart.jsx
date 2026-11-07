const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const PADDING = { top: 16, right: 16, bottom: 36, left: 36 };

export default function LineChart({ title, items }) {
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(...items.map((item) => item.count), 1);
  const points = items.map((item, index) => ({
    ...item,
    x: PADDING.left + (items.length > 1 ? (index / (items.length - 1)) * plotWidth : plotWidth / 2),
    y: PADDING.top + plotHeight - (item.count / max) * plotHeight,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const area = `${line} L ${PADDING.left + plotWidth} ${PADDING.top + plotHeight} L ${PADDING.left} ${PADDING.top + plotHeight} Z`;
  const guides = Array.from({ length: 4 }, (_, index) => ({
    value: Math.round(max - (max * index) / 3),
    y: PADDING.top + (plotHeight * index) / 3,
  }));

  return (
    <section className="card chart chart-line">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p className="line-chart-caption">Monthly assets purchased · last 12 months</p>
        </div>
      </div>
      <div className="line-chart-scroll">
        <svg
          className="line-chart-svg"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label={`${title}: ${items.map((item) => `${item.label}: ${item.count}`).join(', ')}`}
        >
          <defs>
            <linearGradient id="line-chart-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--blue)" stopOpacity=".22" />
              <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {guides.map((guide, index) => (
            <g key={`${guide.y}-${index}`}>
              <line className="line-chart-gridline" x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={guide.y} y2={guide.y} />
              <text className="line-chart-axis-label" x={PADDING.left - 10} y={guide.y + 4} textAnchor="end">{guide.value}</text>
            </g>
          ))}
          <path className="line-chart-area" d={area} />
          <path className="line-chart-path" d={line} />
          {points.map((point) => (
            <g key={point.key}>
              <circle className="line-chart-point" cx={point.x} cy={point.y} r="3.5">
                <title>{`${point.label}: ${point.count} ${point.count === 1 ? 'asset' : 'assets'}`}</title>
              </circle>
              <text className="line-chart-axis-label" x={point.x} y={CHART_HEIGHT - 10} textAnchor="middle">{point.shortLabel}</text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
