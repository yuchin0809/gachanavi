import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/Icons";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 py-3 text-sm font-medium text-muted hover:text-ink"
    >
      <ChevronLeftIcon className="h-4 w-4" />
      {label}
    </Link>
  );
}
