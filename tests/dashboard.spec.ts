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
  const brand = sidebar.getByText("s3mini.");
  await expect(brand).toBeVisible();
  await expect(brand).toHaveClass(/text-2xl/);
  await expect(brand).toHaveClass(/font-black/);
  const userCard = page.getByRole("group", { name: "Signed-in user" });
  await expect(userCard).toBeVisible();
  await expect(userCard.getByText("H", { exact: true })).toBeVisible();
  await expect(userCard.getByText("Administrator", { exact: true })).toBeVisible();
  await expect(page.getByText("Workspace S3MINI")).toHaveCount(0);
  const firstOverviewCard = page.locator("main section .grid > div").first();
  const lightCardBackground = await firstOverviewCard.evaluate((element) => getComputedStyle(element).backgroundColor);
  const topbarBounds = await page.locator("main > header").boundingBox();
  const profileBounds = await userCard.boundingBox();
  expect(topbarBounds?.height).toBeLessThanOrEqual(64);
  expect(profileBounds).not.toBeNull();
  expect(profileBounds!.x + profileBounds!.width).toBeGreaterThan(1100);
  expect(await page.locator("main > header").evaluate((element) => getComputedStyle(element).paddingRight)).toBe("0px");
  expect(await userCard.evaluate((element) => getComputedStyle(element).paddingRight)).toBe("16px");
  expect(profileBounds!.x + profileBounds!.width).toBe(topbarBounds!.x + topbarBounds!.width);
  const themeToggle = page.getByRole("button", { name: "Toggle light and dark theme" });
  await expect(themeToggle).toHaveClass(/rounded-full/);
  await expect(themeToggle).toHaveClass(/border/);
  await page.getByRole("button", { name: "Toggle light and dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect
    .poll(() => page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(12, 20, 16)");
  await expect
    .poll(() => sidebar.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(12, 20, 16)");
  await expect
    .poll(() => page.locator("main > div").evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(24, 35, 27)");
  await expect
    .poll(() =>
      page.getByRole("button", { name: "Dashboard" }).evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe("oklch(1 0 0)");
  expect(await firstOverviewCard.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    lightCardBackground,
  );
  await page.screenshot({
    path: "test-results/dashboard-dark-theme.png",
    fullPage: true,
  });
  expect(await page.evaluate(() => localStorage.getItem("s3mini-theme"))).toBe("dark");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Toggle light and dark theme" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
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
  await expect(dashboardLink).toHaveClass(/cursor-pointer/);
  await expect(dashboardLink).toHaveClass(/border-brand/);
  await expect(dashboardLink).toHaveClass(/rounded-lg/);
  await expect(dashboardLink).toHaveClass(/text-brand/);
  const navigationButtons = page.locator("aside nav button");
  await expect(navigationButtons).toHaveCount(6);
  for (const navigationButton of await navigationButtons.all()) {
    await expect(navigationButton).toHaveClass(/cursor-pointer/);
  }
  const desktopLayout = await page.evaluate(() => {
    const sidebar = globalThis.document.querySelector("aside")!.getBoundingClientRect();
    const main = globalThis.document.querySelector("main")!.getBoundingClientRect();
    return {
      sidebarRight: sidebar.right,
      sidebarWidth: sidebar.width,
      mainLeft: main.left,
      mainWidth: main.width,
    };
  });
  expect(desktopLayout.sidebarRight).toBe(desktopLayout.mainLeft);
  expect(desktopLayout.sidebarWidth).toBe(256);
  expect(desktopLayout.mainWidth).toBeGreaterThan(900);
  await page.screenshot({
    path: "test-results/dashboard-overview.png",
    fullPage: true,
  });
  const photoUrl = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
  await page.route("**/admin/profile", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        name: "Homebots Inc",
        email: "homebots.inc@gmail.com",
        photo: photoUrl,
        role: "admin",
      }),
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(userCard.getByText("Homebots Inc", { exact: true })).toBeVisible();
  await expect(userCard.getByText("homebots.inc@gmail.com", { exact: true })).toBeVisible();
  const profilePhoto = userCard.locator("img");
  await expect(profilePhoto).toHaveAttribute("src", photoUrl);
  await expect(profilePhoto).toBeVisible();
  await expect.poll(() => profilePhoto.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(userCard.getByText("H", { exact: true })).toBeHidden();
  await page.unroute("**/admin/profile");
  await page.reload({ waitUntil: "networkidle" });
  await expect(userCard.getByText("H", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Buckets" }).click();
  await expect(page.getByRole("heading", { name: "Buckets" })).toBeVisible();
  const bucketSearch = page.getByPlaceholder("Search");
  const bucketForm = page.locator("section form").first();
  const searchBounds = await bucketSearch.boundingBox();
  const formBounds = await bucketForm.boundingBox();
  expect(searchBounds).not.toBeNull();
  expect(formBounds).not.toBeNull();
  expect(searchBounds!.x).toBeLessThan(formBounds!.x);
  expect(await bucketForm.evaluate((form) => getComputedStyle(form.parentElement!).justifyContent)).toBe(
    "space-between",
  );
  await page.screenshot({
    path: "test-results/dashboard-buckets-layout.png",
    fullPage: true,
  });
  const bucketName = `ui-smoke-${Date.now()}`;
  await page.getByPlaceholder("Bucket name").fill(bucketName);
  await page.getByRole("button", { name: "Create bucket" }).click();
  await expect(page.getByText(bucketName), requests.join("\n")).toBeVisible();
  await bucketSearch.fill(bucketName);
  await expect(page.getByText(bucketName)).toBeVisible();
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
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.getByRole("button", { name: "Allocations" }).click();
  await expect(page.getByRole("heading", { name: "Storage allocations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allocations" })).toHaveClass(/border-brand/);
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
  await expect(page.getByRole("button", { name: "OIDC tokens" })).toHaveClass(/border-brand/);
  await page.getByPlaceholder("Filebin provisioning").fill("ui-smoke-token");
  await page.getByRole("button", { name: "Generate token" }).click();
  await expect(page.getByText("one-time-ui-token")).toBeVisible();
  await page.getByRole("button", { name: "Users" }).click();
  await expect(page.getByRole("button", { name: "Users" })).toHaveClass(/border-brand/);
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
  const mobileUserCard = page.getByRole("group", { name: "Signed-in user" });
  await expect(mobileUserCard).toBeVisible();
  expect(await mobileUserCard.evaluate((element) => getComputedStyle(element).paddingRight)).toBe("6px");
  const mobileCardBounds = await mobileUserCard.boundingBox();
  const mobileTopbarBounds = await page.locator("main > header").boundingBox();
  expect(mobileCardBounds).not.toBeNull();
  expect(mobileTopbarBounds).not.toBeNull();
  expect(mobileCardBounds!.x).toBeGreaterThan(100);
  expect(mobileCardBounds!.x + mobileCardBounds!.width).toBe(mobileTopbarBounds!.x + mobileTopbarBounds!.width);
  await expect(page.locator("main > header strong")).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("aside")).toBeVisible();
  await page.getByRole("button", { name: "Close navigation overlay" }).click({ position: { x: 300, y: 200 } });
  await expect(page.locator("aside")).toBeHidden();
  for (const [pageName, heading, menuItem] of [
    ["accounts", "Accounts", "Accounts"],
    ["allocations", "Storage allocations", "Allocations"],
    ["users", "Users", "Users"],
    ["tokens", "Issue OIDC API token", "OIDC tokens"],
  ]) {
    await page.goto(`/admin?page=${pageName}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("aside button").filter({ hasText: menuItem })).toHaveClass(/border-brand/);
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
