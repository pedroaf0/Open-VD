/**
 * Plugin active test module.
 * Verifies the v-dicom plugin is active in WordPress.
 */
import { expect } from "@playwright/test";

export const name = "plugin-active";
export const description = "Verifica se o plugin v-dicom está ativo";
export const order = 20;

export async function run(page, config) {
  const { WP_URL } = config;

  await page.goto(`${WP_URL}/wp-admin/plugins.php`);

  const pluginRow = page.locator('tr[data-plugin="v-dicom/v-dicom.php"]');
  await expect(pluginRow).toBeVisible({ timeout: 5000 });

  const activateLink = pluginRow.locator('a[href*="action=activate"]');
  if (await activateLink.count() > 0) {
    console.log("  ⚠ Plugin v-dicom encontrado mas inativo — ativando...");
    await activateLink.click();
    await page.waitForSelector(".updated, .notice-success", { timeout: 5000 });
    console.log("  ✓ Plugin ativado");
  } else {
    console.log("  ✓ Plugin v-dicom está ativo");
  }
}