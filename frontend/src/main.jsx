import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// If the API rejects our stored token (expired, invalid, or the wrong role for
// this session), clear it and reload so the user lands on the login page instead
// of a dashboard that crashes on an error response.
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await originalFetch(...args);
  if ((res.status === 401 || res.status === 403) && localStorage.getItem('token')) {
    try {
      const body = await res.clone().json();
      if (/session expired|invalid token|token required|access denied/i.test(body.message || '')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.reload();
      }
    } catch (_) { /* not JSON; leave it to the caller */ }
  }
  return res;
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
