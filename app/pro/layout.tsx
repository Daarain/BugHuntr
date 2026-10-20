import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BugHuntr Pro",
  description: "Private bug bounty programs, exclusive invite-only targets, and enterprise protection.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
