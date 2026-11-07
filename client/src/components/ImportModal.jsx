import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { downloadWorkbook } from '../lib/xlsxDownload';

const columns = ['Inventory tag', 'Quantity', 'Asset name', 'Category', 'Description / Brand / Model', 'Serial number', 'Cluster', 'Branch', 'Location', 'Condition', 'Status', 'Purchase date', 'Cost (PHP)', 'Salvage value (PHP)', 'Useful life (years)', 'Book value (PHP)'];
const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fieldMap = {
  inventory: 'inventoryTag', inventorytag: 'inventoryTag', quantity: 'quantity', qty: 'quantity', name: 'name', assetname: 'name', category: 'category', description: 'description', brand: 'description', model: 'description', descriptionbrandmodel: 'description', serialnum: 'serialNo', serialnumber: 'serialNo',
  cluster: 'cluster', branch: 'branch', location: 'location', condition: 'condition', status: 'status', purchasedate: 'purchaseDate',
  cost: 'cost', costphp: 'cost', salvagevalue: 'salvageValue', salvagevaluephp: 'salvageValue',
  usefullife: 'usefulLifeYears', usefullifeyears: 'usefulLifeYears', bookvalue: 'bookValue', bookvaluephp: 'bookValue',
};

function parseWorkbook(buffer, XLSX) {
  const { utils, read } = XLSX;
  const workbook = read(buffer, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const headerRow = matrix.findIndex((row) => {
    const names = row.map(normalize);
    return (names.includes('name') || names.includes('assetname')) && names.includes('branch') && names.includes('location');
  });
  if (headerRow < 0) throw new Error('Could not find the required Name, Branch, and Location columns.');
  const records = utils.sheet_to_json(sheet, { range: headerRow, defval: '', raw: false });
  return records.map((record, index) => ({
    ...Object.entries(record).reduce((row, [key, value]) => {
      const field = fieldMap[normalize(key)];
      if (field) {
        const emptyAmount = ['cost', 'salvageValue', 'usefulLifeYears'].includes(field)
          && typeof value === 'string'
          && ['-', '–', '—'].includes(value.trim());
        row[field] = emptyAmount ? '' : value;
      }
      return row;
    }, {}),
    _row: headerRow + index + 2,
  }));
}

function validate(row, branches, locations) {
  const errors = [];
  const quantity = row.quantity === '' || row.quantity === undefined ? 1 : Number(row.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) errors.push('Enter a quantity from 1 to 500.');
  if (!String(row.name || '').trim()) errors.push('Name is required');
  if (!String(row.branch || '').trim()) errors.push('Branch is required');
  if (!String(row.location || '').trim()) errors.push('Location is required');
  const branchValue = String(row.branch || '').trim().toLowerCase();
  const branch = branches.find((item) => item.name.toLowerCase() === branchValue || item.prefix.toLowerCase() === branchValue);
  if (branchValue && !branch) errors.push(`Branch "${row.branch}" not found. Use a branch name or code, such as CARCAR or CCR.`);
  const locationValue = String(row.location || '').trim().toLowerCase();
  if (branch && locationValue && !locations.some((item) => (
    String(item.branch?._id || item.branch) === branch._id && item.name.toLowerCase() === locationValue
  ))) errors.push(`Location "${row.location}" not found in ${branch.name}.`);
  for (const [field, label, min] of [['cost', 'Cost', 0], ['salvageValue', 'Salvage value', 0], ['usefulLifeYears', 'Useful life', 1]]) {
    const value = row[field];
    if (value !== '' && value !== undefined && value !== null && (!Number.isFinite(Number(value)) || Number(value) < min)) {
      errors.push(field === 'usefulLifeYears' ? 'Useful life must be at least 1 year.' : `Enter a valid ${label.toLowerCase()} amount.`);
    }
  }
  if (row.status && !['Active', 'Damaged', 'Missing', 'In-Transit', 'Disposed'].includes(String(row.status))) errors.push('Choose a valid status.');
  return { ...row, quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1, _errors: errors };
}

export default function ImportModal({ onClose, onImported }) {
  const { meta } = useAuth();
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const invalid = useMemo(() => rows.filter((row) => row._errors.length), [rows]);
  const totalAssets = useMemo(() => rows.reduce((total, row) => total + row.quantity, 0), [rows]);
  const tooManyAssets = totalAssets > 500;

  const loadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(''); setFileName(file.name);
    try {
      const { default: XLSX } = await import('xlsx-js-style');
      const parsed = parseWorkbook(await file.arrayBuffer(), XLSX);
      if (!parsed.length) throw new Error('The workbook has no data rows.');
      setRows(parsed.map((row) => validate(row, meta.branches, meta.locations)));
    } catch (e) { setRows([]); setError(e.message || 'Could not read this Excel file.'); }
  };

  const downloadTemplate = async () => {
    setError('');
    try {
    const { default: XLSX } = await import('xlsx-js-style');
    const { utils } = XLSX;
    const generatedAt = new Date();
    const worksheetData = [
      ['COSMOPOLITAN FUNERAL HOMES'],
      ['ASSET IMPORT TEMPLATE'],
      [`Prepared ${generatedAt.toLocaleString('en-PH')}`],
      ['Replace the sample row with your details. Enter how many items you have; the system will create a separate record and code for each one. Use the full branch name or branch code. Cost is per item; the serial number is used for the first item only.'],
      [],
      columns,
      ['', 3, 'Sample asset', 'Furniture', '3 Seater / Color Black', 'SN-123', 'SOUTH', 'CARCAR', 'OFFICE', 'Good', 'Active', new Date(2025, 0, 15), 0, 0, 5, 0],
    ];
    const worksheet = utils.aoa_to_sheet(worksheetData);
    const columnCount = columns.length;
    const finalColumn = utils.encode_col(columnCount - 1);
    const setCellStyle = (row, column, style) => {
      const address = utils.encode_cell({ r: row, c: column });
      if (!worksheet[address]) worksheet[address] = { t: 's', v: '' };
      worksheet[address].s = style;
    };
    const titleStyle = {
      fill: { patternType: 'solid', fgColor: { rgb: '172554' } },
      font: { name: 'Aptos Display', bold: true, color: { rgb: 'FFFFFF' }, sz: 17 },
      alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
    };
    const widths = [19, 12, 30, 20, 32, 21, 22, 22, 22, 18, 18, 17, 18, 21, 20, 20];
    worksheet['!merges'] = [0, 1, 2, 3].map((row) => ({
      s: { r: row, c: 0 },
      e: { r: row, c: columnCount - 1 },
    }));
    worksheet['!cols'] = widths.map((wch) => ({ wch }));
    worksheet['!rows'] = [{ hpt: 31 }, { hpt: 24 }, { hpt: 21 }, { hpt: 24 }, { hpt: 9 }, { hpt: 32 }, { hpt: 24 }];
    worksheet['!autofilter'] = { ref: `A6:${finalColumn}${worksheetData.length}` };
    for (let column = 0; column < columnCount; column += 1) {
      setCellStyle(0, column, titleStyle);
      setCellStyle(1, column, {
        fill: { patternType: 'solid', fgColor: { rgb: 'EAF0FF' } },
        font: { name: 'Aptos', bold: true, color: { rgb: '304CC6' }, sz: 12 },
        alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
      });
      setCellStyle(2, column, {
        font: { name: 'Aptos', color: { rgb: '687386' }, sz: 10 },
        alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
      });
      setCellStyle(3, column, {
        font: { name: 'Aptos', italic: true, color: { rgb: '45516A' }, sz: 10 },
        alignment: { vertical: 'center', horizontal: 'left', indent: 1, wrapText: true },
      });
      setCellStyle(5, column, {
        fill: { patternType: 'solid', fgColor: { rgb: '304CC6' } },
        font: { name: 'Aptos', bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
        alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
        border: { bottom: { style: 'medium', color: { rgb: '233B9B' } } },
      });
      setCellStyle(6, column, {
        fill: { patternType: 'solid', fgColor: { rgb: 'F4F7FC' } },
        font: { name: 'Aptos', color: { rgb: '253149' }, sz: 10 },
        alignment: { vertical: 'center' },
        border: { bottom: { style: 'thin', color: { rgb: 'E6EAF2' } } },
      });
    }
    setCellStyle(6, 11, {
      fill: { patternType: 'solid', fgColor: { rgb: 'F4F7FC' } },
      font: { name: 'Aptos', color: { rgb: '253149' }, sz: 10 },
      alignment: { vertical: 'center', horizontal: 'center' },
      numFmt: 'dd mmm yyyy',
      border: { bottom: { style: 'thin', color: { rgb: 'E6EAF2' } } },
    });
    [12, 13, 15].forEach((column) => {
      setCellStyle(6, column, {
        fill: { patternType: 'solid', fgColor: { rgb: 'F4F7FC' } },
        font: { name: 'Aptos', color: { rgb: '253149' }, sz: 10 },
        alignment: { vertical: 'center', horizontal: 'right' },
        numFmt: '"₱"#,##0.00;[Red]("₱"#,##0.00);"₱"0.00',
        border: { bottom: { style: 'thin', color: { rgb: 'E6EAF2' } } },
      });
    });
    const workbook = utils.book_new();
    workbook.Props = {
      Title: 'Cosmopolitan Asset Import Template',
      Subject: 'Fixed asset inventory import template',
      Author: 'Cosmopolitan Funeral Homes',
      CreatedDate: generatedAt,
    };
    utils.book_append_sheet(workbook, worksheet, 'Asset Register');
    downloadWorkbook(XLSX, workbook, 'cosmopolitan-asset-import-template.xlsx');
    } catch (e) {
      setError(e.message || 'Could not create the Excel template.');
    }
  };

  const submit = async () => {
    if (!rows.length || invalid.length) return;
    setBusy(true); setError('');
    try {
      await api('/assets/import', { method: 'POST', body: { rows: rows.map(({ _row, _errors, inventoryTag, bookValue, ...row }) => ({ ...row, sourceRow: _row })) } });
      onImported();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <div className="modal-dialog import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" type="button" onClick={onClose} disabled={busy} aria-label="Close import form">×</button>
      <div className="modal-heading"><p className="eyebrow">Spreadsheet import</p><h2 id="import-title">Import assets</h2><p className="sub">Choose an Excel file with your asset details. Review the rows before adding them.</p></div>
      <div className="import-actions"><label className="file-picker"><input type="file" accept=".xlsx,.xls,.csv" onChange={loadFile} />{fileName || 'Choose Excel file'}</label><button className="btn" type="button" onClick={downloadTemplate}>Download template</button></div>
      {rows.length > 0 && <div className="import-summary"><b>{rows.length} {rows.length === 1 ? 'row' : 'rows'} · {totalAssets} {totalAssets === 1 ? 'asset' : 'assets'}</b><span className={invalid.length || tooManyAssets ? 'import-invalid' : 'import-valid'}>{tooManyAssets ? 'You can add up to 500 assets at a time.' : invalid.length ? `Please check ${invalid.length === 1 ? 'this row' : `these ${invalid.length} rows`}.` : 'Ready to add'}</span></div>}
      {rows.length > 0 && <div className="import-preview"><div className="import-preview-head"><span>Row</span><span>Asset</span><span>Branch / location</span><span>Check</span></div>{rows.slice(0, 20).map((row) => <div className="import-preview-row" key={row._row}><span>{row._row}</span><span><b>{row.name || 'Unnamed'} · Qty {row.quantity}</b><small>{row.quantity > 1 ? `${row.quantity} asset codes will be created` : row.inventoryTag || 'Asset code will be created'}</small></span><span>{row.branch || '—'}<small>{row.location || '—'}</small></span><span className={row._errors.length ? 'import-invalid' : 'import-valid'}>{row._errors.length ? row._errors.join(', ') : 'Ready to add'}</span></div>)}</div>}
      {rows.length > 20 && <p className="sub import-more">Showing first 20 rows of {rows.length}.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="btn blue" type="button" onClick={submit} disabled={busy || !rows.length || invalid.length > 0 || tooManyAssets}>{busy ? 'Importing…' : `Import ${totalAssets || ''} assets`}</button></div>
    </div>
  </div>;
}
