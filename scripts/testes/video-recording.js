/**
 * 3D viewport video recording test module.
 *
 * Covers the record button next to the screenshot button, the red recording
 * indicator with its elapsed timer, the stop control, the preview modal with
 * playback and download, and starting a second recording after the first one
 * has been finalized (resource cleanup).
 *
 * Optional final verification screenshots are captured only when the runner is
 * invoked with `--screenshots` (disabled by default). The downloaded recording
 * is discarded by default; `--save-recording` keeps it in the project root.
 */
import { expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureLoggedIn, readSceneKey, waitForViewerReady } from "./test-helpers.mjs";

export const name = "video-recording";
export const description = "Gravação do viewport 3D: botão, indicador, prévia e download";
export const order = 85;

const VIEWPORT_3D = '.viewport-frame:has(.plane-label:text-is("3D / STL"))';
const STOP_LABEL = /Parar gravação|Stop Recording|Detener grabación/;
const DEFAULT_PATTERN = "openvd-3d-recording-{timestamp}";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Converte o padrão configurado no admin no nome de arquivo esperado. */
function recordingNamePatternToRegExp(pattern) {
  const template =
    (pattern || DEFAULT_PATTERN).replace(/\.(?:mp4|webm)\s*$/i, "").trim() || DEFAULT_PATTERN;
  const hasTimestamp = /\{timestamp\}/i.test(template);
  const hasDate = /\{data\}/i.test(template);
  const hasTime = /\{hora\}/i.test(template);
  let source = template
    .split(/(\{timestamp\}|\{data\}|\{hora\})/i)
    .map((part) => {
      if (/^\{timestamp\}$/i.test(part)) return "\\d{8}-\\d{6}";
      if (/^\{data\}$/i.test(part)) return "\\d{8}";
      if (/^\{hora\}$/i.test(part)) return "\\d{6}";
      return escapeRegExp(part);
    })
    .join("");
  if (!hasTimestamp) {
    if (!hasDate && !hasTime) source += "-\\d{8}-\\d{6}";
    else if (!hasTime) source += "-\\d{6}";
    else if (!hasDate) source += "-\\d{8}";
  }
  return new RegExp(`^${source}\\.(webm|mp4)$`);
}

