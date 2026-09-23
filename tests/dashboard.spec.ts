import { expect, test } from "@playwright/test";

test("dashboard boots, renders, and has no browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/admin", { waitUntil: "networkidle" });
  await expect(page.locator("control-plane-app")).toBeAttached();
  await expect(page.getByText("Overview")).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Buckets" }).click();
  await expect(page.getByRole("heading", { name: "Buckets" })).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  expect(errors).toEqual([]);
});
