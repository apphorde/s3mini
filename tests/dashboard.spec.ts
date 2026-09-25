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
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  expect([...errors, ...failedResponses]).toEqual([]);
});
