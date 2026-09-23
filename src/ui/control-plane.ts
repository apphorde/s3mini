export const CONTROL_PLANE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>S3MINI Control Plane</title>
  <link rel="stylesheet" href="/admin/tailwind.css">
  <script type="importmap">{"imports":{"@li3/":"https://cdn.li3.dev/@li3/"}}</script>
  <script type="module">import '@li3/web';</script>
  <template component="dashboard-status">
    <p class="min-h-5 text-xs text-amber-700">{{ message }}</p>
    <script setup>
      import { defineProp } from '@li3/web';
      export default function () { const message = defineProp('message', { default: '' }); return { message }; }
    </script>
  </template>
  <template component="bucket-policy-dialog">
    <script setup>
      import { defineEvent, defineProp } from '@li3/web';
      export default function () {
      const open = defineProp('open', { bool: true });
      const bucket = defineProp('bucket', { default: '' });
      const value = defineProp('value', { default: '{}' });
      const close = defineEvent('close');
      const save = defineEvent('save');
      const noop = () => {};
      const update = next => { value.value = next; };
      const submit = event => { event.preventDefault(); save({ bucket: bucket.value, value: value.value }); };
      return { open, bucket, value, update, submit, close, save, noop }; }
    </script>
    <template if="open"><div class="fixed inset-0 z-30 grid place-items-center bg-slate-950/30 p-4" on-click="close()"><div class="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-2xl" on-click.stop="noop"><div class="flex items-center justify-between border-b border-slate-200 p-5"><div><h2 class="text-sm font-semibold">Bucket policy</h2><p class="mt-1 text-xs text-slate-500">{{ bucket }}</p></div><button class="text-xl text-slate-400" aria-label="Close policy editor" on-click="close()">x</button></div><form class="p-5" on-submit="submit"><textarea class="min-h-72 w-full rounded-lg border border-slate-200 p-3 font-mono text-xs" bind-value="value" on-input="update($event.target.value)"></textarea><div class="mt-4 flex justify-end gap-2"><button type="button" class="rounded-lg border border-slate-200 px-3 py-2 text-sm" on-click="close()">Cancel</button><button class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white">Save</button></div></form></div></div></template>
  </template>
  <template component="control-plane-app">
    <script setup>
      import { computed, ref, onInit } from '@li3/web';
      export default function () {
      const view = ref('overview');
      const menuOpen = ref(false);
      const status = ref('');
      const profile = ref({ name: 'Administrator', email: '', initials: 'S3' });
      const buckets = ref([]);
      const keys = ref([]);
      const peers = ref([]);
      const events = ref([]);
      const policies = ref({});
      const policyDialog = ref({ open: false, bucket: '', value: '{}' });
      const bucketName = ref('');
      const bucketRegion = ref('');
      const accountName = ref('');
      const search = ref('');
      const issued = ref({ access: '', secret: '', visible: false });

      const request = async (url, options = {}) => {
        const response = await fetch(url, { ...options, credentials: 'same-origin', headers: { ...(options.headers || {}) } });
        if ((response.status === 401 || response.status === 403) && location.pathname !== '/admin/login') location.href = '/admin/login';
        return response;
      };
      const readJson = async (url, fallback) => { const response = await request(url); return response.ok ? response.json() : fallback; };
      const setView = next => { view.value = next; menuOpen.value = false; };
      const setMenuOpen = value => { menuOpen.value = value; };
      const setStatus = message => { status.value = message || ''; };
      const setBucketName = value => { bucketName.value = value; };
      const setBucketRegion = value => { bucketRegion.value = value; };
      const setAccountName = value => { accountName.value = value; };
      const setSearch = value => { search.value = value; };
      const setPolicy = (bucket, value) => { policies.value = { ...policies.value, [bucket]: value }; };
      const filteredBuckets = () => buckets.value.filter(bucket => bucket.name.toLowerCase().includes(search.value.toLowerCase()));
      const visibleBuckets = computed(() => buckets.value.filter(bucket => bucket.name.toLowerCase().includes(search.value.toLowerCase())));
      const load = async () => {
        const [bucketData, keyData, peerData, eventData, profileData] = await Promise.all([
          readJson('/admin/buckets', []),
          readJson('/admin/access-keys', []),
          readJson('/admin/replication/health', []),
          readJson('/admin/replication/events?limit=100', []),
          readJson('/admin/profile', {}),
        ]);
        buckets.value = bucketData;
        keys.value = keyData;
        peers.value = peerData;
        events.value = eventData;
        const profileName = profileData.name || profileData.email || 'Administrator';
        profile.value = { name: profileName, email: profileData.email || '', initials: profileName.split(/\\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() };
        const nextPolicies = {};
        for (const bucket of buckets.value) nextPolicies[bucket.name] = JSON.stringify(await readJson('/admin/buckets/' + encodeURIComponent(bucket.name) + '/policy', {}), null, 2);
        policies.value = nextPolicies;
      };
      const createBucket = async event => {
        event.preventDefault();
        const response = await request('/admin/buckets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: bucketName.value, locationConstraint: bucketRegion.value || undefined }) });
        if (!response.ok) return setStatus('Unable to create bucket (' + response.status + ').');
        bucketName.value = ''; bucketRegion.value = ''; await load(); setView('buckets');
      };
      const issueKey = async event => {
        event.preventDefault();
        const response = await request('/admin/access-keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: accountName.value }) });
        if (!response.ok) return setStatus('Unable to issue access key (' + response.status + ').');
        const value = await response.json(); issued.value = { access: value.accessKeyId, secret: value.secretAccessKey, visible: true }; accountName.value = ''; await load();
      };
      const savePolicy = async bucket => {
        try { JSON.parse(policies.value[bucket]); } catch { return setStatus('Policy JSON is invalid.'); }
        const response = await request('/admin/buckets/' + encodeURIComponent(bucket) + '/policy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: policies.value[bucket] });
        setStatus(response.ok ? 'Policy saved for ' + bucket + '.' : 'Unable to save policy (' + response.status + ').');
        if (response.ok) await load();
      };
      const clearPolicy = async bucket => { const response = await request('/admin/buckets/' + encodeURIComponent(bucket) + '/policy', { method: 'DELETE' }); if (response.ok) { policies.value = { ...policies.value, [bucket]: '{}' }; setStatus('Policy cleared for ' + bucket + '.'); } };
      const openPolicy = bucket => { policyDialog.value = { open: true, bucket, value: policies.value[bucket] || '{}' }; };
      const closePolicy = () => { policyDialog.value = { ...policyDialog.value, open: false }; };
      const saveDialogPolicy = async event => { try { JSON.parse(event.detail.value); } catch { return setStatus('Policy JSON is invalid.'); } const response = await request('/admin/buckets/' + encodeURIComponent(event.detail.bucket) + '/policy', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: event.detail.value }); if (response.ok) { policyDialog.value = { ...policyDialog.value, open: false }; await load(); setStatus('Policy saved for ' + event.detail.bucket + '.'); } else setStatus('Unable to save policy (' + response.status + ').'); };
      const disableKey = async key => { if (!confirm('Disable access key ' + key + '?')) return; await request('/admin/access-keys/' + encodeURIComponent(key), { method: 'DELETE' }); await load(); };
      const deleteBucket = async bucket => { if (confirm('Delete bucket ' + bucket + '?')) { await request('/admin/buckets/' + encodeURIComponent(bucket), { method: 'DELETE' }); await load(); } };
      const copy = async value => { try { await navigator.clipboard.writeText(value); setStatus('Copied.'); } catch { setStatus('Clipboard access is unavailable.'); } };
      onInit(load);
      return { view, menuOpen, status, profile, buckets, keys, peers, events, policies, issued, visibleBuckets, policyDialog, setView, setMenuOpen, setStatus, setBucketName, setBucketRegion, setAccountName, setSearch, setPolicy, createBucket, issueKey, savePolicy, clearPolicy, disableKey, deleteBucket, copy, openPolicy, closePolicy, saveDialogPolicy }; }
    </script>
    <aside bind-class="menuOpen ? 'fixed inset-y-0 left-0 z-20 block w-64 border-r border-slate-200 bg-white shadow-xl lg:static lg:block lg:shadow-none' : 'fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white lg:static lg:block'"><div class="flex h-16 items-center gap-3 border-b border-slate-200 px-6"><div class="grid size-8 place-items-center rounded-lg bg-blue-600 font-bold text-white">S</div><div><strong class="block text-sm">S3MINI</strong><small class="block text-[11px] text-slate-500">Object storage control plane</small></div><button class="ml-auto text-xl text-slate-500 lg:hidden" aria-label="Close navigation" on-click="menuOpen = false">x</button></div><nav class="space-y-1 p-3" aria-label="Primary navigation"><p class="px-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Workspace</p><button class="block w-full rounded-lg bg-blue-50 px-3 py-2.5 text-left text-sm font-medium text-blue-700" on-click="setView('overview')">Dashboard</button><button class="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50" on-click="setView('buckets')">Buckets</button><button class="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50" on-click="setView('accounts')">Accounts</button><button class="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-50" on-click="setView('policies')">Policies</button></nav><div class="absolute inset-x-3 bottom-3"><div class="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3"><div class="grid size-8 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{{ profile.initials }}</div><div class="min-w-0"><strong class="block truncate text-xs text-slate-700">{{ profile.name }}</strong><small class="block truncate text-[10px] text-slate-500">{{ profile.email }}</small></div></div><button class="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50" on-click="setView('settings')">Settings</button></div></aside>
    <main class="min-h-screen min-w-0 bg-slate-50 lg:ml-64"><header class="flex h-16 items-center border-b border-slate-200 bg-white px-5"><button class="mr-3 rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 lg:hidden" aria-label="Open navigation" on-click="menuOpen = true">Menu</button><span class="text-sm text-slate-500">Workspace <strong class="text-slate-900">S3MINI</strong></span></header><div class="mx-auto max-w-6xl p-5 sm:p-8"><dashboard-status message="{{ status }}"></dashboard-status><template if="view === 'overview'"><section><div class="mb-8 flex items-end justify-between gap-4"><div><h1 class="text-2xl font-semibold tracking-tight">Overview</h1><p class="mt-1 text-sm text-slate-500">A quick look at your object storage infrastructure.</p></div><button class="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white" on-click="setView('buckets')">+ New bucket</button></div><div class="grid grid-cols-2 gap-3 xl:grid-cols-4"><div class="rounded-xl border border-slate-200 bg-white p-5"><p class="text-sm font-medium text-slate-500">Total buckets</p><p class="mt-2 text-2xl font-semibold">{{ buckets.length }}</p><p class="mt-3 text-xs text-slate-500">Managed by this node</p></div><div class="rounded-xl border border-slate-200 bg-white p-5"><p class="text-sm font-medium text-slate-500">Objects</p><p class="mt-2 text-2xl font-semibold">-</p><p class="mt-3 text-xs text-slate-500">Inspect a bucket for contents</p></div><div class="rounded-xl border border-slate-200 bg-white p-5"><p class="text-sm font-medium text-slate-500">Peers</p><p class="mt-2 text-2xl font-semibold">{{ peers.length }}</p><p class="mt-3 text-xs text-slate-500">Replication health</p></div><div class="rounded-xl border border-slate-200 bg-white p-5"><p class="text-sm font-medium text-slate-500">Events</p><p class="mt-2 text-2xl font-semibold">{{ events.length }}</p><p class="mt-3 text-xs text-slate-500">Durable replication journal</p></div></div><div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white"><div class="border-b border-slate-200 p-5"><h2 class="text-sm font-semibold">Buckets</h2><p class="mt-1 text-xs text-slate-500">Storage containers managed by this node</p></div><div class="overflow-x-auto"><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th class="px-5 py-3">Bucket</th><th class="px-5 py-3">Location</th><th class="px-5 py-3">Created</th></tr></thead><tbody><template for="bucket of buckets"><tr class="border-t border-slate-100"><td class="px-5 py-4 font-medium">{{ bucket.name }}</td><td class="px-5 py-4 text-slate-500">{{ bucket.locationConstraint }}</td><td class="px-5 py-4 text-slate-500">{{ bucket.creationDate }}</td></tr></template><template if="buckets.length === 0"><tr><td class="px-5 py-8 text-center text-slate-400" colspan="3">No buckets yet</td></tr></template></tbody></table></div></div></section></template><template if="view === 'buckets'"><section><div class="mb-8"><h1 class="text-2xl font-semibold tracking-tight">Buckets</h1><p class="mt-1 text-sm text-slate-500">Create, inspect, and remove storage containers.</p></div><form class="mb-5 flex flex-wrap gap-2" on-submit.prevent="createBucket"><input class="h-9 rounded-lg border border-slate-200 px-3 text-sm" placeholder="Bucket name" on-input="setBucketName($event.target.value)"><input class="h-9 rounded-lg border border-slate-200 px-3 text-sm" placeholder="Location (optional)" on-input="setBucketRegion($event.target.value)"><button class="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white">Create bucket</button><input class="h-9 rounded-lg border border-slate-200 px-3 text-sm" placeholder="Search" on-input="setSearch($event.target.value)"></form><div class="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th class="px-5 py-3">Bucket</th><th class="px-5 py-3">Location</th><th class="px-5 py-3">Created</th><th class="px-5 py-3"></th></tr></thead><tbody><template for="bucket of filteredBuckets()"><tr class="border-t border-slate-100"><td class="px-5 py-4 font-medium">{{ bucket.name }}</td><td class="px-5 py-4 text-slate-500">{{ bucket.locationConstraint }}</td><td class="px-5 py-4 text-slate-500">{{ bucket.creationDate }}</td><td class="px-5 py-4 text-right"><button class="text-red-600" on-click="deleteBucket(bucket.name)">Delete</button></td></tr></template></tbody></table></div></section></template><template if="view === 'accounts'"><section><div class="mb-8"><h1 class="text-2xl font-semibold tracking-tight">Accounts</h1><p class="mt-1 text-sm text-slate-500">Issue and disable S3 access keys for this node.</p></div><form class="mb-5 flex gap-2" on-submit.prevent="issueKey"><input class="h-9 rounded-lg border border-slate-200 px-3 text-sm" placeholder="Display name" on-input="setAccountName($event.target.value)"><button class="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white">Issue access key</button></form><template if="issued.visible"><div class="mb-5 grid gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><div class="flex items-center justify-between"><div><small class="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Access key</small><code>{{ issued.access }}</code></div><button on-click="copy(issued.access)">Copy</button></div><div class="flex items-center justify-between"><div><small class="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Secret key</small><strong class="font-bold">{{ issued.secret }}</strong></div><button on-click="copy(issued.secret)">Copy</button></div></div></template><table class="w-full text-left text-sm"><thead class="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr><th class="px-5 py-3">Access key</th><th class="px-5 py-3">Name</th><th class="px-5 py-3">Status</th><th class="px-5 py-3"></th></tr></thead><tbody><template for="key of keys"><tr class="border-t border-slate-100"><td class="px-5 py-4"><code>{{ key.accessKeyId }}</code></td><td class="px-5 py-4">{{ key.displayName }}</td><td class="px-5 py-4">{{ key.status }}</td><td class="px-5 py-4 text-right"><button on-click="disableKey(key.accessKeyId)">Disable</button></td></tr></template></tbody></table></section></template><template if="view === 'policies'"><section><div class="mb-8"><h1 class="text-2xl font-semibold tracking-tight">Policies</h1><p class="mt-1 text-sm text-slate-500">Review and update bucket policy documents.</p></div><div class="grid gap-5 lg:grid-cols-2"><template for="bucket of buckets"><div class="rounded-xl border border-slate-200 bg-white p-5"><h2 class="font-semibold">{{ bucket.name }}</h2><textarea class="mt-4 min-h-32 w-full rounded-lg border border-slate-200 p-3 font-mono text-xs" value="{{ policies[bucket.name] }}" on-input="setPolicy(bucket.name, $event.target.value)"></textarea><div class="mt-3 flex gap-2"><button class="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white" on-click="savePolicy(bucket.name)">Save policy</button><button class="rounded-lg px-3 py-2 text-xs text-red-600" on-click="clearPolicy(bucket.name)">Clear policy</button></div></div></template></div></section></template><template if="view === 'settings'"><section><div class="mb-8"><h1 class="text-2xl font-semibold tracking-tight">Settings</h1><p class="mt-1 text-sm text-slate-500">Admin access is controlled by the authenticated OIDC user and S3MINI_OIDC_ADMIN_EMAILS.</p></div><div class="rounded-xl border border-slate-200 bg-white p-5"><h2 class="font-semibold">Current access</h2><p class="mt-2 text-sm text-slate-500">{{ profile.email }}</p><p class="mt-4 text-xs text-slate-500">Users not listed in the OIDC admin allowlist cannot administer this node.</p></div></section></template></div></main>
  </template>
</head>
<body>
  <control-plane-app></control-plane-app>
</body>
</html>`
  .replace('on-click="menuOpen = false"', 'on-click="setMenuOpen(false)"')
  .replace('on-click="menuOpen = true"', 'on-click="setMenuOpen(true)"')
  .replace('message="{{ status }}"', 'bind-message="status"')
  .replace(/lg:static /g, '')
  .replace(
    /<header[\s\S]*?<\/header>/,
    '<div class="mb-4 lg:hidden"><button class="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600" aria-label="Open navigation" on-click="setMenuOpen(true)">Menu</button></div>',
  )
  .replace(/<table class="/g, '<table class="bg-white ')
  .replace(
    '<div class="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3">',
    '<a class="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3 hover:bg-blue-50" bind-href="profile.meUrl" target="_blank" rel="noreferrer">',
  )
  .replace(
    '<small class="block truncate text-[10px] text-slate-500">{{ profile.email }}</small></div></div>',
    '<small class="block truncate text-[10px] text-slate-500">{{ profile.email }}</small></div></a></div>',
  )
  .replace(
    /<button[^>]*on-click="setView\('policies'\)"[^>]*>Policies<\/button>/,
    "",
  )
  .replace(
    /<button[^>]*on-click="setView\('settings'\)"[^>]*>Settings<\/button>/,
    "",
  )
  .replace(
    /<template if="view === 'policies'">[\s\S]*?<\/section><\/template>/,
    "",
  )
  .replace(
    /<template if="view === 'settings'">[\s\S]*?<\/section><\/template>/,
    "",
  )
  .replace(
    /<button class="text-red-600" on-click="deleteBucket\(bucket.name\)">Delete<\/button>/,
    '<button class="mr-3 text-blue-600" on-click="openPolicy(bucket.name)">Policy</button><button class="text-red-600" on-click="deleteBucket(bucket.name)">Delete</button>',
  )
  .replace(
    /<\/main>/,
    '<bucket-policy-dialog bind-open="policyDialog.open" bind-bucket="policyDialog.bucket" bind-value="policyDialog.value" on-save="saveDialogPolicy($event)" on-close="closePolicy()"></bucket-policy-dialog></main>',
  )
  .replace(
    /template for="bucket of buckets"/g,
    'template for="[bucket] of buckets"',
  )
  .replace(/template for="key of keys"/g, 'template for="[key] of keys"')
  .replace(
    'template for="bucket of filteredBuckets()"',
    'template for="[bucket] of visibleBuckets"',
  )
  .replace(
    'value="{{ policies[bucket.name] }}"',
    'bind-value="policies[bucket.name]"',
  );
