import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Submissions",
  description: "Track status, review notes, CVSS ratings, and bounty payouts for your submitted reports.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
