/**
 * Admin test module: configure the panel video filename pattern.
 *
 * The value is saved through the "Configurações gerais" form and re-read after
 * the redirect to prove it persisted. The video-recording module then asserts
 * that the downloaded file name follows this pattern.
 */
import { expect } from "@playwright/test";
import { ensureLoggedIn } from "./test-helpers.mjs";

export const name = "recording-name-pattern";
export const description = "Define e confirma o padrão do nome do vídeo do painel no WP Admin";
export const order = 35;

/** Padrão temporário usado pelo teste; restaurado no final da suíte. */
export const TEST_RECORDING_NAME_PATTERN = "teste-video-{timestamp}";

export async function run(page, config) {
  const { WP_URL } = config;

  await ensureLoggedIn(page, config);
  console.log("  ✓ Sessão admin ativa");

  await page.goto(`${WP_URL}/wp-admin/admin.php?page=v-dicom-settings`);
  await page.waitForLoadState("networkidle");

  const form = page.locator("form:has(#v-dicom-recording-name-pattern)").first();
  await expect(form).toBeVisible({ timeout: 10000 });

  const input = form.locator("#v-dicom-recording-name-pattern");
  await expect(input).toBeVisible({ timeout: 5000 });

  const previous = await input.inputValue();
  console.log(`  🏷 Padrão atual: ${previous || "(vazio)"}`);

  await input.fill(TEST_RECORDING_NAME_PATTERN);

  // Keep the other general settings enabled when this form is submitted.
  await form.locator("#v-dicom-direct-dicom-enabled").check();
  await form.locator("#v-dicom-public-loading-enabled").check();

  await Promise.all([
    page.waitForURL(/generalsaved=1/, { timeout: 30000 }),
    form.locator('input[type="submit"], button[type="submit"]').first().click(),
  ]);
  await page.waitForLoadState("networkidle");

  // Re-read after the redirect: the field must contain the saved value.
  await expect(page.locator("#v-dicom-recording-name-pattern")).toHaveValue(
    TEST_RECORDING_NAME_PATTERN,
    { timeout: 5000 },
  );

  globalThis.__TEST_RECORDING_NAME_PATTERN__ = TEST_RECORDING_NAME_PATTERN;
  console.log(`  ✓ Padrão salvo e persistido: ${TEST_RECORDING_NAME_PATTERN}`);

  return { pattern: TEST_RECORDING_NAME_PATTERN, previous };
}
