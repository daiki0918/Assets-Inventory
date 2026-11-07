export default function PageHeader({ eyebrow, title, description, action }) {
  return <header className="page-header flex items-start justify-between gap-6"><div className="min-w-0"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="sub">{description}</p>}</div>{action && <div className="hero-actions flex flex-wrap justify-end gap-2">{action}</div>}</header>;
}
