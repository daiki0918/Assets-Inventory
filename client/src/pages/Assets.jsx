import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, getToken, peso } from '../lib/api';
import AssetModal from '../components/AssetModal';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import Status from '../components/Status';
import ImportModal from '../components/ImportModal';
import QrLabelsModal from '../components/QrLabelsModal';
import Pagination from '../components/Pagination';
import DrawerPortal from '../components/DrawerPortal';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';
import { downloadWorkbook } from '../lib/xlsxDownload';

const EMPTY_FILTERS = {
  branch: '',
  cluster: '',
  location: '',
  category: '',
  condition: '',
  purchaseFrom: '',
  purchaseTo: '',
};

export default function Assets() {
  const { meta, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(searchParams.get('import') === '1');
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const visibleRows = rows?.slice((page - 1) * pageSize, page * pageSize) || [];
  const requestParams = (selectedFilters = filters, selectedStatus = status, search = query) => new URLSearchParams(
    Object.entries({ q: search.trim(), status: selectedStatus, ...selectedFilters }).filter(([, value]) => value),
  );
  const load = () => api(`/assets?${requestParams()}`).then(setRows).catch((e) => setError(e.message));
  useRealtimeRefresh(load);
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (status ? 1 : 0);
  const branchForLocation = (location) => meta.branches.find((item) => item._id === (location.branch?._id || location.branch));
  const filteredBranches = meta.branches.filter((item) => !draftFilters.cluster || String(item.cluster?._id || item.cluster) === draftFilters.cluster);
  const filteredLocations = meta.locations.filter((item) => (
    (!draftFilters.branch || String(item.branch?._id || item.branch) === draftFilters.branch)
    && (!draftFilters.cluster || String(branchForLocation(item)?.cluster?._id || branchForLocation(item)?.cluster) === draftFilters.cluster)
  ));
  const setDraftFilter = (key, value) => setDraftFilters((current) => ({
    ...current,
    [key]: value,
    ...(key === 'cluster' ? { branch: '', location: '' } : {}),
    ...(key === 'branch' ? { location: '' } : {}),
  }));
  const openFilters = () => {
    setDraftFilters(filters);
    setFiltersOpen(true);
  };
  const applyFilters = (event) => {
    event.preventDefault();
    setFilters(draftFilters);
    setFiltersOpen(false);
  };
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
    setStatus('');
  };
  useEffect(() => { setPage(1); load(); }, [query, status, filters]);
  useEffect(() => { setImporting(searchParams.get('import') === '1'); }, [searchParams]);
  const exportExcel = async () => {
    setExporting(true);
    setError('');
    try {
      const assets = await api(`/assets?${requestParams()}`);
      const { default: XLSX } = await import('xlsx-js-style');
      const generatedAt = new Date();
      const headers = [
        'Inventory tag', 'Asset name', 'Category', 'Description / Brand / Model', 'Serial number', 'Cluster', 'Branch',
        'Location', 'Condition', 'Status', 'Purchase date', 'Cost (PHP)', 'Salvage value (PHP)',
        'Useful life (years)', 'Book value (PHP)',
      ];
      const assetRows = assets.map((asset) => [
        asset.inventoryTag || '',
        asset.name || '',
        asset.category || '',
        asset.description || '',
        asset.serialNo || '',
        asset.cluster?.name || '',
        asset.branch?.name || '',
        asset.location?.name || '',
        asset.condition || 'Good',
        asset.status || 'Unknown',
        asset.purchaseDate ? new Date(asset.purchaseDate) : '',
        Number(asset.cost || 0),
        Number(asset.salvageValue || 0),
        Number(asset.usefulLifeYears || 0),
        Number(asset.bookValue || 0),
      ]);
      const columnCount = headers.length;
      const finalColumn = XLSX.utils.encode_col(columnCount - 1);
      const workbook = XLSX.utils.book_new();
      workbook.Props = {
        Title: 'Cosmopolitan Asset Register',
        Subject: 'Fixed asset inventory export',
        Author: 'Cosmopolitan Funeral Homes',
        CreatedDate: generatedAt,
      };
      const searchTerm = query.trim();
      const filterDescription = [
        searchTerm && `Search: ${searchTerm}`,
        status && `Status: ${status}`,
        filters.cluster && `Cluster: ${meta.clusters.find((item) => item._id === filters.cluster)?.name || filters.cluster}`,
        filters.branch && `Branch: ${meta.branches.find((item) => item._id === filters.branch)?.name || filters.branch}`,
        filters.location && `Location: ${meta.locations.find((item) => item._id === filters.location)?.name || filters.location}`,
        filters.category && `Category: ${filters.category}`,
        filters.condition && `Condition: ${filters.condition}`,
        filters.purchaseFrom && `Purchased from: ${filters.purchaseFrom}`,
        filters.purchaseTo && `Purchased to: ${filters.purchaseTo}`,
      ].filter(Boolean).join(' · ') || 'All assets';
      const setCellStyle = (sheet, row, column, style) => {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        if (!sheet[address]) sheet[address] = { t: 's', v: '' };
        sheet[address].s = style;
      };
      const titleStyle = {
        fill: { patternType: 'solid', fgColor: { rgb: '172554' } },
        font: { name: 'Aptos Display', bold: true, color: { rgb: 'FFFFFF' }, sz: 17 },
        alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
      };
      const sectionStyle = {
        fill: { patternType: 'solid', fgColor: { rgb: '304CC6' } },
        font: { name: 'Aptos', bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
        alignment: { vertical: 'center', horizontal: 'left', wrapText: true },
      };
      const registerData = [
        ['COSMOPOLITAN FUNERAL HOMES'],
        ['FIXED ASSET REGISTER'],
        [`Generated ${generatedAt.toLocaleString('en-PH')}`],
        [`Filters: ${filterDescription}`],
        [],
        headers,
        ...assetRows,
      ];
      const register = XLSX.utils.aoa_to_sheet(registerData);
      register['!merges'] = [0, 1, 2, 3].map((row) => ({
        s: { r: row, c: 0 },
        e: { r: row, c: columnCount - 1 },
      }));
      register['!cols'] = [
        { wch: 19 }, { wch: 30 }, { wch: 20 }, { wch: 32 }, { wch: 21 }, { wch: 22 }, { wch: 22 },
        { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 17 }, { wch: 18 }, { wch: 21 }, { wch: 20 }, { wch: 20 },
      ];
      register['!rows'] = [{ hpt: 31 }, { hpt: 24 }, { hpt: 21 }, { hpt: 21 }, { hpt: 9 }, { hpt: 32 }];
      register['!autofilter'] = { ref: `A6:${finalColumn}${Math.max(6, registerData.length)}` };
      for (let column = 0; column < columnCount; column += 1) {
        setCellStyle(register, 0, column, titleStyle);
        setCellStyle(register, 1, column, {
          fill: { patternType: 'solid', fgColor: { rgb: 'EAF0FF' } },
          font: { name: 'Aptos', bold: true, color: { rgb: '304CC6' }, sz: 12 },
          alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
        });
        setCellStyle(register, 2, column, {
          font: { name: 'Aptos', color: { rgb: '687386' }, sz: 10 },
          alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
        });
        setCellStyle(register, 3, column, {
          font: { name: 'Aptos', color: { rgb: '45516A' }, italic: true, sz: 10 },
          alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
        });
        setCellStyle(register, 5, column, {
          ...sectionStyle,
          alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
          border: { bottom: { style: 'medium', color: { rgb: '233B9B' } } },
        });
      }

      const statusColors = {
        Active: ['E7F7EF', '18794E'],
        Damaged: ['FDECEC', 'B42318'],
        Missing: ['FFF4E5', 'B54708'],
        'In-Transit': ['EAF0FF', '304CC6'],
        Disposed: ['EEF0F4', '586174'],
      };
      for (let row = 6; row < registerData.length; row += 1) {
        const fill = row % 2 === 0 ? 'F4F7FC' : 'FFFFFF';
        for (let column = 0; column < columnCount; column += 1) {
          const style = {
            fill: { patternType: 'solid', fgColor: { rgb: fill } },
            font: { name: 'Aptos', color: { rgb: '253149' }, sz: 10 },
            alignment: { vertical: 'center' },
            border: { bottom: { style: 'thin', color: { rgb: 'E6EAF2' } } },
          };
          if ([11, 12, 14].includes(column)) {
            style.numFmt = '"₱"#,##0.00;[Red]("₱"#,##0.00);-';
            style.alignment.horizontal = 'right';
          } else if (column === 10) {
            style.numFmt = 'dd mmm yyyy';
            style.alignment.horizontal = 'center';
          } else if (column === 13) {
            style.numFmt = '0.0';
            style.alignment.horizontal = 'center';
          }
          setCellStyle(register, row, column, style);
        }
        register['!rows'][row] = { hpt: 22 };
        const statusCell = XLSX.utils.encode_cell({ r: row, c: 9 });
        const [statusFill, statusText] = statusColors[assetRows[row - 6][9]] || ['EAF0FF', '304CC6'];
        register[statusCell].s = {
          fill: { patternType: 'solid', fgColor: { rgb: statusFill } },
          font: { name: 'Aptos', bold: true, color: { rgb: statusText }, sz: 10 },
          alignment: { vertical: 'center', horizontal: 'center' },
        };
      }
      XLSX.utils.book_append_sheet(workbook, register, 'Asset Register');

      const totalCost = assets.reduce((sum, asset) => sum + Number(asset.cost || 0), 0);
      const totalBookValue = assets.reduce((sum, asset) => sum + Number(asset.bookValue || 0), 0);
      const statusCounts = assets.reduce((counts, asset) => {
        const label = asset.status || 'Unknown';
        counts.set(label, (counts.get(label) || 0) + 1);
        return counts;
      }, new Map());
      const summaryData = [
        ['INVENTORY OVERVIEW'],
        ['Cosmopolitan Funeral Homes · Fixed Asset Register'],
        [`Exported ${generatedAt.toLocaleString('en-PH')}`],
        [],
        ['EXPORT SNAPSHOT', 'VALUE'],
        ['Total assets', assets.length],
        ['Total acquisition cost', totalCost],
        ['Total current book value', totalBookValue],
        ['Applied filters', filterDescription],
        [],
        ['ASSET STATUS BREAKDOWN', 'COUNT'],
        ...[...statusCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ];
      const summary = XLSX.utils.aoa_to_sheet(summaryData);
      summary['!merges'] = [0, 1, 2].map((row) => ({
        s: { r: row, c: 0 },
        e: { r: row, c: 1 },
      }));
      summary['!cols'] = [{ wch: 36 }, { wch: 24 }];
      summary['!rows'] = [{ hpt: 32 }, { hpt: 23 }, { hpt: 21 }];
      for (let column = 0; column < 2; column += 1) {
        setCellStyle(summary, 0, column, titleStyle);
        setCellStyle(summary, 1, column, {
          font: { name: 'Aptos', bold: true, color: { rgb: '304CC6' }, sz: 11 },
          alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
        });
        setCellStyle(summary, 2, column, {
          font: { name: 'Aptos', color: { rgb: '687386' }, sz: 10 },
          alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
        });
      }
      [4, 10].forEach((row) => {
        for (let column = 0; column < 2; column += 1) setCellStyle(summary, row, column, sectionStyle);
      });
      for (let row = 5; row < summaryData.length; row += 1) {
        const values = summaryData[row] || [];
        for (let column = 0; column < 2; column += 1) {
          setCellStyle(summary, row, column, {
            fill: { patternType: 'solid', fgColor: { rgb: row % 2 ? 'F4F7FC' : 'FFFFFF' } },
            font: { name: 'Aptos', color: { rgb: '253149' }, sz: 10 },
            alignment: {
              vertical: 'center',
              horizontal: column === 1 && typeof values[column] === 'number' ? 'right' : 'left',
              wrapText: true,
            },
            border: { bottom: { style: 'thin', color: { rgb: 'E6EAF2' } } },
          });
        }
      }
      [6, 7].forEach((row) => {
        const address = XLSX.utils.encode_cell({ r: row, c: 1 });
        summary[address].s.numFmt = '"₱"#,##0.00;[Red]("₱"#,##0.00);-';
        summary[address].s.font = { name: 'Aptos', bold: true, color: { rgb: '304CC6' }, sz: 11 };
      });
      summary['!autofilter'] = { ref: `A11:B${Math.max(11, summaryData.length)}` };
      XLSX.utils.book_append_sheet(workbook, summary, 'Summary');
      downloadWorkbook(XLSX, workbook, `cosmopolitan-asset-register-${generatedAt.toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setError(e.message || 'Excel export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };
  const exportCsv = async () => {
    setExporting(true); setError('');
    try {
      const response = await fetch(`/api/assets/export?${requestParams()}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!response.ok) throw new Error('Export failed. Please try again.');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
      link.href = url; link.download = 'assets.csv'; link.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); } finally { setExporting(false); }
  };
  const saved = () => { setModal(null); load(); };
  const deleteAsset = async () => {
    setDeleteBusy(true); setError('');
    try { await api(`/assets/${deleteTarget._id}`, { method: 'DELETE' }); setDeleteTarget(null); await load(); } catch (e) { setError(e.message); } finally { setDeleteBusy(false); }
  };
  const closeImport = () => { setImporting(false); if (searchParams.has('import')) setSearchParams({}); };
  return <><PageHeader eyebrow={user.role === 'superadmin' ? 'Inventory · All branches' : 'Inventory · Your branch'} title="All assets" description={rows ? `${rows.length} records` : 'Loading records…'} action={<><button className="btn compact-action" onClick={() => setSearchParams({ import: '1' })}>Import</button><button className="btn compact-action" onClick={() => setLabelsOpen(true)} disabled={!rows?.length}>QR labels</button><button className="btn compact-action" onClick={exportExcel} disabled={exporting}>{exporting ? 'Preparing Excel…' : 'Export Excel'}</button>{user.role === 'superadmin' && <button className="btn blue" onClick={() => setModal({})}>Register asset</button>}</>} />
    {error && <div className="inline-error" role="alert">{error}<button onClick={() => { setError(''); load(); }}>Retry</button></div>}
    <div className="asset-toolbar"><div className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search assets" placeholder="Search tags, names, or serials" value={query} onChange={(e) => setQuery(e.target.value)} /></div><button className="btn" type="button" onClick={openFilters}>Filters <span className="filter-count">{activeFilterCount}</span></button></div>
    <div className="chips"><button className={`chip ${!status ? 'on' : ''}`} onClick={() => setStatus('')}>All</button>{meta.statuses.map((item) => <button className={`chip ${status === item ? 'on' : ''}`} key={item} onClick={() => setStatus(item)}><span className={`dot ${item}`} />{item}</button>)}</div>
    <div className="table-card"><div className="table-head"><span>Asset</span><span>Branch / location</span><span>Status</span><span>Cost</span><span>Book value</span>{user.role === 'superadmin' && <span>Action</span>}</div>{visibleRows.map((asset) => <Link className={`asset-row ${user.role === 'superadmin' ? 'has-action' : ''}`} key={asset._id} to={`/a/${asset.qrToken}`}><span className="asset-identity" data-label="Asset"><b className="tagc">{asset.inventoryTag}</b><small className="asset-meta"><strong>{asset.name}</strong><em>{asset.category || 'Uncategorized'}</em>{asset.description && <em>{asset.description}</em>}</small></span><span data-label="Branch / location"><strong>{asset.branch?.name || 'Unassigned'}</strong><small>{asset.location?.name || 'No location'}</small></span><span className="asset-row-status" data-label="Status"><Status value={asset.status} /><small>Condition: {asset.condition || 'Good'}</small><small>{asset.purchaseDate ? new Date(asset.purchaseDate).toLocaleDateString('en-PH') : 'No purchase date'}</small></span><span data-label="Cost" className={!asset.cost ? 'missing-value' : ''}>{asset.cost ? peso(asset.cost) : 'Missing'}</span><span data-label="Book value">{peso(asset.bookValue)}</span>{user.role === 'superadmin' && <span className="asset-row-action" data-label="Action"><button className="btn btn-sm btn-danger-ghost" type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setDeleteTarget(asset); }}>Delete</button></span>}</Link>)}{rows && !rows.length && <Empty title="No assets found" text="Try changing your search or filters." />}</div>
    <Pagination page={page} pageSize={pageSize} total={rows?.length || 0} onChange={setPage} />
    {filtersOpen && <DrawerPortal><div className="modal-backdrop asset-drawer-backdrop is-open" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFiltersOpen(false)}><aside className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-filters-title"><header className="asset-drawer-header"><div className="modal-heading"><p className="eyebrow">Refine inventory</p><h2 id="asset-filters-title">Filter assets</h2><p className="sub">Combine filters to narrow the asset list.</p></div><button className="modal-close" type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters">×</button></header><form className="asset-drawer-form" onSubmit={applyFilters}><div className="asset-drawer-body">
      <div className="form-section"><h3>Location</h3><div className="form-grid">
        {user.role === 'superadmin' && <><div><label htmlFor="asset-filter-cluster">Cluster</label><select id="asset-filter-cluster" value={draftFilters.cluster} onChange={(event) => setDraftFilter('cluster', event.target.value)}><option value="">All clusters</option>{meta.clusters.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></div>
        <div><label htmlFor="asset-filter-branch">Branch</label><select id="asset-filter-branch" value={draftFilters.branch} onChange={(event) => setDraftFilter('branch', event.target.value)}><option value="">All branches</option>{filteredBranches.map((item) => <option key={item._id} value={item._id}>{item.name} ({item.prefix})</option>)}</select></div></>}
        <div className={user.role === 'superadmin' ? 'wide' : ''}><label htmlFor="asset-filter-location">Location / room</label><select id="asset-filter-location" value={draftFilters.location} onChange={(event) => setDraftFilter('location', event.target.value)}><option value="">All locations</option>{filteredLocations.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></div>
      </div></div>
      <div className="form-section"><h3>Asset details</h3><div className="form-grid">
        <div><label htmlFor="asset-filter-category">Category</label><input id="asset-filter-category" value={draftFilters.category} onChange={(event) => setDraftFilter('category', event.target.value)} placeholder="Any category" /></div>
        <div><label htmlFor="asset-filter-condition">Condition</label><input id="asset-filter-condition" value={draftFilters.condition} onChange={(event) => setDraftFilter('condition', event.target.value)} placeholder="e.g. Good, worn" /></div>
      </div></div>
      <div className="form-section"><h3>Purchase date</h3><div className="form-grid">
        <div><label htmlFor="asset-filter-purchase-from">From</label><input id="asset-filter-purchase-from" type="date" max={draftFilters.purchaseTo || undefined} value={draftFilters.purchaseFrom} onChange={(event) => setDraftFilter('purchaseFrom', event.target.value)} /></div>
        <div><label htmlFor="asset-filter-purchase-to">To</label><input id="asset-filter-purchase-to" type="date" min={draftFilters.purchaseFrom || undefined} value={draftFilters.purchaseTo} onChange={(event) => setDraftFilter('purchaseTo', event.target.value)} /></div>
      </div></div>
    </div><footer className="asset-drawer-footer"><button className="btn" type="button" onClick={clearFilters}>Clear filters</button><button className="btn blue" type="submit">Apply filters</button></footer></form></aside></div></DrawerPortal>}
    {modal && <AssetModal asset={modal._id ? modal : null} onClose={() => setModal(null)} onSaved={saved} />}
    {importing && <ImportModal onClose={closeImport} onImported={() => { closeImport(); load(); }} />}
    {labelsOpen && <QrLabelsModal assets={rows || []} onClose={() => setLabelsOpen(false)} />}
    {deleteTarget && <div className="modal-backdrop"><div className="modal-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-list-asset-title"><div className="modal-heading"><p className="eyebrow">Destructive action</p><h2 id="delete-list-asset-title">Delete asset?</h2><p className="sub">This permanently removes <b>{deleteTarget.inventoryTag}</b> · {deleteTarget.name} from the register.</p></div><div className="modal-actions"><button className="btn" type="button" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Cancel</button><button className="btn danger" type="button" onClick={deleteAsset} disabled={deleteBusy}>{deleteBusy ? 'Deleting…' : 'Delete permanently'}</button></div></div></div>}
  </>;
}
