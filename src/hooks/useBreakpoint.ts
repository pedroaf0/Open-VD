import { useEffect, useState } from "react";

/** Breakpoints: desktop ≥1024px, tablet 768–1023px, mobile <768px. */
export function useBreakpoint() {
  const [bp, setBp] = useState<"mobile" | "tablet" | "desktop">(() =>
    typeof window === "undefined"
      ? "desktop"
      : window.innerWidth < 768
        ? "mobile"
        : window.innerWidth < 1024
          ? "tablet"
          : "desktop",
  );
  useEffect(() => {
    const onResize = () =>
      setBp(window.innerWidth < 768 ? "mobile" : window.innerWidth < 1024 ? "tablet" : "desktop");
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { isMobile: bp === "mobile", isTablet: bp === "tablet", isDesktop: bp === "desktop" };
}
