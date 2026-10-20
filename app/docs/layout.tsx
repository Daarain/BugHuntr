import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation & Academy",
  description: "Comprehensive guide to bug hunting, responsible disclosure, and platform guidelines.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
