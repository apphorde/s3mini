export const CONTROL_PLANE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>S3MINI Control Plane - Object storage</title>
  <script type="importmap">{"imports":{"@li3/":"https://cdn.li3.dev/@li3/"}}</script>
  <link rel="stylesheet" href="/admin/tailwind.css">
  <script type="module">import '@li3/web';</script>
  <template component="dashboard-status">
    <p class="notice">{{ message }}</p>
    <script setup>
      import { defineProp } from '@li3/web';
      export default function () { const message = defineProp('message', { default: '' }); return { message }; }
    </script>
  </template>
  <style>
    :root { font-family: ui-sans-serif, system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    .shell { min-height: 100vh; background: #f8fafc; }
    .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 2; display: none; width: 256px; border-right: 1px solid #e2e8f0; background: white; }
    .sidebar.mobile-open { display: block; box-shadow: 12px 0 30px #0f172a1f; }
    .brand { display: flex; height: 64px; align-items: center; gap: 12px; padding: 0 24px; border-bottom: 1px solid #e2e8f0; }
    .sidebar-close { display: none; margin-left: auto; border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 20px; }
    .mark { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 9px; background: #2563eb; color: white; font-weight: 700; }
    .brand strong { display: block; font-size: 14px; letter-spacing: -.02em; }
    .brand small { display: block; margin-top: 2px; color: #64748b; font-size: 11px; }
    .nav { padding: 20px 12px; }
    .nav-label { padding: 0 12px 8px; color: #94a3b8; font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
    .nav button, .footer button { display: flex; width: 100%; align-items: center; gap: 10px; padding: 10px 12px; border: 0; border-radius: 8px; background: transparent; color: #64748b; cursor: pointer; text-align: left; font-size: 13px; }
    .nav button:hover, .nav button.active, .footer button:hover { background: #eff6ff; color: #1d4ed8; }
    .footer { position: absolute; right: 12px; bottom: 12px; left: 12px; }
    .user-card { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; padding: 10px; border-radius: 8px; background: #f8fafc; }
    .user-card strong, .user-card small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-card strong { color: #334155; font-size: 12px; }
    .user-card small { max-width: 175px; margin-top: 2px; color: #64748b; font-size: 10px; }
    .health { margin: 0 0 10px; padding: 12px; border-radius: 8px; background: #f8fafc; color: #475569; font-size: 12px; }
    .dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: #10b981; }
    .main { min-width: 0; }
    .topbar { display: flex; height: 64px; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid #e2e8f0; background: white; }
    .menu { display: inline-grid; width: 34px; height: 34px; margin-right: 8px; place-items: center; border: 1px solid #e2e8f0; border-radius: 7px; background: white; color: #334155; cursor: pointer; }
    .workspace { color: #64748b; font-size: 13px; }
    .profile { display: flex; align-items: center; gap: 9px; border-left: 1px solid #e2e8f0; padding-left: 12px; color: #334155; font-size: 12px; }
    .token { width: 150px; height: 30px; padding: 0 8px; border: 1px solid #e2e8f0; border-radius: 7px; outline: 0; font-size: 11px; }
    .avatar { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 50%; background: #0f172a; color: white; font-size: 11px; font-weight: 700; }
    .content { width: min(1500px, 100%); margin: 0 auto; padding: 28px 20px 48px; }
    .heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 28px; }
    .eyebrow { margin: 0 0 5px; color: #2563eb; font-size: 12px; font-weight: 700; }
    h1 { margin: 0; font-size: 26px; letter-spacing: -.04em; }
    h2 { margin: 0; font-size: 14px; }
    .muted { margin: 6px 0 0; color: #64748b; font-size: 12px; }
    .actions { display: flex; gap: 8px; }
    button, input, textarea { font: inherit; }
    .button { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 13px; border: 1px solid #e2e8f0; border-radius: 8px; background: white; color: #334155; cursor: pointer; font-size: 12px; font-weight: 600; }
    .button:hover { border-color: #93c5fd; }
    .primary { border-color: #2563eb; background: #2563eb; color: white; box-shadow: 0 4px 12px #bfdbfe; }
    .danger { color: #dc2626; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
    .card, .panel { border: 1px solid #e2e8f0; border-radius: 12px; background: white; box-shadow: 0 4px 12px #e2e8f033; }
    .card { padding: 18px; }
    .card-label { color: #64748b; font-size: 12px; font-weight: 600; }
    .metric { margin-top: 8px; font-size: 26px; font-weight: 700; letter-spacing: -.04em; }
    .card-note { margin-top: 10px; color: #64748b; font-size: 11px; }
    .grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 20px; margin-top: 20px; }
    .panel { overflow: hidden; }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px; border-bottom: 1px solid #e2e8f0; }
    .panel-body { padding: 18px; }
    .chart { display: flex; height: 150px; align-items: end; gap: 8px; padding-top: 20px; }
    .bar { flex: 1; min-width: 8px; border-radius: 4px 4px 0 0; background: #bfdbfe; }
    .bar:last-child { background: #2563eb; }
    .chart-labels { display: flex; justify-content: space-between; margin-top: 8px; color: #94a3b8; font-size: 10px; }
    .capacity { display: flex; align-items: center; gap: 22px; }
    .ring { display: grid; width: 116px; height: 116px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: conic-gradient(#2563eb 0 0%, #e2e8f0 0 100%); }
    .ring-inner { display: grid; width: 86px; height: 86px; place-items: center; border-radius: 50%; background: white; font-size: 22px; font-weight: 700; }
    .stats { display: grid; gap: 12px; color: #64748b; font-size: 11px; }
    .stats strong { display: block; margin-top: 3px; color: #1e293b; font-size: 14px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 700px; border-collapse: collapse; text-align: left; font-size: 12px; }
    th { padding: 10px 18px; background: #f8fafc; color: #64748b; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
    td { padding: 14px 18px; border-top: 1px solid #f1f5f9; color: #475569; }
    td strong, code { color: #1e293b; }
    code { font-family: ui-monospace, monospace; font-size: 11px; }
    .status { color: #059669; font-weight: 600; }
    .status.warn { color: #d97706; }
    .status.bad { color: #dc2626; }
    .search { width: 220px; height: 34px; padding: 0 10px; border: 1px solid #e2e8f0; border-radius: 7px; outline: 0; font-size: 12px; }
    .search:focus, textarea:focus, input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
    .form { display: flex; flex-wrap: wrap; gap: 8px; }
    .form input { height: 36px; min-width: 180px; padding: 0 10px; border: 1px solid #e2e8f0; border-radius: 7px; outline: 0; font-size: 12px; }
    textarea { width: 100%; min-height: 70px; padding: 8px; border: 1px solid #e2e8f0; border-radius: 7px; outline: 0; font-family: ui-monospace, monospace; font-size: 11px; }
    .notice { min-height: 18px; margin: 0; color: #b45309; font-size: 12px; }
    .issued { display: grid; gap: 12px; margin: 0 18px 18px; padding: 16px; border: 1px solid #bfdbfe; border-radius: 10px; background: #eff6ff; }
    .issued[hidden] { display: none; }
    .issued-label { color: #64748b; font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .credential { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .credential-value { display: block; margin-top: 4px; color: #1e293b; font-family: ui-monospace, monospace; font-size: 13px; overflow-wrap: anywhere; }
    .credential-value.secret { font-weight: 800; }
    .view { display: none; }
    .view.active { display: block; }
    .empty { padding: 28px 18px; color: #94a3b8; text-align: center; }
    @media (min-width: 1024px) { .sidebar { display: block; } .menu { display: none; } .main { margin-left: 256px; } }
    @media (max-width: 900px) { .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid { grid-template-columns: 1fr; } }
    @media (max-width: 1023px) { .sidebar-close { display: block; } }
    @media (max-width: 560px) { .content { padding: 22px 14px 36px; } .heading { align-items: start; flex-direction: column; } .cards { grid-template-columns: 1fr 1fr; gap: 9px; } .card { padding: 13px; } .metric { font-size: 21px; } .topbar { padding: 0 14px; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="mark">S</div><div><strong>S3MINI</strong><small>Object storage control plane</small></div><button id="sidebar-close" class="sidebar-close" aria-label="Close navigation">×</button></div>
      <nav class="nav" aria-label="Primary navigation">
        <div class="nav-label">Workspace</div>
        <button class="active" data-view="overview">Dashboard</button>
        <button data-view="buckets">Buckets</button>
        <button data-view="accounts">Accounts</button>
        <button data-view="policies">Policies</button>
      </nav>
      <div class="footer"><div class="user-card"><div id="sidebar-avatar" class="avatar">S3</div><div><strong id="sidebar-profile-name">Administrator</strong><small id="sidebar-profile-email"></small></div></div><div class="health"><span class="dot"></span><strong>Local node</strong><br><span id="health-text">Checking status...</span></div><button data-view="settings">Settings</button></div>
    </aside>
    <section class="main">
      <header class="topbar"><div class="workspace"><button id="mobile-menu" class="menu" aria-label="Open navigation">☰</button>Workspace <strong>S3MINI</strong></div></header>
      <div class="content">
        <dashboard-status id="status" message=""></dashboard-status>
        <section class="view active" data-panel="overview">
          <div class="heading"><div><h1>Overview</h1><p class="muted">A quick look at your object storage infrastructure.</p></div><div class="actions"><button class="button" id="refresh">Refresh</button><button class="button primary" data-view="buckets">+ New bucket</button></div></div>
          <div class="cards"><div class="card"><div class="card-label">Storage used</div><div class="metric" id="storage">0 B</div><div class="card-note">Local metadata view</div></div><div class="card"><div class="card-label">Total buckets</div><div class="metric" id="bucket-count">0</div><div class="card-note" id="bucket-note">0 active</div></div><div class="card"><div class="card-label">Objects</div><div class="metric" id="object-count">-</div><div class="card-note">Use a bucket view for object counts</div></div><div class="card"><div class="card-label">Replication peers</div><div class="metric" id="peer-count">0</div><div class="card-note" id="peer-note">No configured peers</div></div></div>
          <div class="grid"><div class="panel"><div class="panel-head"><div><h2>Storage consumption</h2><p class="muted">Recent local replication activity</p></div><span class="muted">Live</span></div><div class="panel-body"><div class="metric" id="event-count">0 events</div><div class="chart" id="chart"></div><div class="chart-labels"><span>Earlier</span><span>Today</span></div></div></div><div class="panel"><div class="panel-head"><div><h2>Capacity</h2><p class="muted">Object data on this node</p></div></div><div class="panel-body capacity"><div class="ring" id="ring"><div class="ring-inner">-</div></div><div class="stats"><div><span>Tracked objects</span><strong id="capacity-objects">-</strong></div><div><span>Pending replication</span><strong id="pending-count">-</strong></div><div><span>Node mode</span><strong>Single node</strong></div></div></div></div></div>
          <div class="panel" style="margin-top:20px"><div class="panel-head"><div><h2>Recent buckets</h2><p class="muted">Storage containers managed by this node</p></div><button class="button" data-view="buckets">View all</button></div><div class="table-wrap"><table><thead><tr><th>Bucket</th><th>Location</th><th>Created</th><th>Status</th></tr></thead><tbody id="overview-buckets"></tbody></table></div></div>
        </section>
        <section class="view" data-panel="buckets"><div class="heading"><div><h1>Buckets</h1><p class="muted">Create, inspect, and remove storage containers.</p></div></div><div class="panel"><div class="panel-head"><form class="form" id="bucket-form"><input id="bucket-name" placeholder="Bucket name" maxlength="63" required><input id="bucket-region" placeholder="Location (optional)"><button class="button primary">+ Create bucket</button></form><input class="search" id="bucket-search" placeholder="Search buckets"></div><div class="table-wrap"><table><thead><tr><th>Bucket</th><th>Location</th><th>Created</th><th>Policy</th><th></th></tr></thead><tbody id="bucket-table"></tbody></table></div></div></section>
        <section class="view" data-panel="accounts"><div class="heading"><div><h1>Accounts</h1><p class="muted">Issue and disable S3 access keys for this node.</p></div></div><div class="panel"><div class="panel-head"><form class="form" id="account-form"><input id="account-name" placeholder="Display name" maxlength="120" required><button class="button primary">+ Issue access key</button></form></div><div id="issued" class="issued" hidden><div class="credential"><div><div class="issued-label">Access key</div><code id="issued-access" class="credential-value"></code></div><button class="button" data-copy="access">Copy</button></div><div class="credential"><div><div class="issued-label">Secret key</div><strong id="issued-secret" class="credential-value secret"></strong></div><button class="button" data-copy="secret">Copy</button></div><p class="muted">Save this secret now. It will not be shown again.</p></div><div class="table-wrap"><table><thead><tr><th>Access key</th><th>Name</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody id="account-table"></tbody></table></div></div></section>
        <section class="view" data-panel="policies"><div class="heading"><div><h1>Policies</h1><p class="muted">Review and update bucket policy documents.</p></div></div><div id="policy-list" class="grid"></div></section>
        <section class="view" data-panel="settings"><div class="heading"><div><h1>Settings</h1><p class="muted">Admin access is controlled by the authenticated OIDC user and S3MINI_OIDC_ADMIN_EMAILS.</p></div></div><div class="panel"><div class="panel-head"><div><h2>Current access</h2><p class="muted">No token entry is required for the dashboard. Users not listed in the OIDC admin allowlist cannot administer this node.</p></div></div><div class="panel-body"><p id="token-owner" class="muted"></p><p class="muted">Replication peers and events are operational status, not settings. They are summarized on the dashboard.</p></div></div></section>
      </div>
    </section>
  </div>
  <script>
    const state = { buckets: [], keys: [], peers: [], events: [], policies: {} };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const status = text => { document.querySelector('#status').message = text || ''; };
    const request = async (url, options = {}) => { const headers = {...(options.headers || {})}; const response = await fetch(url, {...options, credentials: 'same-origin', headers}); if ((response.status === 401 || response.status === 403) && location.pathname !== '/admin/login') location.href = '/admin/login'; return response; };
    const empty = (message, span) => '<tr><td class="empty" colspan="' + span + '">' + esc(message) + '</td></tr>';
    const bytes = value => value == null ? '-' : value < 1024 ? value + ' B' : value < 1048576 ? (value / 1024).toFixed(1) + ' KB' : value < 1073741824 ? (value / 1048576).toFixed(1) + ' MB' : (value / 1073741824).toFixed(1) + ' GB';
    function show(view) { document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === view)); document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view)); }
    function render() {
      const filtered = state.buckets.filter(bucket => bucket.name.toLowerCase().includes((document.querySelector('#bucket-search')?.value || '').toLowerCase()));
      document.querySelector('#bucket-count').textContent = state.buckets.length;
      document.querySelector('#bucket-note').textContent = state.buckets.length + ' active';
      document.querySelector('#peer-count').textContent = state.peers.length;
      document.querySelector('#peer-note').textContent = state.peers.length ? state.peers.filter(peer => peer.status === 'Healthy').length + ' healthy' : 'No configured peers';
      document.querySelector('#event-count').textContent = state.events.length + ' events';
      document.querySelector('#pending-count').textContent = state.events.filter(event => event.status === 'Pending').length;
      document.querySelector('#chart').innerHTML = Array.from({length: 14}, (_, index) => '<div class="bar" style="height:' + (20 + ((state.events.length + index * 13) % 70)) + '%"></div>').join('');
      document.querySelector('#account-table').innerHTML = state.keys.map(key => '<tr><td><code>' + esc(key.accessKeyId) + '</code></td><td>' + esc(key.displayName) + '</td><td><span class="status ' + (key.status === 'Active' ? '' : 'bad') + '">' + esc(key.status) + '</span></td><td>' + esc(new Date(key.createdAt).toLocaleString()) + '</td><td>' + (key.status === 'Active' ? '<button class="button danger" data-disable-key="' + esc(key.accessKeyId) + '">Disable</button>' : '') + '</td></tr>').join('') || empty('No access keys', 5);
      document.querySelector('#policy-list').innerHTML = state.buckets.map(bucket => '<div class="panel"><div class="panel-head"><div><h2>' + esc(bucket.name) + '</h2><p class="muted">Bucket policy JSON</p></div></div><div class="panel-body"><textarea data-policy-editor="' + esc(bucket.name) + '">' + esc(JSON.stringify(state.policies[bucket.name] || {}, null, 2)) + '</textarea><div class="actions" style="margin-top:10px"><button class="button primary" data-save-policy="' + esc(bucket.name) + '">Save policy</button><button class="button danger" data-clear-policy="' + esc(bucket.name) + '">Clear policy</button></div></div></div>').join('') || '<div class="panel"><div class="empty">Create a bucket to manage its policy.</div></div>';
      const peerTable = document.querySelector('#peer-table');
      if (peerTable) peerTable.innerHTML = state.peers.map(peer => '<tr><td><code>' + esc(peer.peer) + '</code></td><td><span class="status ' + (peer.status === 'Healthy' ? '' : 'warn') + '">' + esc(peer.status) + '</span></td><td>' + esc(peer.consecutiveFailures) + '</td></tr>').join('') || empty('No configured peers', 3);
      const eventTable = document.querySelector('#event-table');
      if (eventTable) eventTable.innerHTML = state.events.slice(0, 20).map(event => '<tr><td><code>' + esc(event.bucket + '/' + event.key) + '</code></td><td>' + esc(event.status) + '</td><td>' + esc(event.attempts) + '</td></tr>').join('') || empty('No replication events', 3);
    }
    async function load() {
      try {
        const responses = await Promise.all(['/admin/buckets', '/admin/access-keys', '/admin/replication/health', '/admin/replication/events?limit=100'].map(request));
        if (responses[0].ok) state.buckets = await responses[0].json();
        if (responses[1].ok) state.keys = await responses[1].json();
        if (responses[2].ok) state.peers = await responses[2].json();
        if (responses[3].ok) state.events = await responses[3].json();
        if (!responses[0].ok) throw new Error('Unable to load buckets (' + responses[0].status + ').');
        state.policies = {};
        await Promise.all(state.buckets.map(async bucket => { const response = await request('/admin/buckets/' + encodeURIComponent(bucket.name) + '/policy'); if (response.ok) state.policies[bucket.name] = await response.json(); }));
        const profileResponse = await request('/admin/profile');
        if (profileResponse.ok) { const profile = await profileResponse.json(); const name = profile.name || profile.email || 'Administrator'; document.querySelector('#sidebar-profile-name').textContent = name; document.querySelector('#sidebar-profile-email').textContent = profile.email || ''; document.querySelector('#sidebar-avatar').textContent = name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); document.querySelector('#token-owner').textContent = profile.adminTokenOwner?.email ? 'Associated with ' + profile.adminTokenOwner.email : ''; }
        document.querySelector('#health-text').textContent = state.peers.length && state.peers.some(peer => peer.status !== 'Healthy') ? 'Replication needs attention' : 'API responding normally';
        render(); status('');
        if (responses.slice(1).some(response => !response.ok)) status('Some control-plane panels are unavailable.');
      } catch (error) { status(error.message); }
    }
    const closeMobileMenu = () => document.querySelector('.sidebar').classList.remove('mobile-open');
    document.querySelector('#mobile-menu').onclick = () => document.querySelector('.sidebar').classList.toggle('mobile-open');
    document.querySelector('#sidebar-close').onclick = closeMobileMenu;
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { show(button.dataset.view); closeMobileMenu(); }));
    document.querySelector('#refresh').onclick = load;
    document.querySelector('#bucket-search').oninput = render;
    document.querySelector('#bucket-form').onsubmit = async event => { event.preventDefault(); const response = await request('/admin/buckets', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ name: document.querySelector('#bucket-name').value, locationConstraint: document.querySelector('#bucket-region').value || undefined }) }); if (!response.ok) return status('Unable to create bucket (' + response.status + ').'); event.target.reset(); await load(); show('buckets'); };
    document.querySelector('#account-form').onsubmit = async event => { event.preventDefault(); const response = await request('/admin/access-keys', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ displayName: document.querySelector('#account-name').value }) }); if (!response.ok) return status('Unable to issue access key (' + response.status + ').'); const issued = await response.json(); document.querySelector('#issued-access').textContent = issued.accessKeyId; document.querySelector('#issued-secret').textContent = issued.secretAccessKey; document.querySelector('#issued').hidden = false; event.target.reset(); await load(); };
    document.addEventListener('click', async event => { const button = event.target.closest('[data-delete-bucket],[data-disable-key],[data-policy],[data-copy],[data-save-policy],[data-clear-policy]'); if (!button) return; if (button.dataset.copy) { const value = document.querySelector(button.dataset.copy === 'access' ? '#issued-access' : '#issued-secret').textContent; try { await navigator.clipboard.writeText(value); status('Copied ' + button.dataset.copy + ' key.'); } catch { status('Clipboard access is unavailable.'); } return; } if (button.dataset.savePolicy) { const bucket = button.dataset.savePolicy; try { const policy = JSON.parse(document.querySelector('[data-policy-editor="' + CSS.escape(bucket) + '"]').value); const response = await request('/admin/buckets/' + encodeURIComponent(bucket) + '/policy', { method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(policy) }); if (!response.ok) throw new Error('Unable to save policy (' + response.status + ').'); await load(); status('Policy saved for ' + bucket + '.'); } catch (error) { status(error.message); } return; } if (button.dataset.clearPolicy) { const bucket = button.dataset.clearPolicy; const response = await request('/admin/buckets/' + encodeURIComponent(bucket) + '/policy', { method: 'DELETE' }); if (response.ok) { await load(); status('Policy cleared for ' + bucket + '.'); } return; } if (button.dataset.deleteBucket) { if (!confirm('Delete bucket ' + button.dataset.deleteBucket + '?')) return; await request('/admin/buckets/' + encodeURIComponent(button.dataset.deleteBucket), { method: 'DELETE' }); await load(); } if (button.dataset.disableKey) { await request('/admin/access-keys/' + encodeURIComponent(button.dataset.disableKey), { method: 'DELETE' }); await load(); } if (button.dataset.policy) { show('policies'); status('Edit policies below.'); } });
    load();
  </script>
</body>
</html>`;
