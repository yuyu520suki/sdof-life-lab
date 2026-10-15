import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "有度 · 个人规划实验室",
  description: "在科研、休息与关系之间，安排有依据的每一天。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
