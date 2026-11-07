import { peso } from '../lib/api';

export default function Chart({ title, items = [], type, value }) {
  const max = Math.max(...items.map((item) => item.count || item.value || 0), 1);
  const total = items.reduce((sum, item) => sum + (item.count || 0), 0);
  const colors = ['var(--blue)', 'var(--ok)', 'var(--warn)', 'var(--bad)'];
  const stops = items.reduce((result, item, index) => {
    const start = result.end;
    const end = start + (total ? (item.count / total) * 100 : 0);
    result.parts.push(`${colors[index % colors.length]} ${start}% ${end}%`);
    result.end = end;
    return result;
  }, { parts: [], end: 0 });
  return <div className={`card chart ${type || ''}`}><div className="section-heading"><h2>{title}</h2></div>{type === 'donut' ? <div className="donut-layout"><div className="donut" style={{ background: `conic-gradient(${stops.parts.join(', ') || 'var(--surface-soft) 0 100%'})` }}><span>{total}</span></div><div className="legend">{items.map((item, index) => <span key={item.name}><i style={{ background: colors[index % colors.length] }} />{item.name}<b>{item.count}</b></span>)}</div></div> : <div className="bars">{items.slice(0, 6).map((item) => <div className="bar-row" key={item.name}><span title={item.name}>{item.name}</span><div><i style={{ width: `${Math.max(5, ((item.count || item.value || 0) / max) * 100)}%` }} /></div><b>{value ? peso(item.value || item.count) : item.count}</b></div>)}</div>}</div>;
}
