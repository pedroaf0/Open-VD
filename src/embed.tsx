/**
 * Standalone entry used by the WordPress plugin.
 *
 * The plugin prints `<div id="v-dicom-root"></div>` plus a global
 * `window.V_DICOM` config object, then loads this bundle.
 */
import { createRoot } from "react-dom/client";
import { Viewer } from "@/components/Viewer";
import { initI18n } from "@/i18n";
import "./styles.css";

function mount() {
  const el = document.getElementById("v-dicom-root");
  if (!el) return;
  if (el.dataset["mounted"] === "1") return;
  el.dataset["mounted"] = "1";
  // Resolve the language (WordPress locale / browser) before the first render,
  // so the viewer never flashes the wrong language.
  initI18n();
  createRoot(el).render(<Viewer />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
