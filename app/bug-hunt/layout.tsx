import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bug Bounty Programs",
  description: "Participate in active bug bounty programs, secure attack surfaces, and earn rewards.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
