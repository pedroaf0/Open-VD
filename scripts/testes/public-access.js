/**
 * Public access test module.
 * Verifies a shared scene can be loaded in a brand-new browser context with
 * no WordPress authentication cookies.
 */
import { expect } from "@playwright/test";
import {
  createAnonymousPage,
  readSceneKey,
  restSceneUrl,
  waitForViewerReady,
} from "./test-helpers.mjs";

export const name = "public-access";
export const description = "Acesso público à cena compartilhada (sem login)";
export const order = 70;

export async function run(page, config) {
  const { WP_URL } = config;

  const sceneKey = readSceneKey();
  if (!sceneKey) {
    throw new Error(
      "Nenhuma chave de cena compartilhada disponível — teste share-scene deve rodar antes",
    );
  }
  console.log(`  📝 Usando cena: ${sceneKey}`);

  const publicUrl = `${WP_URL}/v-dicom/${sceneKey}/`;
  console.log(`  🔗 Acessando em contexto anônimo: ${publicUrl}`);

  const { context, page: anonymousPage } = await createAnonymousPage(page);

  try {
    // Sanity check: this context really has no logged-in WordPress session.
    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name.startsWith("wordpress_logged_in"))).toBe(false);
    console.log("  ✓ Contexto sem cookies de autenticação");

    // The public REST payload must be readable without any credentials.
    const apiResponse = await context.request.get(restSceneUrl(WP_URL, sceneKey));
    expect(apiResponse.status()).toBe(200);
    console.log("  ✓ API pública da cena responde 200");

    await anonymousPage.goto(publicUrl);
    await waitForViewerReady(anonymousPage, 4, 240000);
    console.log("  ✓ Cena pública carrega corretamente");

    const canvas3d = anonymousPage
      .locator('.viewport-frame:has(.plane-label:text-is("3D / STL")) canvas')
      .first();
    await expect(canvas3d).toBeVisible({ timeout: 5000 });
    console.log("  ✓ Viewport 3D renderizado");

    const sliceViews = await anonymousPage
      .locator(
        '.viewport-frame:has(.plane-label:has-text("Axial")), ' +
          '.viewport-frame:has(.plane-label:has-text("Coronal")), ' +
          '.viewport-frame:has(.plane-label:has-text("Sagital"))',
      )
      .count();
    expect(sliceViews).toBeGreaterThanOrEqual(3);
    console.log(`  ✓ ${sliceViews} viewport(s) MPR detectado(s) (Axial, Coronal, Sagital)`);

    const totalCanvases = await anonymousPage.locator("canvas").count();
    expect(totalCanvases).toBeGreaterThanOrEqual(4);
    console.log(`  ✓ ${totalCanvases} canvas total (3 MPR + 1 3D)`);

    // No WordPress admin chrome/links should leak into the public page.
    await expect(anonymousPage.locator("#wpadminbar")).toHaveCount(0);
    const adminLinks = await anonymousPage.locator('a[href*="/wp-admin/"]').count();
    expect(adminLinks).toBe(0);
    console.log("  ✓ Sem elementos de admin visíveis (acesso público correto)");

    return { publicUrl, sceneKey };
  } finally {
    await context.close();
  }
}
