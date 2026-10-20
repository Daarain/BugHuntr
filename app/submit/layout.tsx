import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Submit Vulnerability Report",
  description: "Submit a newly discovered security bug, reproduction steps, and proof of concept.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
