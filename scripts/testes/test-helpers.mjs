/**
 * Shared helpers for the Playwright test modules.
 *
 * Kept as `.mjs` on purpose: the runner only loads `*.js` files from
 * `scripts/testes/`, so this module is never executed as a test by itself.
 */
import fs from "node:fs";
import { expect } from "@playwright/test";

export const SCENE_FILE = "test-scene-key.json";

/** Read the scene key produced by upload-comprehensive / share-scene. */
export function readSceneKey() {
  try {
    const data = JSON.parse(fs.readFileSync(SCENE_FILE, "utf8"));
    return typeof data.sceneKey === "string" && data.sceneKey ? data.sceneKey : null;
  } catch {
    return null;
  }
}

/** Persist the scene key so later test modules can reuse the scene. */
export function writeSceneKey(sceneKey) {
  fs.writeFileSync(SCENE_FILE, JSON.stringify({ sceneKey }));
}

/** Remove the scene key file after the scene has been deleted. */
export function clearSceneKey() {
  try {
    fs.unlinkSync(SCENE_FILE);
  } catch {
    /* already absent */
  }
}

export function restSceneUrl(WP_URL, sceneKey) {
  return `${WP_URL}/wp-json/v-dicom/v1/scenes/${sceneKey}`;
}

/**
 * Ensure the browser context is authenticated in wp-admin.
 * Reuses an existing session when the context already has cookies.
 */
export async function ensureLoggedIn(page, config) {
  const { WP_URL, WP_USER, WP_PASS } = config;

  await page.goto(`${WP_URL}/wp-admin/`);
  await page.waitForLoadState("domcontentloaded");

  if (/wp-login\.php/.test(page.url())) {
    await page.fill("#user_login", WP_USER);
    await page.fill("#user_pass", WP_PASS);
    await page.click("#wp-submit");
    await page.waitForURL(/\/wp-admin\//, { timeout: 15000 });
  }
}

/**
 * Wait until the viewer has rendered at least `minCanvases` canvases.
 *
 * `page.waitForFunction(fn, options)` does NOT accept options as its second
 * argument — the second argument is the function argument. The options object
 * must come third (or the function must receive the threshold as its arg).
 */
export async function waitForViewerReady(page, minCanvases = 4, timeout = 180000) {
  await page.waitForSelector("#v-dicom-root", { state: "visible", timeout: 15000 });
  await page.waitForFunction(
    (minimum) => document.querySelectorAll("canvas").length >= minimum,
    minCanvases,
    { timeout },
  );
}

/**
 * Make sure the parameters panel is open.
 * On desktop it starts open (window.innerWidth >= 1024), so blindly clicking
 * the header toggle would close it. Returns true when the panel was opened.
 */
export async function ensurePanelOpen(page) {
  const aside = page.locator("aside[aria-label]").first();
  if ((await aside.count()) > 0 && (await aside.isVisible().catch(() => false))) {
    return false;
  }

  const toggle = page.locator("header button:has(svg.lucide-panel-right-open)").first();
  await expect(toggle).toBeVisible({ timeout: 5000 });
  await toggle.click();
  await expect(aside).toBeVisible({ timeout: 5000 });
  return true;
}

/**
 * Expand a collapsible panel section (e.g. "Modelos" / "Anotações").
 * Sections render their header as the first button inside the <section>.
 */
export async function openSection(page, title) {
  const section = page
    .locator("aside section")
    .filter({ has: page.locator(`.group-title:text-is("${title}")`) })
    .first();
  await expect(section).toBeAttached({ timeout: 15000 });

  const header = section.locator("button").first();
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
  }
  return section;
}

/**
 * Switch the viewer to annotation mode using the header segmented control.
 * The rail then exposes the annotation tools (Cursor, Régua, Seta, ...).
 */
export async function ensureAnnotationMode(page) {
  const group = page.locator('header [role="group"]').first();
  await expect(group).toBeVisible({ timeout: 5000 });

  const annButton = group.getByRole("button", { name: "Anotação", exact: true });
  await expect(annButton).toBeAttached({ timeout: 5000 });
  if ((await annButton.getAttribute("aria-pressed")) !== "true") {
    await annButton.click();
    await expect(annButton).toHaveAttribute("aria-pressed", "true");
  }

  const rail = page.locator("nav[aria-label]").first();
  await expect(rail.locator('button[aria-label="Régua"]')).toBeVisible({ timeout: 5000 });
  return rail;
}

/** Get a valid `wp_rest` nonce for the authenticated browser context. */
export async function getRestNonce(page, WP_URL) {
  // Core exposes a `rest-nonce` action through admin-ajax for logged-in users.
  const response = await page.request.get(
    `${WP_URL}/wp-admin/admin-ajax.php?action=rest-nonce`,
  );
  if (response.ok()) {
    const text = (await response.text()).trim();
    if (/^[a-f0-9]{8,12}$/i.test(text)) return text;
  }

  const fromPage = await page.evaluate(() => window.wpApiSettings?.nonce ?? null);
  if (fromPage) return fromPage;

  const html = await page.content();
  const inline = html.match(/var\s+nonce\s*=\s*["']([a-f0-9]+)["']/i);
  return inline ? inline[1] : null;
}

/** Create a brand-new browser context/page with no WordPress cookies. */
export async function createAnonymousPage(page) {
  const browser = page.context().browser();
  if (!browser) throw new Error("Navegador indisponível para criar contexto anônimo");

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const anonymousPage = await context.newPage();
  return { context, page: anonymousPage };
}
