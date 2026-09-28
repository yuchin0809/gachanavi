import type { ReactNode } from "react";

export function HorizontalScroller({ children }: { children: ReactNode }) {
  return <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [&>*]:snap-start">{children}</div>;
}
