import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { capturePhoto } from '../lib/assetPhoto';

export default function MobileAssetScanner({ onClose, onReview }) {
  const navigate = useNavigate();
  const dialogRef = useRef(null);
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const closedRef = useRef(false);
  const retakeRef = useRef(false);
  const lookupBusyRef = useRef(false);
  const lastCodeRef = useRef('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const stopCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    videoRef.current?.srcObject?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setTorchOn(false);
  };

  const closeScanner = () => {
    closedRef.current = true;
    stopCamera();
    if (dialogRef.current?.open) dialogRef.current.close();
    onClose();
  };

  useEffect(() => {
    closedRef.current = false;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      closedRef.current = true;
      stopCamera();
      if (dialog?.open) dialog.close();
    };
  }, []);

  const resolveCode = async (code) => {
    if (!code || lookupBusyRef.current || lastCodeRef.current === code) return;
    lookupBusyRef.current = true;
    lastCodeRef.current = code;
    try {
      const { asset } = await api('/assets/resolve-qr', { method: 'POST', body: { code } });
      if (closedRef.current) return;
      if (asset) {
        closeScanner();
        navigate(`/a/${asset.qrToken}`);
      } else {
        setNotice(`No registered asset matches “${code}”. Capture a photo to start a new registration.`);
      }
    } catch (e) {
      setError(e.message);
      lastCodeRef.current = '';
    } finally {
      lookupBusyRef.current = false;
    }
  };

  const startCamera = async () => {
    if (cameraStarting || cameraOn) return;
    setCameraStarting(true);
    setError('');
    setNotice('');
    setTorchAvailable(false);
    lastCodeRef.current = '';
    if (!window.isSecureContext && window.location.hostname !== 'localhost') {
      setError('Camera access requires HTTPS. Use manual registration below.');
      setCameraStarting(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot access the camera. Use manual registration below.');
      setCameraStarting(false);
      return;
    }
    try {
      if (!videoRef.current) throw new Error('Camera preview is not ready.');
      const { BarcodeFormat, BrowserMultiFormatReader } = await import('@zxing/browser');
      if (closedRef.current) return;
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 250, delayBetweenScanSuccess: 700 });
      reader.possibleFormats = [
        BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.AZTEC, BarcodeFormat.PDF_417,
        BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.CODE_128, BarcodeFormat.CODABAR,
        BarcodeFormat.EAN_8, BarcodeFormat.EAN_13, BarcodeFormat.ITF, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
      ];
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        videoRef.current,
        (result) => { if (result) resolveCode(result.getText()); },
      );
      if (closedRef.current) {
        controls.stop();
        return;
      }
      controlsRef.current = controls;
      setTorchAvailable(Boolean(controls.switchTorch));
      setCameraOn(true);
    } catch (e) {
      stopCamera();
      setError(e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in browser settings, then try again.'
        : 'Camera could not start. Check camera access and HTTPS, then try again.');
    } finally {
      setCameraStarting(false);
    }
  };

  const toggleTorch = async () => {
    if (!controlsRef.current?.switchTorch) return;
    try {
      const next = !torchOn;
      await controlsRef.current.switchTorch(next);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
      setTorchOn(false);
      setError('Flashlight control is not available on this camera.');
    }
  };

  useEffect(() => {
    if (!photoUrl && retakeRef.current) {
      retakeRef.current = false;
      startCamera();
    }
  }, [photoUrl]);

  const capture = async () => {
    try {
      const image = await capturePhoto(videoRef.current);
      stopCamera();
      setPhotoUrl(image);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  const analyze = async () => {
    if (!photoUrl || processing) return;
    setProcessing(true);
    setError('');
    try {
      const extracted = await api('/assets/analyze', { method: 'POST', body: { image: photoUrl } });
      if (closedRef.current) return;
      onReview({ ...extracted, condition: extracted.condition || '', photoUrl, quantity: 1 });
      closeScanner();
    } catch (e) {
      setError(e.message);
    } finally {
      setProcessing(false);
    }
  };

  const continueManually = () => {
    onReview(photoUrl ? { name: '', category: '', brand: '', modelNo: '', serialNo: '', description: '', assetType: '', condition: '', photoUrl, quantity: 1 } : null);
    closeScanner();
  };

  return (
    <dialog ref={dialogRef} className="mobile-asset-scanner" aria-labelledby="mobile-scan-title" onCancel={(event) => { event.preventDefault(); closeScanner(); }}>
      <header className="mobile-asset-scanner-header">
        <button className="btn scanner-cancel" type="button" onClick={closeScanner}>Cancel</button>
        <div><p className="eyebrow">Asset registration</p><h2 id="mobile-scan-title">Scan Asset</h2></div>
        <span className="scanner-spacer" aria-hidden="true" />
      </header>

      {!photoUrl ? <>
        <div className={`mobile-scan-view ${cameraOn ? 'camera-on' : ''}`}>
          <video ref={videoRef} className="mobile-scan-video" autoPlay muted playsInline aria-label="Camera preview for scanning an asset" />
          {cameraOn && <div className="mobile-scan-frame" aria-hidden="true"><i /><i /><i /><i /></div>}
          {!cameraOn && <div className="mobile-scan-intro"><span className="camera-lens-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-1-3Z"/><circle cx="12" cy="13" r="3.5"/></svg></span><p>Point the camera at the asset or its label.</p></div>}
          {notice && <p className="mobile-scan-notice" role="status">{notice}</p>}
        </div>
        <p className="mobile-scan-privacy">Camera access is used to capture the asset. Photos are sent to OpenAI for suggestions and saved only if you register.</p>
        {error && <p className="mobile-scan-error" role="alert">{error}</p>}
        <footer className="mobile-scan-controls">
          {cameraOn ? <>
            <button className="btn scanner-control scanner-flash" type="button" disabled={!torchAvailable} onClick={toggleTorch} aria-label={torchOn ? 'Turn flashlight off' : torchAvailable ? 'Turn flashlight on' : 'Flashlight unavailable'}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" /></svg>
              <span>{torchAvailable ? torchOn ? 'Flashlight on' : 'Flashlight' : 'No flash'}</span>
            </button>
            <button className="btn blue scanner-capture" type="button" onClick={capture} aria-label="Capture asset photo">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h-4L8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-1-3Z"/><circle cx="12" cy="13" r="3.5"/></svg>
              <span>Capture</span>
            </button>
            <button className="btn scanner-control scanner-manual" type="button" aria-label="Enter manual registration" onClick={() => { stopCamera(); continueManually(); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H4zM8 20h8M12 16v4M7 9h4M7 12h2M14 9h3M14 12h3" /></svg>
              <span>Manual</span>
            </button>
          </> : <>
            <button className="btn blue scanner-start" type="button" disabled={cameraStarting} onClick={startCamera}>{cameraStarting ? 'Starting camera…' : 'Start camera'}</button>
            <button className="btn scanner-control scanner-manual scanner-manual-start" type="button" onClick={() => { stopCamera(); continueManually(); }}>Manual registration</button>
          </>}
        </footer>
      </> : <>
        <div className="mobile-scan-review"><img src={photoUrl} alt="Captured asset to review before registration" /><p>Review this photo, then analyze it or continue with manual entry.</p></div>
        {error && <p className="mobile-scan-error" role="alert">{error}</p>}
        <footer className="mobile-scan-controls">
          <button className="btn scanner-control" type="button" disabled={processing} onClick={() => { retakeRef.current = true; setPhotoUrl(''); setError(''); }}>Retake</button>
          <button className="btn blue scanner-capture" type="button" disabled={processing} onClick={analyze}>{processing ? 'Analyzing photo…' : 'Analyze photo'}</button>
          <button className="btn scanner-control scanner-manual" type="button" disabled={processing} aria-label="Enter manual registration" onClick={continueManually}>Manual</button>
        </footer>
      </>}
      {processing && <div className="mobile-scan-processing" role="status" aria-live="polite"><span className="scanner-spinner" aria-hidden="true" />Analyzing photo…</div>}
    </dialog>
  );
}
