import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import useRealtimeRefresh from '../lib/useRealtimeRefresh';
import { getManilaMonth } from '../lib/date';

const monthNow = () => getManilaMonth();

export default function ScanOverlay({ onClose }) {
  const { meta, user } = useAuth();
  const [branch, setBranch] = useState(user.branch || '');
  const [sessionId, setSessionId] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const scannerRef = useRef(null);
  const lookupRef = useRef(null);

  const stopCamera = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  const loadProgress = async (id) => {
    const data = await api(`/inventory/sessions/${id}`);
    setProgress(data);
  };
  useRealtimeRefresh(() => (
    sessionId ? loadProgress(sessionId).catch((e) => setError(e.message)) : undefined
  ), Boolean(sessionId));

  const ensureSession = async (branchId) => {
    const session = await api('/inventory/sessions', { method: 'POST', body: { branch: branchId, month: monthNow() } });
    setBranch(branchId);
    setSessionId(session._id);
    await loadProgress(session._id);
    return session;
  };

  const lookup = async (value) => {
    const scannedCode = value.trim();
    if (!scannedCode) return;
    setCode(scannedCode);
    setResult(null);
    setBusy(true); setError(''); setMessage('');
    try {
      const { asset } = await api('/assets/resolve-qr', { method: 'POST', body: { code: scannedCode } });
      if (!asset) {
        setResult({ outcome: 'not-found', message: 'No asset matches this QR code.' });
        return;
      }
      const session = await ensureSession(asset.branch._id);
      const data = await api(`/inventory/sessions/${session._id}/lookup`, { method: 'POST', body: { code: asset.inventoryTag } });
      setCode(asset.inventoryTag);
      setResult(data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  lookupRef.current = lookup;

  const startCamera = async () => {
    if (cameraStarting || cameraOn) return;
    setCameraError('');
    setCameraStarting(true);
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setCameraError('Camera access requires HTTPS. Use manual entry below.');
      setCameraStarting(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser cannot access the camera. Use manual entry below.');
      setCameraStarting(false);
      return;
    }
    try {
      if (!videoRef.current) throw new Error('Scanner video is not ready');
      const scanner = new QrScanner(videoRef.current, (result) => {
        const value = typeof result === 'string' ? result : result.data;
        stopCamera();
        lookupRef.current?.(value);
      }, { preferredCamera: 'environment', returnDetailedScanResult: true });
      scannerRef.current = scanner;
      await scanner.start();
      await videoRef.current.play();
      setCameraOn(true);
    } catch (e) {
      stopCamera();
      setCameraError(e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow access in your browser settings, then tap Try camera again.'
        : 'Camera could not start. Confirm this page is opened with HTTPS, then try again or use manual entry.');
    } finally {
      setCameraStarting(false);
    }
  };

  const confirm = async () => {
    if (!result || result.outcome !== 'ready') return;
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await api(`/inventory/sessions/${sessionId}/scan`, { method: 'POST', body: { code, confirmed: true } });
      setMessage(saved.verified ? 'Asset verified and recorded.' : 'This scan was recorded for review.');
      setResult(null); setCode('');
      await loadProgress(sessionId);
      await startCamera();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const cancelReview = () => {
    setResult(null);
    setCode('');
    startCamera();
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraOn]);

  const selectedBranch = meta.branches.find((item) => item._id === branch);
  const checked = progress?.checkedAssets || 0;
  const total = progress?.totalAssets || 0;
  const checkedAssets = progress?.assets?.filter((asset) => asset.checked) || [];
  const unverifiedAssets = progress?.assets?.filter((asset) => !asset.checked) || [];

  return <div className="scan-overlay" role="dialog" aria-modal="true" aria-labelledby="scan-overlay-title">
    <div className="scan-overlay-panel">
      <header className="scan-overlay-header"><div><p className="eyebrow">Physical inventory · {monthNow()}</p><h2 id="scan-overlay-title">Scan asset QR</h2><p className="sub">{selectedBranch?.name || 'Branch will be detected from the scanned asset'} · {checked}/{total} checked</p></div><button className="modal-close" type="button" onClick={() => { stopCamera(); onClose(); }} aria-label="Close scanner">×</button></header>
      <div className={`scan-camera ${cameraOn ? 'is-active' : ''}`}><video className={cameraOn ? '' : 'scan-video-hidden'} ref={videoRef} autoPlay muted playsInline />{cameraOn ? <><div className="scanner-frame" aria-hidden="true" /><p>Point the camera at an asset QR code</p></> : <div className="scan-camera-placeholder"><span aria-hidden="true">⌖</span><b>{cameraStarting ? 'Starting camera…' : 'Camera is ready to start'}</b><small>{cameraStarting ? 'Allow camera permission when prompted.' : 'Tap below to allow camera access.'}</small>{!cameraStarting && <button className="btn blue" type="button" onClick={startCamera}>Open camera</button>}</div>}</div>
      {cameraError && <div className="scanner-error"><p className="form-error" role="alert">{cameraError}</p><button className="btn" type="button" onClick={startCamera}>Try camera again</button></div>}
      <div className="scan-manual"><label htmlFor="overlay-code">Manual code entry</label><div><input id="overlay-code" value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && lookup(code)} placeholder="QR URL, token, or inventory tag" /><button className="btn" type="button" onClick={() => lookup(code)} disabled={busy || !code.trim()}>Find</button></div></div>
      {result && <div className={`scan-confirm ${result.outcome === 'ready' ? 'ready' : ''}`} role="status"><div><p className="eyebrow">{result.outcome === 'ready' ? 'Review before saving' : 'Scan result'}</p><b>{result.outcome === 'ready' ? 'Confirm inventory check' : result.asset?.name || result.message}</b><small>{result.asset ? `${result.asset.inventoryTag} · ${result.asset.branch?.name} · ${result.asset.location?.name || 'No location'} · ${result.asset.status}` : result.message}</small>{result.outcome === 'ready' && <small>This asset will not be recorded until you confirm.</small>}</div><div className="scan-confirm-actions">{result.outcome === 'ready' && <button className="btn" type="button" onClick={cancelReview} disabled={busy}>Cancel</button>}<button className="btn blue" type="button" onClick={result.outcome === 'ready' ? confirm : cancelReview} disabled={busy}>{busy && result.outcome === 'ready' ? 'Saving…' : result.outcome === 'ready' ? 'Confirm & save check' : 'Scan another'}</button></div></div>}
      {message && <p className="form-success" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="card inventory-unverified scan-overlay-review">
        <div className="section-heading"><div><p className="eyebrow">Review</p><h2>Inventory review</h2></div><span className="muted">{checked} checked · {unverifiedAssets.length} remaining</span></div>
        <div className="inventory-review-grid">
          <div><h3>Checked assets</h3>{!checkedAssets.length ? <p className="muted">No assets verified yet.</p> : <div className="inventory-asset-list">{checkedAssets.map((asset) => <div key={asset._id}><span><b>{asset.inventoryTag}</b><small>{asset.name} · {asset.location?.name || 'No location'}</small><small className="inventory-verified-meta">{asset.checkedAt ? new Date(asset.checkedAt).toLocaleString('en-PH') : 'Verification time unavailable'} · {asset.checkedBy || 'User unavailable'}</small></span><em className="inventory-checked">Checked</em></div>)}</div>}</div>
          <div><h3>Still unverified</h3>{!unverifiedAssets.length ? <p className="inventory-complete">All assets verified.</p> : <div className="inventory-asset-list">{unverifiedAssets.map((asset) => <div key={asset._id}><span><b>{asset.inventoryTag}</b><small>{asset.name} · {asset.location?.name || 'No location'}</small></span><em>{asset.status}</em></div>)}</div>}</div>
        </div>
      </section>
    </div>
  </div>;
}
