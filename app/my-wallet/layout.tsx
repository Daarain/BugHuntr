import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bounty Wallet",
  description: "View your earned bounty rewards, manage payout addresses, and track transaction history.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
