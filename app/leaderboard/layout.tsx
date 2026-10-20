import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Global Leaderboard",
  description: "Top security researchers, rankings, points, and verified disclosures on BugHuntr.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
