import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vulnerability Feed",
  description: "Explore public vulnerability disclosures, CVE advisories, and cybersecurity research.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