function screenshotDir() {
  const dir = path.join(process.cwd(), "test-results", "final");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function capture(page, config, fileName, locator = null) {
  if (!config.ENABLE_SCREENSHOTS) return;
  const target = path.join(screenshotDir(), fileName);
  if (locator) {
    await locator.screenshot({ path: target });
  } else {
    await page.screenshot({ path: target, fullPage: true });
  }
  console.log(`  📸 Screenshot salvo: ${target}`);
}

async function waitForVideoMetadata(page) {
  await page.waitForFunction(
    () => {
      const video = document.querySelector('[role="dialog"] video');
      return !!video && video.readyState >= 1 && video.videoWidth > 0;
    },
    null,
    { timeout: 20000 },
  );
}

export async function run(page, config) {
  const { WP_URL } = config;

  const sceneKey = readSceneKey();
  if (!sceneKey) {
    throw new Error("Nenhuma cena disponível — testes de upload/share devem rodar antes");
  }
  console.log(`  📝 Usando cena: ${sceneKey}`);

  // O módulo recording-name-pattern define este global na suíte completa.
  // Quando este teste roda isolado, lê o padrão efetivamente salvo no admin.
  let configuredPattern = globalThis.__TEST_RECORDING_NAME_PATTERN__;
  if (!configuredPattern) {
    await ensureLoggedIn(page, config);
    await page.goto(`${WP_URL}/wp-admin/admin.php?page=v-dicom-settings`);
    await page.waitForLoadState("networkidle");
    const patternInput = page.locator("#v-dicom-recording-name-pattern");
    await expect(patternInput).toBeVisible({ timeout: 10000 });
    configuredPattern = (await patternInput.inputValue()).trim() || DEFAULT_PATTERN;
    console.log(`  🏷 Padrão configurado no admin: ${configuredPattern}`);
  }

  await page.goto(`${WP_URL}/v-dicom/${sceneKey}/`);
  await waitForViewerReady(page, 4, 240000);

  const frame = page.locator(VIEWPORT_3D).first();
  await expect(frame).toBeVisible({ timeout: 15000 });

  const screenshotBtn = frame.locator("button:has(svg.lucide-camera)").first();
  const recordBtn = frame.locator("button:has(svg.lucide-video)").first();
  await expect(screenshotBtn).toBeVisible({ timeout: 10000 });
  await expect(recordBtn).toBeVisible({ timeout: 10000 });

  // ============================================================
  // TEST 1: record button sits next to the screenshot button with
  // the same size and visual treatment.
  // ============================================================
  const cameraBox = await screenshotBtn.boundingBox();
  const recordBox = await recordBtn.boundingBox();
  expect(cameraBox).toBeTruthy();
  expect(recordBox).toBeTruthy();
  expect(Math.abs(recordBox.width - cameraBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(recordBox.height - cameraBox.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(recordBox.y - cameraBox.y)).toBeLessThanOrEqual(1);
  expect(recordBox.x).toBeGreaterThan(cameraBox.x);
  const gap = recordBox.x - (cameraBox.x + cameraBox.width);
  expect(gap).toBeGreaterThanOrEqual(2);
  expect(gap).toBeLessThanOrEqual(12);

  const [cameraStyle, recordStyle] = await Promise.all(
    [screenshotBtn, recordBtn].map((button) =>
      button.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          borderColor: style.borderTopColor,
          borderRadius: style.borderTopLeftRadius,
        };
      }),
    ),
  );
  expect(recordStyle).toEqual(cameraStyle);
  console.log(
    `  🎥 Botão de gravação ao lado do screenshot (${recordBox.width}×${recordBox.height}px, gap ${gap}px)`,
  );

  await capture(page, config, "video-recording-01-initial.png");
  await capture(page, config, "video-recording-01-initial-viewport.png", frame);

  // ============================================================
  // TEST 2: start recording — stop icon/text + red indicator + timer.
  // ============================================================
  await recordBtn.click();

  const stopBtn = frame.locator("button:has(svg.lucide-square)").first();
  await expect(stopBtn).toBeVisible({ timeout: 10000 });
  await expect(stopBtn).toContainText(STOP_LABEL);

  const indicator = frame.locator('[role="status"][aria-label]').first();
  await expect(indicator).toBeVisible({ timeout: 5000 });
  // Tailwind v4 emits oklch(); Chrome exposes the computed value as lab(...),
  // so assert the utility class and that the background is not transparent
  // instead of pinning a single color-space serialization.
  await expect(indicator).toHaveClass(/bg-red-600/);
  const indicatorBackground = await indicator.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(indicatorBackground).not.toMatch(/^(transparent|rgba?\(0,\s*0,\s*0,\s*0\))$/);
  const timer = indicator.locator("span.tabular-nums").first();
  await expect(timer).toHaveText(/^\d{2}:\d{2}$/);

  const indicatorBox = await indicator.boundingBox();
  expect(indicatorBox).toBeTruthy();
  expect(indicatorBox.x).toBeLessThan(cameraBox.x);
  expect(indicatorBox.y).toBeGreaterThan(cameraBox.y);

  const firstElapsed = await timer.textContent();
  await page.waitForTimeout(1500);
  await expect(timer).not.toHaveText(firstElapsed ?? "", { timeout: 5000 });

  const stopBox = await stopBtn.boundingBox();
  expect(stopBox).toBeTruthy();
  expect(stopBox.width).toBeGreaterThan(cameraBox.width);
  console.log(`  ⏺ Gravação ativa (${firstElapsed} → ${await timer.textContent()})`);
  await capture(page, config, "video-recording-02-active.png");
  await capture(page, config, "video-recording-02-active-viewport.png", frame);

  // ============================================================
  // TEST 3: stop finalizes the video and opens the preview modal.
  // ============================================================
  await stopBtn.click();

  const dialog = page.locator('[role="dialog"]:has(video)').first();
  await expect(dialog).toBeVisible({ timeout: 20000 });
  const video = dialog.locator("video").first();
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("src", /^blob:/);
  await waitForVideoMetadata(page);

  const metadata = await video.evaluate((element) => ({
    width: element.videoWidth,
    height: element.videoHeight,
  }));
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.height).toBeGreaterThan(0);
  console.log(`  🎬 Prévia aberta (${metadata.width}×${metadata.height})`);
  await capture(page, config, "video-recording-03-preview.png");

  // ============================================================
  // TEST 4: download the recorded file.
  // ============================================================
  const downloadPromise = page.waitForEvent("download");
  await dialog.locator("button:has(svg.lucide-download)").first().click();
  const download = await downloadPromise;
  const fileName = download.suggestedFilename();

  // The name must follow the pattern configured in WP Admin by
  // recording-name-pattern (defaults to openvd-3d-recording-{timestamp}).
  const expectedName = recordingNamePatternToRegExp(configuredPattern);
  expect(fileName).toMatch(expectedName);
  console.log(`  🏷 Nome seguiu o padrão do admin: ${configuredPattern}`);

  // MP4/H.264 is preferred; WebM remains the fallback for browsers that do
  // not expose an MP4 encoder through MediaRecorder (e.g. Firefox).
  const supportsMp4 = await page.evaluate(
    () =>
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("video/mp4;codecs=avc1.42E01E"),
  );
  if (supportsMp4) {
    expect(fileName).toMatch(/\.mp4$/);
  }
  console.log(`  🎞 Formato gravado: ${fileName.split(".").pop()?.toUpperCase()}`);

  const keepRecording = config.SAVE_RECORDING === true;
  const tmpRoot = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const projectRoot = config.PROJECT_ROOT || process.cwd();
  const downloadedPath = keepRecording
    ? path.join(projectRoot, fileName)
    : path.join(tmpRoot, `video-download-${Date.now()}-${fileName}`);
  await download.saveAs(downloadedPath);
  const size = fs.statSync(downloadedPath).size;
  expect(size).toBeGreaterThan(1000);
  if (keepRecording) {
    console.log(`  💾 Vídeo salvo na raiz do projeto: ${downloadedPath}`);
  } else {
    fs.rmSync(downloadedPath, { force: true });
  }
  console.log(`  ⬇ Download do vídeo validado: ${fileName} (${size} bytes)`);

  // ============================================================
  // TEST 5: close the modal and prove the recorder can be reused
  // (stream tracks and object URL were released).
  // ============================================================
  await dialog.locator("button.btn-chip").first().click();
  await expect(dialog).not.toBeVisible({ timeout: 5000 });

  const recordAgain = frame.locator("button:has(svg.lucide-video)").first();
  await expect(recordAgain).toBeVisible({ timeout: 10000 });
  await recordAgain.click();
  await page.waitForTimeout(1200);
  const stopAgain = frame.locator("button:has(svg.lucide-square)").first();
  await expect(stopAgain).toBeVisible({ timeout: 10000 });
  await stopAgain.click();

  const secondDialog = page.locator('[role="dialog"]:has(video)').first();
  await expect(secondDialog).toBeVisible({ timeout: 20000 });
  await secondDialog.locator("button.btn-chip").first().click();
  await expect(secondDialog).not.toBeVisible({ timeout: 5000 });
  console.log("  🔁 Segunda gravação iniciada/encerrada (recursos liberados)");

  console.log("  ✓ Todos os testes de gravação de vídeo passaram");
  return { passed: true, sceneKey, fileName, size };
}
