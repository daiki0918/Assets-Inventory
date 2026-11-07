export default function Stat({ value, label, missing, icon, detail, className = '' }) {
  return <div className={`stat ${className}`}>
    {icon && <span className="stat-icon" aria-hidden="true">{icon}</span>}
    <b className={missing ? 'missing-value' : ''}>{value}</b>
    <span>{label}</span>
    {detail && <small>{detail}</small>}
  </div>;
}
