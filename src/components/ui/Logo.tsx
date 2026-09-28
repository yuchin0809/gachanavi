/** カプセル型のロゴマーク + ワードマーク */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <circle cx="16" cy="16" r="14" fill="#fff" stroke="#1d1a2b" strokeWidth="2" />
        <path d="M2 16a14 14 0 0 1 28 0Z" fill="#ef4550" stroke="#1d1a2b" strokeWidth="2" />
        <circle cx="16" cy="16" r="3.5" fill="#ffc83d" stroke="#1d1a2b" strokeWidth="2" />
      </svg>
      <span className="text-lg font-extrabold tracking-tight">
        Gacha<span className="text-brand">Navi</span>
      </span>
    </span>
  );
}
