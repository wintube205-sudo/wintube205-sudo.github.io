// Admin Panel HTML page
import { Hono } from 'hono';
import type { HonoEnv } from '../lib/types';

const adminPanel = new Hono<HonoEnv>();

adminPanel.get('/', (c) => {
  return c.html(getAdminHTML());
});

function getAdminHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WinTube Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh}
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-card{background:#111;border:1px solid #222;border-radius:16px;padding:32px;width:320px}
.login-card h2{font-size:1.3rem;font-weight:800;margin-bottom:20px;color:#fff;text-align:center}
input{width:100%;background:#1a1a1a;border:1px solid #333;color:#fff;padding:10px 14px;border-radius:8px;font-size:.9rem;outline:none;margin-bottom:12px}
input:focus{border-color:#ef4444}
button{width:100%;background:#ef4444;border:none;color:#fff;padding:11px;border-radius:8px;font-size:.9rem;font-weight:700;cursor:pointer}
button:hover{opacity:.9}
.header{background:#111;border-bottom:1px solid #222;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:1.1rem;font-weight:800;color:#ef4444}
.header span{font-size:.8rem;color:#666}
.nav{display:flex;gap:4px;padding:16px 24px 0}
.nav-btn{padding:8px 16px;border:none;border-radius:8px 8px 0 0;cursor:pointer;font-size:.82rem;font-weight:600;background:#1a1a1a;color:#888}
.nav-btn.active{background:#222;color:#fff}
.content{padding:20px 24px}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.stat{background:#111;border:1px solid #222;border-radius:12px;padding:16px}
.stat-val{font-size:1.8rem;font-weight:900;color:#ef4444}
.stat-lbl{font-size:.72rem;color:#666;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;padding:10px 12px;color:#666;border-bottom:1px solid #222;font-weight:600}
td{padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#ccc}
tr:hover td{background:#111}
.badge{display:inline-block;padding:2px 8px;border-radius:50px;font-size:.68rem;font-weight:700}
.badge-pending{background:rgba(251,191,36,.15);color:#fbbf24}
.badge-approved{background:rgba(34,197,94,.15);color:#22c55e}
.badge-rejected{background:rgba(239,68,68,.15);color:#ef4444}
.action-btns{display:flex;gap:6px}
.btn-approve{background:#22c55e;color:#fff;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;font-weight:700}
.btn-reject{background:#ef4444;color:#fff;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;font-weight:700}
.btn-ban{background:#f59e0b;color:#fff;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;font-weight:700}
.note-inp{background:#1a1a1a;border:1px solid #333;color:#fff;padding:4px 8px;border-radius:6px;font-size:.75rem;width:120px}
.empty{text-align:center;color:#444;padding:40px;font-size:.9rem}
.tab-content{display:none}.tab-content.active{display:block}
</style>
</head>
<body>

<div id="loginWrap" class="login-wrap">
  <div class="login-card">
    <h2>🔐 WinTube Admin</h2>
    <input type="password" id="secretInp" placeholder="Admin secret..." onkeydown="if(event.key==='Enter')login()">
    <button onclick="login()">Enter Admin Panel</button>
    <div id="loginErr" style="color:#ef4444;font-size:.78rem;text-align:center;margin-top:8px"></div>
  </div>
</div>

<div id="adminWrap" style="display:none">
  <div class="header">
    <h1>⚡ WinTube Admin</h1>
    <span id="lastRefresh">Connecting...</span>
  </div>
  <div class="nav">
    <button class="nav-btn active" onclick="showTab('withdrawals')">💰 Withdrawals</button>
    <button class="nav-btn" onclick="showTab('users')">👥 Users</button>
    <button class="nav-btn" onclick="showTab('stats')">📊 Stats</button>
  </div>
  <div class="content">
    <div id="tab-withdrawals" class="tab-content active">
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn-approve" onclick="loadWithdrawals('pending')" style="padding:6px 14px;font-size:.8rem">Pending</button>
        <button class="btn-approve" onclick="loadWithdrawals('approved')" style="background:#3b82f6;padding:6px 14px;font-size:.8rem">Approved</button>
        <button class="btn-reject" onclick="loadWithdrawals('rejected')" style="padding:6px 14px;font-size:.8rem">Rejected</button>
      </div>
      <div id="withdrawalsTable"></div>
    </div>
    <div id="tab-users" class="tab-content">
      <div id="usersTable"></div>
    </div>
    <div id="tab-stats" class="tab-content">
      <div id="statsPanel"></div>
    </div>
  </div>
</div>

<script>
let _secret = '';
const API = '/api/admin';

async function adminFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'x-admin-secret': _secret, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  if (res.status === 401) { showLogin(); return null; }
  return res.json();
}

async function login() {
  const val = document.getElementById('secretInp').value.trim();
  if (!val) return;
  _secret = val;
  const data = await adminFetch('/stats');
  if (!data) { document.getElementById('loginErr').textContent = 'Wrong secret'; _secret = ''; return; }
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('adminWrap').style.display = 'block';
  loadWithdrawals('pending');
  loadStats();
  document.getElementById('lastRefresh').textContent = 'Logged in: ' + new Date().toLocaleTimeString();
}

function showLogin() {
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('adminWrap').style.display = 'none';
}

function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'users') loadUsers();
  if (name === 'stats') loadStats();
}

async function loadWithdrawals(status) {
  document.getElementById('withdrawalsTable').innerHTML = '<div class="empty">Loading...</div>';
  const data = await adminFetch('/withdrawals?status=' + status);
  if (!data) return;
  const rows = data.withdrawals;
  if (!rows.length) { document.getElementById('withdrawalsTable').innerHTML = '<div class="empty">No ' + status + ' withdrawals</div>'; return; }
  let html = '<table><thead><tr><th>ID</th><th>User</th><th>Email</th><th>Amount</th><th>USD</th><th>Method</th><th>Address</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>';
  rows.forEach(w => {
    html += \`<tr>
      <td>#\${w.id}</td>
      <td>\${esc(w.name)}</td>
      <td>\${esc(w.email)}</td>
      <td>\${w.amount.toLocaleString()} pts</td>
      <td>$\${w.usd_value}</td>
      <td>\${esc(w.method)}</td>
      <td style="max-width:140px;word-break:break-all">\${esc(w.address)}</td>
      <td><span class="badge badge-\${w.status}">\${w.status}</span></td>
      <td>\${w.created_at?.slice(0,16).replace('T',' ')}</td>
      <td>\${w.status==='pending' ? \`<div class="action-btns"><input class="note-inp" id="note_\${w.id}" placeholder="Note..."><button class="btn-approve" onclick="action(\${w.id},'approve')">✓ Approve</button><button class="btn-reject" onclick="action(\${w.id},'reject')">✕ Reject</button></div>\` : (w.admin_note || '—')}</td>
    </tr>\`;
  });
  html += '</tbody></table>';
  document.getElementById('withdrawalsTable').innerHTML = html;
}

async function action(id, act) {
  const note = document.getElementById('note_' + id)?.value || '';
  if (!confirm(act.toUpperCase() + ' withdrawal #' + id + '?')) return;
  const data = await adminFetch('/withdrawals/' + id + '/action', { method: 'POST', body: JSON.stringify({ action: act, note }) });
  if (data?.success) { alert('Done! Status: ' + data.status); loadWithdrawals('pending'); }
  else alert('Error: ' + (data?.error || 'Unknown'));
}

async function loadUsers() {
  document.getElementById('usersTable').innerHTML = '<div class="empty">Loading...</div>';
  const data = await adminFetch('/users');
  if (!data) return;
  const users = data.users;
  let html = '<table><thead><tr><th>Name</th><th>Email</th><th>Points</th><th>Provider</th><th>Joined</th><th>Actions</th></tr></thead><tbody>';
  users.forEach(u => {
    html += \`<tr>
      <td>\${esc(u.name)}</td>
      <td>\${esc(u.email)}</td>
      <td>\${u.points.toLocaleString()}</td>
      <td>\${u.auth_provider}</td>
      <td>\${u.created_at?.slice(0,10)}</td>
      <td><button class="btn-ban" onclick="toggleBan('\${u.uid}',\${u.is_banned?0:1})">\${u.is_banned?'Unban':'Ban'}</button></td>
    </tr>\`;
  });
  html += '</tbody></table>';
  document.getElementById('usersTable').innerHTML = html;
}

async function toggleBan(uid, ban) {
  if (!confirm((ban ? 'BAN' : 'UNBAN') + ' user ' + uid + '?')) return;
  const data = await adminFetch('/users/' + uid + '/ban', { method: 'POST', body: JSON.stringify({ ban: !!ban }) });
  if (data?.success) { loadUsers(); }
}

async function loadStats() {
  const data = await adminFetch('/stats');
  if (!data) return;
  document.getElementById('statsPanel').innerHTML = \`
    <div class="stats-row">
      <div class="stat"><div class="stat-val">\${data.users?.total||0}</div><div class="stat-lbl">Total Users</div></div>
      <div class="stat"><div class="stat-val">\${Number(data.users?.totalPts||0).toLocaleString()}</div><div class="stat-lbl">Total Points Held</div></div>
      <div class="stat"><div class="stat-val">\${data.withdrawals?.pending||0}</div><div class="stat-lbl">Pending Withdrawals</div></div>
      <div class="stat"><div class="stat-val">\${data.withdrawals?.total||0}</div><div class="stat-lbl">Total Withdrawals</div></div>
      <div class="stat"><div class="stat-val">\${Number(data.watchPoints?.total||0).toLocaleString()}</div><div class="stat-lbl">Watch Points Earned</div></div>
    </div>
  \`;
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
</script>
</body>
</html>`;
}

export default adminPanel;
