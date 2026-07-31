"use client";

import { useEffect } from "react";

export function PwaServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? "");
    const workerUrl = `${basePath}/sw.js`;
    const scope = `${basePath || ""}/`;

    const register = () => {
      void navigator.serviceWorker.register(workerUrl, { scope }).catch((error) => {
        console.warn("PWA service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

function normalizeBasePath(basePath: string) {
  if (!basePath || basePath === "/") return "";
  return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
}
