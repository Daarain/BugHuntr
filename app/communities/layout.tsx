import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security Communities",
  description: "Collaborate with ethical hackers, share security tips, and discuss vulnerability trends.",
};

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
