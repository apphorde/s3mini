import { expect, test } from "@playwright/test";

test("dashboard boots, renders, and has no browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push(request.method() + " " + request.url()),
  );
  page.on("response", (response) => {
    if (response.status() >= 500)
      failedResponses.push(response.status() + " " + response.url());
  });

  await page.goto("/admin", { waitUntil: "networkidle" });
  await expect(page.locator("control-plane-app")).toBeAttached();
  await expect(page.getByText("Overview")).toBeVisible();
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
  expect(new URL(page.url()).searchParams.get("page")).toBe("accounts");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/page=accounts/);
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await page.getByRole("button", { name: "Users" }).click();
  const userId = `ui-smoke-role-${Date.now()}`;
  await page.getByPlaceholder("User subject ID").fill(userId);
  await page.getByPlaceholder("user@example.com").fill("ui-role@example.com");
  await page.getByPlaceholder("Display name").fill("UI Role User");
  await page.getByRole("combobox").selectOption("operator");
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByText(userId)).toBeVisible();
  const removal = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith(`/admin/users/${userId}`),
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
});
