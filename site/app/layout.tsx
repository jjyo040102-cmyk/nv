import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ActFlow — Work, moving forward",
  description: "A workspace for reviewed tasks and verified results.",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
