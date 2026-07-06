import type { Metadata } from "next";
import { Fira_Code, Inter } from "next/font/google";
import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DataFoundry",
    template: "%s · DataFoundry",
  },
  description: "Agent-driven data task workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${firaCode.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
