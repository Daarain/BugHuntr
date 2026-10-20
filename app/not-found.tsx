import Link from "next/link";
import { ShieldAlert, ArrowLeft, Home, Compass, BookOpen } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="max-w-md w-full text-center space-y-8 p-8 rounded-2xl border border-border/60 bg-card/50 backdrop-blur-md shadow-2xl">
        <div className="relative inline-flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-[var(--accent-primary)]/20 blur-xl animate-pulse" />
          <div className="relative p-4 rounded-2xl bg-card border border-[var(--accent-primary)]/40 text-[var(--accent-primary)] shadow-inner">
            <ShieldAlert className="w-16 h-16" strokeWidth={1.75} />
          </div>
        </div>

        <div className="space-y-3">
          <span className="inline-block px-3 py-1 text-xs font-mono font-semibold rounded-full bg-destructive/15 text-destructive border border-destructive/30">
            HTTP 404 · TARGET_NOT_FOUND
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Advisory Not Found
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The vulnerability record, target domain, or resource you are seeking does not exist or has been decommissioned.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Link
            href="/"
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-all shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Home className="w-4 h-4" />
            Home
          </Link>
          <Link
            href="/feed"
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:bg-secondary/80 border border-border/80 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Compass className="w-4 h-4" />
            Bug Feed
          </Link>
          <Link
            href="/docs"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-secondary-foreground font-medium text-sm hover:bg-secondary/80 border border-border/80 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Docs"
          >
            <BookOpen className="w-4 h-4" />
            Docs
          </Link>
        </div>

        <div className="pt-4 border-t border-border/40">
          <Link
            href="javascript:history.back()"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Return to previous page
          </Link>
        </div>
      </div>
    </div>
  );
}
