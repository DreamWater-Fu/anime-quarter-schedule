import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";

import { PwaServiceWorker } from "@/src/app/components/PwaServiceWorker";
import "./globals.css";

const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? "");
const appTitle = "日本季度新番更新时间表";
const appDescription = "本地优先的日本季度新番更新时间表工具";

export const metadata: Metadata = {
  applicationName: appTitle,
  title: appTitle,
  description: appDescription,
  manifest: withBasePath("/manifest.webmanifest"),
  icons: {
    icon: [{ url: withBasePath("/icon.svg"), type: "image/svg+xml" }],
    apple: [{ url: withBasePath("/icons/apple-touch-icon.png"), sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    title: "新番时间表",
    statusBarStyle: "default"
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#006a6a",
  colorScheme: "light"
};

function withBasePath(path: string) {
  return `${basePath}${path}`;
}

function normalizeBasePath(path: string) {
  if (!path || path === "/") return "";
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <PwaServiceWorker />
        {children}
      </body>
    </html>
  );
}
