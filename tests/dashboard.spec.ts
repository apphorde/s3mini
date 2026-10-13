import { expect, test } from "@playwright/test";

test("dashboard boots, renders, and has no browser errors", async ({ page }) => {
  const errors: string[] = [];
  const requests: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.method() + " " + request.url()));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failedResponses.push(response.status() + " " + response.url());
    }
  });
  await page.route("https://cdn.li3.dev/**", async (route) => {
    const response = await fetch(route.request().url());
    await route.fulfill({
      status: response.status,
      body: await response.text(),
      headers: {
        "content-type": response.headers.get("content-type") || "text/javascript",
        "access-control-allow-origin": "*",
      },
    });
  });
  await page.route("https://unpkg.com/**", async (route) => {
    const response = await fetch(route.request().url());
    await route.fulfill({
      status: response.status,
      body: await response.text(),
      headers: {
        "content-type": response.headers.get("content-type") || "text/javascript",
        "access-control-allow-origin": "*",
      },
    });
  });

  await page.goto("/admin", { waitUntil: "networkidle" });
  await expect(page.locator("control-plane-app")).toBeAttached();
  await expect(page.getByText("Overview")).toBeVisible();
  await expect(page.getByText("Object storage control plane")).toHaveCount(0);
  const sidebar = page.locator("aside");
  await expect(sidebar.getByText("s3mini.")).toBeVisible();
  await expect(page.locator(".topbar-profile")).toBeVisible();
  const topbarBounds = await page.locator(".dashboard-topbar").boundingBox();
  const profileBounds = await page.locator(".topbar-profile").boundingBox();
  expect(topbarBounds?.height).toBeLessThanOrEqual(64);
  expect(profileBounds).not.toBeNull();
  expect(profileBounds!.x + profileBounds!.width).toBeGreaterThan(1100);
  await expect(sidebar.locator("a")).toHaveCount(0);
  await expect(sidebar.locator("span").filter({ hasText: /^admin$/i })).toHaveCount(0);
  const sidebarChrome = await sidebar.evaluate((element) => ({
    borderRight: globalThis.getComputedStyle(element).borderRightWidth,
    headerBorder: globalThis.getComputedStyle(element.firstElementChild!).borderBottomWidth,
  }));
  expect(sidebarChrome).toEqual({ borderRight: "0px", headerBorder: "0px" });
  await expect(sidebar.locator("nav")).toBeVisible();
  const sidebarIcons = page.locator("aside nav button lucide-icon");
  await expect(sidebarIcons).toHaveCount(6);
  await expect.poll(() => sidebarIcons.locator("svg").count()).toBe(6);
  const dashboardLink = page.getByRole("button", { name: "Dashboard" });
  await expect(dashboardLink).toHaveClass(/nav-item-active/);
  const navigationButtons = page.locator("aside nav button");
  await expect(navigationButtons).toHaveCount(6);
  for (const navigationButton of await navigationButtons.all()) {
    await expect(navigationButton).toHaveClass(/nav-item/);
  }
  const desktopLayout = await page.evaluate(() => {
    const sidebar = globalThis.document.querySelector("aside")!.getBoundingClientRect();
    const main = globalThis.document.querySelector("main")!.getBoundingClientRect();
    return { sidebarRight: sidebar.right, mainLeft: main.left, mainWidth: main.width };
  });
  expect(desktopLayout.sidebarRight).toBe(desktopLayout.mainLeft);
  expect(desktopLayout.mainWidth).toBeGreaterThan(900);
  await page.screenshot({
    path: "test-results/dashboard-overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Buckets" }).click();
  await expect(page.getByRole("heading", { name: "Buckets" })).toBeVisible();
  const bucketName = `ui-smoke-${Date.now()}`;
  await page.getByPlaceholder("Bucket name").fill(bucketName);
  await page.getByRole("button", { name: "Create bucket" }).click();
  await expect(page.getByText(bucketName), requests.join("\n")).toBeVisible();
  await page.getByRole("button", { name: "Accounts" }).click();
  await expect(page).toHaveURL(/page=accounts/);
  await page.getByPlaceholder("Display name").fill("ui-smoke-account");
  await page.getByRole("button", { name: "Issue access key" }).click();
  await expect(page.getByText("Secret key")).toBeVisible();
  const accessKeyTable = page.locator("section table");
  await expect(accessKeyTable.locator("thead th").nth(0)).toHaveText("Name");
  await expect(accessKeyTable.locator("thead th").nth(1)).toHaveText("Access key");
  expect(new URL(page.url()).searchParams.get("page")).toBe("accounts");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/page=accounts/);
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await page.route("**/admin/accounts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          accountId: "ui-account-1",
          externalId: "oidc:ui-account-1",
          displayName: "UI test account",
          quotaBytes: 0,
        },
      ]),
    });
  });
  await page.route("**/admin/accounts/ui-account-1/quota", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ quotaBytes: 1048576 });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.getByRole("button", { name: "Allocations" }).click();
  await expect(page.getByRole("heading", { name: "Storage allocations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allocations" })).toHaveClass(/nav-item-active/);
  await page.getByRole("spinbutton").fill("1048576");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Account quota saved.")).toBeVisible();
  await page.route("**/admin/oidc/api-tokens", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      label: "ui-smoke-token",
      scopes: ["s3:provision"],
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        token: "one-time-ui-token",
        label: "ui-smoke-token",
        scopes: ["s3:provision"],
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
    });
  });
  await page.getByRole("button", { name: "OIDC tokens" }).click();
  await expect(page.getByRole("heading", { name: "Issue OIDC API token" })).toBeVisible();
  await expect(page.getByRole("button", { name: "OIDC tokens" })).toHaveClass(/nav-item-active/);
  await page.getByPlaceholder("Filebin provisioning").fill("ui-smoke-token");
  await page.getByRole("button", { name: "Generate token" }).click();
  await expect(page.getByText("one-time-ui-token")).toBeVisible();
  await page.getByRole("button", { name: "Users" }).click();
  await expect(page.getByRole("button", { name: "Users" })).toHaveClass(/nav-item-active/);
  const userId = `ui-smoke-role-${Date.now()}`;
  await page.getByPlaceholder("User subject ID").fill(userId);
  await page.getByPlaceholder("user@example.com").fill("ui-role@example.com");
  await page.getByPlaceholder("Display name").fill("UI Role User");
  await page.getByRole("combobox").selectOption("operator");
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByText(userId)).toBeVisible();
  const removal = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && response.url().endsWith(`/admin/users/${userId}`),
  );
  await page
    .getByRole("row", { name: new RegExp(userId) })
    .getByRole("button", { name: "Remove" })
    .click();
  expect((await removal).status()).toBe(204);
  expect(
    await (
      await page.request.get("/admin/users", {
        headers: { Authorization: "Bearer dev-admin" },
      })
    ).json(),
  ).not.toEqual(expect.arrayContaining([expect.objectContaining({ userId })]));
  await expect(page).toHaveURL(/page=users/);
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByText(userId)).toHaveCount(0);
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  expect([...errors, ...failedResponses]).toEqual([]);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator(".topbar-profile")).toBeVisible();
  await expect(page.locator(".mobile-brand")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("aside.control-sidebar-open")).toBeVisible();
  await page.getByRole("button", { name: "Close navigation overlay" }).click({ position: { x: 300, y: 200 } });
  await expect(page.locator("aside.control-sidebar-open")).toHaveCount(0);
  for (const [pageName, heading, menuItem] of [
    ["accounts", "Accounts", "Accounts"],
    ["allocations", "Storage allocations", "Allocations"],
    ["users", "Users", "Users"],
    ["tokens", "Issue OIDC API token", "OIDC tokens"],
  ]) {
    await page.goto(`/admin?page=${pageName}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("aside button").filter({ hasText: menuItem })).toHaveClass(/nav-item-active/);
    if (pageName === "accounts") {
      await page.screenshot({
        path: "test-results/dashboard-mobile-accounts.png",
        fullPage: true,
      });
    }
    const width = await page.evaluate(() => ({
      viewport: globalThis.document.documentElement.clientWidth,
      content: globalThis.document.documentElement.scrollWidth,
    }));
    expect(width.content, `${pageName} overflows the mobile viewport`).toBeLessThanOrEqual(width.viewport);
  }
});

test("direct logout clears the session and offers a fresh sign-in", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const response = await page.goto("/auth/logout");
  expect(response?.status(), await response?.text()).toBe(200);
  await expect(page.getByRole("heading", { name: "You’re signed out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/admin/login");
  await expect(page.locator('link[rel="stylesheet"][href="/admin/tailwind.css"]')).toHaveCount(1);
  const width = await page.evaluate(() => ({
    viewport: globalThis.document.documentElement.clientWidth,
    content: globalThis.document.documentElement.scrollWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport);
});
