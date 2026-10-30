import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = { title: "ActFlow AI", description: "정책과 증거를 갖춘 업무 워크플로" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body><AppShell>{children}</AppShell></body></html>;
}
