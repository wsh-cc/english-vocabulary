import type { Metadata } from "next";
import "./globals.css";
import "./auth.css";
import "./browse.css";
import { AppearanceProvider } from './theme';

export const metadata: Metadata = {
  title: "词间 · 四六级语境学习",
  description: "通过语境、主动回忆和延后复习学习四六级词汇。",
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
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased"><AppearanceProvider>{children}</AppearanceProvider></body>
    </html>
  );
}
