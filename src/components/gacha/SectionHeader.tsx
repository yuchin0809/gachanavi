import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRightIcon } from "@/components/ui/Icons";

export function SectionHeader({
  icon,
  title,
  description,
  moreHref,
}: {
  icon: string;
  title: string;
  description?: ReactNode;
  moreHref?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2">
      <div>
        <h2 className="text-lg font-extrabold">
          <span className="mr-1.5" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {moreHref && (
        <Link href={moreHref} className="inline-flex shrink-0 items-center text-sm font-bold text-brand-ink">
          もっと見る
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
