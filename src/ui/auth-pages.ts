const AUTH_STYLESHEET = '<link rel="stylesheet" href="/admin/tailwind.css">';

export const DASHBOARD_ACCESS_ERROR_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Dashboard access needs attention · S3MINI</title>
    ${AUTH_STYLESHEET}
  </head>
  <body class="auth-page bg-app-bg text-[#1c201e]">
    <main class="w-full max-w-xl px-4 py-10 sm:px-6">
      <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-9">
        <div class="mb-8 flex items-center gap-3">
          <span class="grid size-9 place-items-center rounded-lg bg-brand text-sm font-bold text-white" aria-hidden="true">S</span>
          <span class="text-xl font-bold tracking-tight text-gray-900">S3MINI<span class="text-brand">.</span></span>
        </div>
        <div class="mb-6 grid size-12 place-items-center rounded-full bg-[#edf5ee] text-xl text-brand" aria-hidden="true">!</div>
        <h1 class="text-2xl font-bold tracking-tight text-gray-900">Your dashboard access needs attention</h1>
        <p class="mt-3 text-sm leading-6 text-gray-600">Your sign-in session may have expired, or your account may not have a dashboard role assigned.</p>
        <div class="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-600">
          Sign in again to refresh your session. If this message persists, ask an administrator to assign the <strong class="font-semibold text-gray-800">admin</strong> role to your OIDC account.
        </div>
        <div class="mt-7 flex flex-col gap-3 sm:flex-row">
          <a class="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover" href="/admin/login">Sign in again</a>
          <form class="flex-1" action="/auth/logout" method="post">
            <button class="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50" type="submit">Sign out and clear session</button>
          </form>
        </div>
        <p class="mt-5 text-xs leading-5 text-gray-500">Signing out clears the S3MINI session in this browser. It does not sign you out of your identity provider.</p>
      </section>
    </main>
  </body>
</html>`;

export const SIGNED_OUT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Signed out · S3MINI</title>
    ${AUTH_STYLESHEET}
  </head>
  <body class="auth-page bg-app-bg text-[#1c201e]">
    <main class="w-full max-w-xl px-4 py-10 sm:px-6">
      <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-9">
        <div class="mb-8 flex items-center gap-3">
          <span class="grid size-9 place-items-center rounded-lg bg-brand text-sm font-bold text-white" aria-hidden="true">S</span>
          <span class="text-xl font-bold tracking-tight text-gray-900">S3MINI<span class="text-brand">.</span></span>
        </div>
        <div class="mb-6 grid size-12 place-items-center rounded-full bg-[#edf5ee] text-xl font-semibold text-brand" aria-hidden="true">✓</div>
        <h1 class="text-2xl font-bold tracking-tight text-gray-900">You’re signed out</h1>
        <p class="mt-3 text-sm leading-6 text-gray-600">Your S3MINI dashboard session has been cleared from this browser.</p>
        <a class="mt-7 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover sm:w-auto" href="/admin/login">Sign in again</a>
        <p class="mt-5 text-xs leading-5 text-gray-500">Your identity-provider session may still be active.</p>
      </section>
    </main>
  </body>
</html>`;
