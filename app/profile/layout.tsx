import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Researcher Profile",
  description: "View verified vulnerability disclosures, security badges, and rank achievements.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
