import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: string }>;
};

/**
 * Registers the service worker. Inside WordPress the plugin serves it at
 * /v-dicom/sw.js; standalone builds expect /sw.js at the origin root.
 * Failures are silent — the app works fine without a service worker.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const inWp = !!window.V_DICOM;
  const url = inWp ? "/v-dicom/sw.js" : "/sw.js";
  const register = () => {
    navigator.serviceWorker.register(url).catch(() => {});
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** Tracks the browser install prompt so the UI can offer an install button. */
export function useInstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    () =>
      typeof window !== "undefined" && !!window.matchMedia?.("(display-mode: standalone)").matches,
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!evt) return;
    try {
      await evt.prompt();
    } finally {
      setEvt(null);
    }
  };

  return { canInstall: !!evt && !installed, installed, install };
}
