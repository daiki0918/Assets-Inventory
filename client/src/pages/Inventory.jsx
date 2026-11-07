import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import DrawerPortal from '../components/DrawerPortal';
import Empty from '../components/Empty';
import PageHeader from '../components/PageHeader';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';
import { getManilaMonth } from '../lib/date';

const monthNow = () => getManilaMonth();
const outcomeText = {
  duplicate: 'Already checked in this session.',
  'wrong-branch': 'This asset belongs to a different branch.',
  inactive: 'This asset is not active and was not verified.',
  missing: 'No asset matches that code.',
};

export default function Inventory() {
  const { meta, user } = useAuth();
  const [searchParams] = useSearchParams();
  const autoStart = searchParams.get('scan') === '1';
  const [branch, setBranch] = useState(user.branch || meta.branches[0]?._id || '');
  const [month, setMonth] = useState(monthNow);
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [progress, setProgress] = useState(null);
  const [reviewStatus, setReviewStatus] = useState('unverified');
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState(null);
  const [findDrawerOpen, setFindDrawerOpen] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanFrameRef = useRef(null);
  const autoSessionStarted = useRef(false);
  const scannerRef = useRef(null);
  const lookupCodeRef = useRef(null);

  const stopCamera = () => {
    if (scanFrameRef.current) cancelAnimationFrame(scanFrameRef.current);
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [cameraOn]);

  const loadSessions = async () => {
    if (!branch) return;
    setError('');
    try {
      const rows = await api(`/inventory/sessions?branch=${encodeURIComponent(branch)}`);
      setSessions(rows);
      const current = rows.find((item) => item.month === month);
      setSessionId(current?._id || '');
      setProgress(null);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { loadSessions(); }, [branch, month]);
  useRealtimeRefresh(async () => {
    if (!branch) return;
    try {
      const rows = await api(`/inventory/sessions?branch=${encodeURIComponent(branch)}`);
      setSessions(rows);
      const current = rows.find((item) => item._id === sessionId) || rows.find((item) => item.month === month);
      if (!sessionId && current) setSessionId(current._id);
      if (current) setProgress(await api(`/inventory/sessions/${current._id}`));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  });
  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (!sessionId) return;
    api(`/inventory/sessions/${sessionId}`).then(setProgress).catch((e) => setError(e.message));
  }, [sessionId]);
  useEffect(() => {
    if (!autoStart || !branch || sessionId || autoSessionStarted.current) return;
    autoSessionStarted.current = true;
    createSession().catch(() => { autoSessionStarted.current = false; });
  }, [autoStart, branch, sessionId]);

  const createSession = async () => {
    setError(''); setNotice('');
    try {
      const created = await api('/inventory/sessions', { method: 'POST', body: { branch, month } });
      setSessions((current) => [created, ...current.filter((item) => item._id !== created._id)]);
      setSessionId(created._id);
      setProgress(await api(`/inventory/sessions/${created._id}`));
    } catch (e) { setError(e.message); }
  };

  const lookupCode = async (value = code) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setManualBusy(true); setError(''); setNotice('');
    try {
      const { asset } = await api('/assets/resolve-qr', { method: 'POST', body: { code: trimmed } });
      if (!asset) {
        setCode(trimmed);
        setLookup({ outcome: 'missing', message: 'No asset matches that code.' });
        return;
      }
      const targetBranch = asset.branch._id;
      const session = await api('/inventory/sessions', {
        method: 'POST',
        body: { branch: targetBranch, month },
      });
      setBranch(targetBranch);
      setSessions((current) => [session, ...current.filter((item) => item._id !== session._id)]);
      setSessionId(session._id);
      setProgress(await api(`/inventory/sessions/${session._id}`));
      const result = await api(`/inventory/sessions/${session._id}/lookup`, {
        method: 'POST',
        body: { code: asset.inventoryTag },
      });
      setCode(asset.inventoryTag);
      setLookup(result);
    } catch (e) { setError(e.message); } finally { setManualBusy(false); }
  };
  lookupCodeRef.current = lookupCode;

  const isMobileScanner = () => window.matchMedia('(max-width: 760px)').matches;

  const recordScan = async () => {
    if (!lookup || !code) return;
    setManualBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/inventory/sessions/${sessionId}/scan`, { method: 'POST', body: { code, confirmed: true } });
      if (result.verified) setNotice('Asset verified and recorded for this inventory session.');
      else setNotice(outcomeText[result.outcome] || 'Scan recorded for review.');
      setLookup(null); setCode('');
      setProgress(await api(`/inventory/sessions/${sessionId}`));
      setFindDrawerOpen(false);
      if (isMobileScanner()) startCamera();
    } catch (e) { setError(e.message); } finally { setManualBusy(false); }
  };

  const cancelReview = () => {
    setLookup(null);
    setCode('');
    setFindDrawerOpen(false);
    if (isMobileScanner()) startCamera();
  };

  useEffect(() => {
    if (!findDrawerOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') cancelReview();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [findDrawerOpen]);

  const startCamera = async () => {
    if (cameraStarting || cameraOn) return;
    setCameraError('');
    setCameraStarting(true);
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setCameraError('Camera access requires HTTPS. Use manual code entry or open the app over HTTPS.');
      setCameraStarting(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser cannot access the camera. Use manual code entry below.');
      setCameraStarting(false);
      return;
    }
    try {
      if (!videoRef.current) throw new Error('Scanner video is not ready');
      const scanner = new QrScanner(videoRef.current, (result) => {
        const value = typeof result === 'string' ? result : result.data;
        stopCamera();
        lookupCodeRef.current?.(value);
      }, { preferredCamera: 'environment', returnDetailedScanResult: true });
      scannerRef.current = scanner;
      await scanner.start();
      await videoRef.current.play();
      setCameraOn(true);
    } catch (e) {
      stopCamera();
      setCameraError(e.name === 'NotAllowedError'
        ? 'Camera access was denied. Allow access in your browser settings, then tap Try camera again.'
        : 'The camera could not be started. Confirm this page is opened with HTTPS, then try manual code entry.');
    } finally {
      setCameraStarting(false);
    }
  };

  useEffect(() => {
    if (!autoStart || !isMobileScanner() || !sessionId || cameraOn || cameraError) return;
    startCamera();
  }, [autoStart, sessionId]);

  const selectedBranch = meta.branches.find((item) => item._id === branch);
  const checkedPercent = progress?.totalAssets ? Math.round((progress.checkedAssets / progress.totalAssets) * 100) : 0;
  const unverified = progress?.assets?.filter((asset) => !asset.checked) || [];
  const checked = progress?.assets?.filter((asset) => asset.checked) || [];
  const flagged = progress?.scans?.filter((scan) => !scan.verified) || [];

  return <div className="inventory-page">
    <PageHeader eyebrow="Operations" title="Monthly inventory" description="Scan each asset QR code to verify the physical inventory without paper lists." />
    <section className="card inventory-setup">
      <div className="section-heading"><div><p className="eyebrow">1 · Inventory session</p><h2>Choose branch and month</h2></div></div>
      <div className="inventory-setup-grid">
        <label>Branch<select value={branch} disabled={user.role !== 'superadmin'} onChange={(event) => { setBranch(event.target.value); setSessionId(''); }}>{user.role === 'superadmin' ? <><option value="">Select branch</option>{meta.branches.map((item) => <option key={item._id} value={item._id}>{item.name} ({item.prefix})</option>)}</> : <option value={user.branch}>{selectedBranch?.name || 'Assigned branch'}</option>}</select></label>
        <label>Inventory month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <div className="inventory-session-actions"><button className="btn" type="button" onClick={loadSessions} disabled={!branch}>Load sessions</button><button className="btn blue" type="button" onClick={createSession} disabled={!branch || !month}>Start / continue session</button><button className="btn inventory-find-trigger" type="button" onClick={() => setFindDrawerOpen(true)} disabled={!sessionId}>Find assets</button></div>
      </div>
      {sessions.length > 0 && <label className="inventory-session-select">Existing session<select value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Select a session</option>{sessions.map((item) => <option key={item._id} value={item._id}>{item.month} · {item.status}</option>)}</select></label>}
    </section>

    {sessionId && <><section className="inventory-progress-grid">
      <div className="card inventory-progress-card"><div className="inventory-progress-heading"><div><p className="eyebrow">2 · Progress</p><h2>{progress?.checkedAssets || 0} <span>/ {progress?.totalAssets || 0}</span></h2></div><b>{checkedPercent}%</b></div><div className="progress-track"><span style={{ width: `${checkedPercent}%` }} /></div><p className="sub">{unverified.length} asset{unverified.length === 1 ? '' : 's'} still unverified at {selectedBranch?.name}.</p></div>
      <div className="card inventory-help-card"><b>Scan guidance</b><span>Hold the QR inside the frame. Confirm the asset details before recording.</span></div>
    </section>
    <section className="card inventory-scanner">
      <div className="section-heading"><div><p className="eyebrow">3 · Verify an asset</p><h2>Scan QR code</h2></div><div className="inventory-scanner-actions">{cameraOn && <button className="btn inventory-mobile-camera-action" type="button" onClick={stopCamera}>Stop camera</button>}</div></div>
      <div className={`scanner-view ${cameraOn ? '' : 'scanner-view-idle'}`}><video ref={videoRef} autoPlay muted playsInline />{cameraOn ? <div className="scanner-frame" aria-hidden="true" /> : <button className="scanner-start" type="button" onClick={startCamera}><span aria-hidden="true">⌖</span><b>Open camera scanner</b><small>Camera access is requested only when you start scanning.</small></button>}</div>
      {cameraError && <div className="scanner-error inventory-camera-error"><p className="form-error" role="alert">{cameraError}</p><button className="btn" type="button" onClick={startCamera}>Try camera again</button></div>}
      <div className="manual-scan"><label htmlFor="inventory-code">Manual code entry</label><div><input id="inventory-code" value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && lookupCode()} placeholder="Paste QR URL, token, or inventory tag" /><button className="btn blue" type="button" onClick={() => lookupCode()} disabled={manualBusy || !code.trim()}>{manualBusy ? 'Checking…' : 'Find asset'}</button></div><small>Use this when the camera is unavailable or the QR is damaged.</small></div>
      {lookup && <div className={`scan-result inventory-mobile-result ${lookup.outcome === 'ready' ? 'is-ready' : ''}`}><div><p className="eyebrow">{lookup.outcome === 'ready' ? 'Review before saving' : 'Scan result'}</p><h3>{lookup.outcome === 'ready' ? 'Confirm inventory check' : lookup.asset?.name || outcomeText[lookup.outcome] || lookup.message}</h3>{lookup.asset && <p className="sub">{lookup.asset.inventoryTag} · {lookup.asset.branch?.name} · {lookup.asset.location?.name || 'No location'} · {lookup.asset.status}</p>}<p className="sub">{lookup.outcome === 'ready' ? 'This asset will not be recorded until you confirm.' : lookup.message}</p></div><div className="scan-confirm-actions">{lookup.outcome === 'ready' && <button className="btn" type="button" onClick={cancelReview} disabled={manualBusy}>Cancel</button>}<button className="btn blue" type="button" onClick={lookup.outcome === 'ready' ? recordScan : cancelReview} disabled={manualBusy}>{manualBusy && lookup.outcome === 'ready' ? 'Saving…' : lookup.outcome === 'ready' ? 'Confirm & save check' : 'Scan another'}</button></div></div>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      {error && <p className="form-error inventory-scanner-error" role="alert">{error}</p>}
    </section>
    <section className="card inventory-unverified"><div className="section-heading"><div><p className="eyebrow">4 · Review · {progress?.session?.month || month}</p><h2>Inventory review</h2></div><span className="muted inventory-review-summary">{checked.length} checked · {unverified.length} remaining</span><div className="inventory-review-tabs" role="group" aria-label="Filter inventory review"><button className={reviewStatus === 'verified' ? 'active' : ''} type="button" aria-pressed={reviewStatus === 'verified'} onClick={() => setReviewStatus('verified')}>Verified <span>{checked.length}</span></button><button className={reviewStatus === 'unverified' ? 'active' : ''} type="button" aria-pressed={reviewStatus === 'unverified'} onClick={() => setReviewStatus('unverified')}>Unverified <span>{unverified.length}</span></button></div></div><div className="inventory-review-grid" data-active={reviewStatus}><div><h3>Verified assets</h3>{!checked.length ? <p className="muted">No assets verified yet.</p> : <div className="inventory-asset-list">{checked.map((asset) => <div key={asset._id}><span><b>{asset.inventoryTag}</b><small>{asset.name} · {asset.location?.name || 'No location'}</small><small className="inventory-verified-meta">{asset.checkedAt ? new Date(asset.checkedAt).toLocaleString('en-PH') : 'Verification time unavailable'} · {asset.checkedBy || 'User unavailable'}</small></span><em className="inventory-checked">Verified</em></div>)}</div>}</div><div><h3>Unverified assets</h3>{!unverified.length ? <p className="inventory-complete">All assets verified.</p> : <div className="inventory-asset-list">{unverified.map((asset) => <div key={asset._id}><span><b>{asset.inventoryTag}</b><small>{asset.name} · {asset.location?.name || 'No location'}</small></span><em>{asset.status}</em></div>)}</div>}</div></div>{flagged.length > 0 && <div className="inventory-flagged"><h3>Flagged scans</h3>{flagged.slice(0, 5).map((scan) => <p key={scan._id}><b>{scan.outcome}</b> · {scan.code}</p>)}</div>}</section>
    </>}
    {!sessionId && <div className="card inventory-empty"><Empty title="Start an inventory session" text="Select a branch and month, then start or continue a session to begin scanning." /></div>}
    {findDrawerOpen && <DrawerPortal><div className="inventory-find-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && cancelReview()}><aside className="inventory-find-drawer" role="dialog" aria-modal="true" aria-labelledby="inventory-find-title"><header className="inventory-find-header"><div><p className="eyebrow">Monthly inventory</p><h2 id="inventory-find-title">Find asset</h2><p className="sub">Enter a QR URL, token, or inventory tag to look up an asset.</p></div><button className="modal-close" type="button" onClick={cancelReview} aria-label="Close asset finder">×</button></header><form className="inventory-find-form" onSubmit={(event) => { event.preventDefault(); lookupCode(); }}><label htmlFor="inventory-desktop-code">QR code or inventory tag</label><input id="inventory-desktop-code" autoFocus value={code} onChange={(event) => { setCode(event.target.value); setLookup(null); }} placeholder="Paste QR URL, token, or inventory tag" /><button className="btn blue" type="submit" disabled={manualBusy || !code.trim()}>{manualBusy ? 'Finding…' : 'Find asset'}</button></form>{lookup && <div className={`inventory-find-result ${lookup.outcome === 'ready' ? 'is-ready' : ''}`}><p className="eyebrow">{lookup.outcome === 'ready' ? 'Review before saving' : 'Search result'}</p><h3>{lookup.outcome === 'ready' ? 'Confirm inventory check' : lookup.asset?.name || outcomeText[lookup.outcome] || lookup.message}</h3>{lookup.asset && <p className="sub">{lookup.asset.inventoryTag} · {lookup.asset.branch?.name} · {lookup.asset.location?.name || 'No location'} · {lookup.asset.status}</p>}<p className="sub">{lookup.outcome === 'ready' ? 'This asset will not be recorded until you confirm.' : lookup.message}</p>{lookup.outcome === 'ready' && <div className="inventory-find-actions"><button className="btn" type="button" onClick={cancelReview} disabled={manualBusy}>Cancel</button><button className="btn blue" type="button" onClick={recordScan} disabled={manualBusy}>{manualBusy ? 'Saving…' : 'Confirm & save check'}</button></div>}</div>}{error && <p className="form-error" role="alert">{error}</p>}</aside></div></DrawerPortal>}
  </div>;
}
