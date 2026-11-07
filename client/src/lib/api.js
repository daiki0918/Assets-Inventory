export const getToken = () => localStorage.getItem('token') || sessionStorage.getItem('token');

export const clearAuth = () => ['token', 'user'].forEach((key) => {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
});

export const api = async (path, opts = {}) => {
  const token = getToken();
  const response = await fetch('/api' + path, {
    ...opts,
    cache: opts.cache || 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...(opts.headers || {}) },
    body: opts.body && JSON.stringify(opts.body),
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { /* handled below */ } }
  if (!response.ok) {
    const error = new Error(data?.error || (response.status >= 500 ? 'The API server is not running.' : response.status === 401 ? 'Your sign-in has expired.' : response.status === 404 ? 'This admin feature is unavailable. Restart the API server and try again.' : `Request failed (${response.status}).`));
    error.status = response.status;
    throw error;
  }
  if (data === null) throw new Error('The server sent an incomplete response.');
  return data;
};

export const peso = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
