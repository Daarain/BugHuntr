import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Request a password reset link for your BugHuntr account.",
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
