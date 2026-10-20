"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth/auth-context";
import { RouteProtection } from "@/components/auth/route-protection";
import { CommunityProvider } from "@/hooks/use-community";
import { TopNavbar } from "@/components/navigation/top-navbar";
import { Sidebar } from "@/components/navigation/sidebar";
import { MobileNavigation } from "@/components/navigation/mobile-navigation";
import { useAuth } from "@/components/auth/auth-context";
import { usePathname } from "next/navigation";
import { SearchProvider } from "@/components/search/search-context";
import { Toaster } from "@/components/ui/sonner";

// Lazy-load the chatbot to improve initial page load
const BugHuntrAssistant = dynamic(
  () =>
    import("@/components/chatbot/bughuntr-assistant-clean").then((mod) => ({
      default: mod.BugHuntrAssistant,
    })),
  { ssr: false }
);

function InnerLayout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isLandingPage = pathname === "/";

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="flex min-h-screen max-w-full overflow-x-hidden bg-background text-foreground">
      {!isLandingPage && isAuthenticated && (
        <Sidebar isOpen={false} onClose={() => {}} />
      )}

      <MobileNavigation
        isOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col max-w-full overflow-x-hidden">
        <TopNavbar onMenuClick={() => setMobileNavOpen(true)} />

        <main
          className="flex-1 overflow-x-hidden"
          style={{ scrollBehavior: "smooth" }}
        >
          {children}
        </main>
      </div>

      {/* BugHuntr Assistant - Available on all authenticated pages except landing */}
      {!isLandingPage && isAuthenticated && <BugHuntrAssistant />}
      <Toaster richColors position="top-right" />
    </div>
  );
}

export default function ClientLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style>{`
html {
  font-family: ${GeistSans.style.fontFamily};
  --font-sans: ${GeistSans.variable};
  --font-mono: ${GeistMono.variable};
}
        `}</style>
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            <RouteProtection>
              <CommunityProvider>
                <SearchProvider>
                  <InnerLayout>{children}</InnerLayout>
                </SearchProvider>
              </CommunityProvider>
            </RouteProtection>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
