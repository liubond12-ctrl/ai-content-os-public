import type { Metadata } from "next";

import "./globals.css";
import "./home.css";
import "./workbench-scheme.css";
import Workspace from "@/components/Workspace";

export const dynamic="force-dynamic";
export const metadata: Metadata = {
  title: "AI Content OS",
  description: "个人内容创作工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body><Workspace real={process.env.STUDIO_PRODUCTION_SCOPE==="phase1-original-fiction"} demo={process.env.STUDIO_DEMO_INSTANCE==="1"}>{children}</Workspace></body>
    </html>
  );
}
