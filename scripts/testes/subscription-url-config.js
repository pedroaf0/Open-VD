/**
 * Admin test module: configure the subscription URL (URL para assinatura).
 *
 * The value is saved through the "Configurações gerais" form and re-read after
 * the redirect to prove it persisted.
 */
import { expect } from "@playwright/test";
import { ensureLoggedIn } from "./test-helpers.mjs";

export const name = "subscription-url-config";
export const description = "Define e confirma URL de assinatura no WP Admin";
export const order = 38;

export const TEST_SUBSCRIPTION_URL = "https://example.com/assinatura?callback={{callback}}";

export async function run(page, config) {
  const { WP_URL } = config;

  await ensureLoggedIn(page, config);
  console.log("  ✓ Sessão admin ativa");

  await page.goto(`${WP_URL}/wp-admin/admin.php?page=v-dicom-settings`);
  await page.waitForLoadState("networkidle");

  const form = page.locator("form:has(#v-dicom-recording-name-pattern)").first();
  await expect(form).toBeVisible({ timeout: 10000 });

  // --- Subscription URL ---
  const urlInput = form.locator("#v-dicom-subscription-url");
  await expect(urlInput).toBeVisible({ timeout: 5000 });

  const previousUrl = await urlInput.inputValue();
  console.log(`  🔗 URL de assinatura atual: ${previousUrl || "(vazio)"}`);

  await urlInput.fill(TEST_SUBSCRIPTION_URL);

  // Keep the other general settings enabled when this form is submitted.
  await form.locator("#v-dicom-direct-dicom-enabled").check();
  await form.locator("#v-dicom-public-loading-enabled").check();

  await Promise.all([
    page.waitForURL(/generalsaved=1/, { timeout: 30000 }),
    form.locator('input[type="submit"], button[type="submit"]').first().click(),
  ]);
  await page.waitForLoadState("networkidle");

  // Re-read after the redirect: the field must contain the saved value.
  await expect(page.locator("#v-dicom-subscription-url")).toHaveValue(
    TEST_SUBSCRIPTION_URL,
    { timeout: 5000 },
  );

  globalThis.__TEST_SUBSCRIPTION_URL__ = TEST_SUBSCRIPTION_URL;

  console.log(`  ✓ URL de assinatura salva e persistida: ${TEST_SUBSCRIPTION_URL}`);

  return {
    url: TEST_SUBSCRIPTION_URL,
    previousUrl,
  };
}