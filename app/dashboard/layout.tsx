import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security Dashboard",
  description: "Overview of your vulnerability discoveries, earnings, and active research operations.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
