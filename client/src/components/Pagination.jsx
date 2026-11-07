export default function Pagination({ page, pageSize, total, onChange }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (!total || pageCount === 1) return null;
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  return <nav className="pagination" aria-label="Pagination">
    <span className="pagination-summary">Showing <b>{start}–{end}</b> of <b>{total}</b></span>
    <div className="pagination-controls">
      <button className="pagination-button" type="button" aria-label="Previous page" disabled={current === 1} onClick={() => onChange(current - 1)}><span aria-hidden="true">←</span><span>Previous</span></button>
      <span className="pagination-page">Page <b>{current}</b> <span aria-hidden="true">/</span> {pageCount}</span>
      <button className="pagination-button" type="button" aria-label="Next page" disabled={current === pageCount} onClick={() => onChange(current + 1)}><span>Next</span><span aria-hidden="true">→</span></button>
    </div>
  </nav>;
}
