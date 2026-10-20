import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Access your BugHuntr vulnerability research and bounty coordination portal.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
