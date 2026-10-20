import type React from "react";
import type { Metadata } from "next";
import ClientLayout from "./ClientLayout";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://bughuntr.io"
  ),
  title: {
    default: "BugHuntr — Crowdsourced Cybersecurity & Bug Bounty Platform",
    template: "%s | BugHuntr",
  },
  description:
    "Next-generation crowdsourced vulnerability discovery, coordinated disclosure, and cybersecurity bounty platform for security researchers and enterprises.",
  keywords: [
    "bug bounty",
    "cybersecurity",
    "vulnerability disclosure",
    "ethical hacking",
    "infosec",
    "security researcher",
  ],
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    title: "BugHuntr — Crowdsourced Cybersecurity & Bug Bounty Platform",
    description:
      "Empowering security researchers and organizations to discover, report, and remediate vulnerabilities securely.",
    siteName: "BugHuntr",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BugHuntr — Crowdsourced Cybersecurity & Bug Bounty Platform",
    description:
      "Empowering security researchers and organizations to discover, report, and remediate vulnerabilities securely.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ClientLayout>{children}</ClientLayout>;
}
