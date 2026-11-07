import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Login({ onDone }) {
  const [form, setForm] = useState({
    email: localStorage.getItem('remembered-email') || '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => localStorage.getItem('remember-account') === 'true');
  const [mode, setMode] = useState('login');
  const [recoveryStep, setRecoveryStep] = useState('verify');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [cooldownEmail, setCooldownEmail] = useState('');
  const [resetStatus, setResetStatus] = useState('idle');
  const [navigationAnimation, setNavigationAnimation] = useState('entering');

  useEffect(() => {
    if (!resendSeconds) return undefined;
    const timer = setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);
  const normalizedEmail = form.email.trim().toLowerCase();
  const isEmailCooldown = resendSeconds > 0 && normalizedEmail === cooldownEmail;

  useEffect(() => {
    if (resetStatus !== 'success') return undefined;
    const timer = setTimeout(() => {
      setMode('login');
      setCode('');
      setResetToken('');
      setNewPassword('');
      setConfirmPassword('');
      setRecoveryStep('verify');
      setForm((current) => ({ ...current, password: '' }));
      setMessage('Password updated. You can now sign in.');
      setResetStatus('idle');
    }, 1700);
    return () => clearTimeout(timer);
  }, [resetStatus]);
  useEffect(() => {
    if (navigationAnimation === 'idle') return undefined;
    const timer = setTimeout(() => {
      if (navigationAnimation === 'returning') {
        setMode('login');
        setError('');
        setMessage('');
        setResetStatus('idle');
        setResetToken('');
        setCode('');
        setNewPassword('');
        setConfirmPassword('');
        setRecoveryStep('verify');
        setNavigationAnimation('entering');
      } else {
        setNavigationAnimation('idle');
      }
    }, navigationAnimation === 'returning' ? 220 : 1050);
    return () => clearTimeout(timer);
  }, [navigationAnimation]);

  const updateEmail = (event) => setForm((current) => ({ ...current, email: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api('/auth/login', { method: 'POST', body: form });
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem('token', result.token);
      storage.setItem('user', JSON.stringify(result.user));
      localStorage.setItem('remember-account', String(remember));
      if (remember) localStorage.setItem('remembered-email', form.email);
      else localStorage.removeItem('remembered-email');
      onDone(result.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const requestCode = async (event) => {
    event.preventDefault();
    if (busy || isEmailCooldown) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: form.email },
      });
      setMessage(result.message);
      setCooldownEmail(normalizedEmail);
      setResendSeconds(60);
      setRecoveryStep('verify');
      setResetToken('');
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      setMode('reset');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    setResetStatus('verifying');
    try {
      const result = await api('/auth/verify-reset-code', {
        method: 'POST',
        body: { email: form.email, code },
      });
      setResetToken(result.resetToken);
      setRecoveryStep('password');
      setResetStatus('idle');
    } catch (e) {
      setResetStatus('idle');
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setResetStatus('verifying');
    try {
      const result = await api('/auth/reset-password', {
        method: 'POST',
        body: { email: form.email, resetToken, password: newPassword },
      });
      setMessage(result.message);
      setResetStatus('success');
    } catch (e) {
      setResetStatus('idle');
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = () => {
    if (busy || navigationAnimation !== 'idle') return;
    setNavigationAnimation('returning');
  };

  const isRecovery = mode !== 'login';
  const recoveryFormClass = isRecovery
    ? `login-reset-form${mode === 'reset' && recoveryStep === 'password' ? ' login-reset-form--password' : ''}${navigationAnimation === 'returning' ? ' login-reset-form--leaving' : ''}`
    : '';

  return (
    <div className={`login${isRecovery ? ' login-recovery' : ''}${navigationAnimation === 'entering' ? ' login-entering' : ''}`}>
      <div className="art">
        <img src="/logo-white.png" alt="Cosmopolitan Funeral Homes" />
        <div>
          <p className="eyebrow">FIXED ASSET INVENTORY</p>
          <h1>Every asset.<br />Every branch.<br />One record.</h1>
          <p className="art-copy">A calm, dependable workspace for keeping every location, value, and history in sync.</p>
        </div>
        <div className="login-benefits">
          <span><b>01</b> QR-ready records</span>
          <span><b>02</b> Branch-level visibility</span>
          <span><b>03</b> Audit-friendly history</span>
        </div>
      </div>

      <form key={isRecovery ? `${mode}-${recoveryStep}` : mode} className={recoveryFormClass} onSubmit={mode === 'login' ? submit : mode === 'request' ? requestCode : recoveryStep === 'verify' ? verifyCode : resetPassword}>
        {mode === 'login' && <div className="login-mark"><span>CF</span><small>Staff workspace</small></div>}
        {mode === 'login' && (
          <>
            <p className="eyebrow">WELCOME BACK</p>
            <h2>Sign in</h2>
            <p className="sub">Use your staff account to access the asset register.</p>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="username" value={form.email} onChange={updateEmail} />
            <label htmlFor="password">Password</label>
            <div className="login-password-field">
              <input id="password" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
              <button
                className="login-password-toggle"
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword
                  ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.8 4.5 9.8 6-.4.7-1.5 2.2-3.1 3.5M6.2 6.2C3.9 7.6 2.6 9.6 2.2 11c1 1.5 4.6 6 9.8 6 1 0 2-.2 2.9-.5" /></svg>
                  : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.2 12s3.6-6 9.8-6 9.8 6 9.8 6-3.6 6-9.8 6-9.8-6-9.8-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>}
              </button>
            </div>
            <div className="login-options">
              <label className="remember-check">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>Remember me</span>
              </label>
              <button className="text-button" type="button" onClick={() => { setMode('request'); setError(''); setMessage(''); }}>
                Forgot password?
              </button>
            </div>
          </>
        )}

        {mode === 'request' && (
          <>
            <div className="otp-heading-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z" /><path d="M12 14v3" /></svg>
            </div>
            <p className="eyebrow">ACCOUNT RECOVERY</p>
            <h2>Forgot password?</h2>
            <p className="sub">Enter your registered email and we’ll send a six-digit verification code.</p>
            <label htmlFor="recovery-email">Email</label>
            <input id="recovery-email" type="email" required autoComplete="email" value={form.email} disabled={busy} onChange={updateEmail} />
          </>
        )}

        {mode === 'reset' && (
          <>
            {resetStatus === 'success' ? (
              <div className="otp-success" role="status" aria-live="polite">
                <span className="otp-success-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-8" /></svg>
                </span>
                <p className="eyebrow">PASSWORD RESET</p>
                <h2>Password updated</h2>
                <p className="sub">Your account is secure. Returning to sign in…</p>
                <span className="otp-success-badge">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.9 8-7 10-4.1-2-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
                  Verified &amp; secured
                </span>
              </div>
            ) : (
              <>
                <div className="otp-heading-mark" aria-hidden="true">
                  {recoveryStep === 'verify'
                    ? <svg viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z" /><path d="M12 14v3" /></svg>
                    : <svg viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 4.5-2.9 8-7 10-4.1-2-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>}
                </div>
                <p className="eyebrow">{recoveryStep === 'verify' ? 'SECURE ACCOUNT RECOVERY' : 'OTP VERIFIED'}</p>
                <h2>{recoveryStep === 'verify' ? <>Verify <span>OTP</span></> : 'Set new password'}</h2>
                <p className="sub">{recoveryStep === 'verify'
                  ? <>Enter the six-digit code sent to <b>{form.email}</b>.</>
                  : 'Your email is verified. Choose a new password to secure your account.'}</p>
                {recoveryStep === 'verify' ? (
                  <>
                    <label className="otp-code-label" htmlFor="reset-code">VERIFICATION CODE</label>
                    <div className={`otp-code-boxes${resetStatus === 'verifying' ? ' is-verifying' : ''}`} data-filled={code.length}>
                      {Array.from({ length: 6 }, (_, index) => (
                        <span className="otp-code-box" key={index} aria-hidden="true">{code[index] || ''}</span>
                      ))}
                      <input
                        id="reset-code"
                        className="otp-code-input"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength="6"
                        required
                        autoComplete="one-time-code"
                        aria-label="Six-digit verification code"
                        value={code}
                        disabled={busy}
                        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      />
                    </div>
                    <p className="otp-expiry">Code expires in 10 minutes</p>
                  </>
                ) : (
                  <div className="otp-verified-banner" role="status">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
                    Email verified successfully
                  </div>
                )}
                {recoveryStep === 'password' && <div className="otp-password-fields">
                  <label htmlFor="new-password">New password</label>
                  <input id="new-password" type="password" minLength="8" required autoComplete="new-password" value={newPassword} disabled={busy} onChange={(event) => setNewPassword(event.target.value)} />
                  <label htmlFor="confirm-password">Confirm new password</label>
                  <input id="confirm-password" type="password" minLength="8" required autoComplete="new-password" value={confirmPassword} disabled={busy} onChange={(event) => setConfirmPassword(event.target.value)} />
                </div>}
              </>
            )}
          </>
        )}

        {error && <p className="err login-feedback" role="alert">{error}</p>}
        {message && <p className="login-message" role="status">{message}</p>}
        {resetStatus !== 'success' && (
          <>
            <button className={`btn ${isRecovery ? 'otp-submit' : 'blue'} block`} disabled={busy || (mode === 'request' && isEmailCooldown)} aria-busy={busy}>
              {busy ? mode === 'request' ? 'Sending code…' : mode === 'reset' ? recoveryStep === 'verify' ? 'Verifying code…' : 'Updating password…' : 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'request' ? isEmailCooldown ? `Try again in 0:${String(resendSeconds).padStart(2, '0')}` : 'Send verification code' : recoveryStep === 'verify' ? 'Verify OTP' : 'Update password'}
            </button>
            {mode === 'reset' && recoveryStep === 'verify' && (
              <button className="text-button login-resend" type="button" disabled={busy || isEmailCooldown} onClick={requestCode}>
                {isEmailCooldown ? `Resend code in 0:${String(resendSeconds).padStart(2, '0')}` : 'Send a new code'}
              </button>
            )}
            {mode !== 'login' && (
              <button className="text-button login-back" type="button" disabled={busy || navigationAnimation !== 'idle'} onClick={backToLogin}>
                Back to sign in
              </button>
            )}
            {mode === 'login' && <p className="login-note">Protected staff access · Cosmopolitan Funeral Homes</p>}
          </>
        )}
      </form>
    </div>
  );
}
