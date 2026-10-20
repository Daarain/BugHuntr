import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Register as an ethical researcher or organization on BugHuntr.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
