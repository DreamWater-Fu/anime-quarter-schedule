import type { ReactNode } from "react";

import "./globals.css";

export const metadata = {
  title: "日本季度新番更新时间表",
  description: "本地优先的日本季度新番更新时间表工具",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
