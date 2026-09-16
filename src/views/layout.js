import { escapeHtml } from './utils.js';

export function renderLayout({ title, user = null, content, scripts = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} | Payments Slice</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #151e2e;
      --card-border: #243048;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #38bdf8;
      --primary-hover: #0284c7;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --danger-hover: #dc2626;
      --focus-ring: #38bdf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background-color: var(--card-bg);
      border-bottom: 1px solid var(--card-border);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand { font-size: 1.15rem; font-weight: 700; color: #fff; text-decoration: none; }
    .nav-links { display: flex; gap: 1.5rem; align-items: center; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.925rem; }
    .nav-links a:hover { color: var(--text); }
    main { flex: 1; max-width: 900px; width: 100%; margin: 2rem auto; padding: 0 1.5rem; }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    p.subtitle { color: var(--text-muted); margin-bottom: 1.5rem; }
    .btn {
      display: inline-block;
      padding: 0.75rem 1.25rem;
      background-color: var(--primary);
      color: #0b0f19;
      font-weight: 600;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      text-decoration: none;
      font-size: 0.95rem;
      transition: background 0.15s;
    }
    .btn:hover:not(:disabled) { background-color: var(--primary-hover); color: #fff; }
    .btn-danger { background-color: var(--danger); color: #fff; }
    .btn-danger:hover:not(:disabled) { background-color: var(--danger-hover); }
    .btn-secondary { background-color: transparent; border: 1px solid var(--card-border); color: var(--text); }
    .btn-secondary:hover { background-color: rgba(255,255,255,0.05); }
    button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-active { background-color: rgba(16, 185, 129, 0.2); color: var(--success); border: 1px solid var(--success); }
    .badge-canceled { background-color: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); }
    .badge-free { background-color: rgba(148, 163, 184, 0.2); color: var(--text-muted); border: 1px solid var(--card-border); }
    .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; margin-top: 1.5rem; }
    .pricing-card {
      background: #0f172a;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.75rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .pricing-card.featured { border-color: var(--primary); box-shadow: 0 0 20px rgba(56, 189, 248, 0.15); }
    .price-amount { font-size: 2.25rem; font-weight: 800; color: #fff; margin: 0.75rem 0; }
    .price-period { font-size: 0.9rem; color: var(--text-muted); font-weight: 400; }
    .alert { padding: 1rem; border-radius: 8px; margin-bottom: 1.25rem; }
    .alert-error { background: #450a0a; border: 1px solid #991b1b; color: #fca5a5; }
    .alert-success { background: #064e3b; border: 1px solid #059669; color: #6ee7b7; }
    .alert-warning { background: #451a03; border: 1px solid #92400e; color: #fcd34d; }
  </style>
</head>
<body>
  <header>
    <a href="/billing" class="brand">Bootcamp Billing Slice</a>
    ${user ? `
      <nav class="nav-links">
        <a href="/billing">Billing</a>
        <a href="/plans">Plans</a>
        <span style="font-size: 0.85rem; color: var(--text-muted);">Signed in as <strong>${escapeHtml(user.name)}</strong></span>
        <form method="POST" action="/api/auth/signout" style="display:inline;">
          <button type="submit" class="btn btn-secondary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;">Sign out</button>
        </form>
      </nav>
    ` : `
      <nav class="nav-links">
        <a href="/signin">Sign in</a>
        <a href="/signup">Sign up</a>
      </nav>
    `}
  </header>
  <main>
    ${content}
  </main>
  ${scripts}
</body>
</html>`;
}
