// Simple stroke icons (brief §5.5). Always shown next to a text label.
type IconProps = { size?: number };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function BackIcon({ size = 28 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.4}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function RobotIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={1.8}>
      <rect x="4" y="7" width="16" height="12" rx="3.5" />
      <path d="M12 7V4.5" />
      <circle cx="12" cy="3.4" r="1.1" />
      <circle cx="9" cy="12.5" r="1.3" fill="currentColor" />
      <circle cx="15" cy="12.5" r="1.3" fill="currentColor" />
      <path d="M9.5 16h5" />
    </svg>
  );
}

export function UndoIcon({ size = 28 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.4}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function MovesIcon({ size = 24 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.2}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function NewGameIcon({ size = 24 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.2}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function GlobeIcon({ size = 28 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19" />
      <path d="M12 2.5c2.6 2.6 4 6 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-6-4-9.5s1.4-6.9 4-9.5z" />
    </svg>
  );
}

export function CheckIcon({ size = 24 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.8}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function FirstIcon({ size = 24 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.4}>
      <path d="M6 5v14" />
      <path d="M18 5l-7 7 7 7" />
    </svg>
  );
}

export function PreviousIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.6}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function NextIcon({ size = 30 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.6}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function LastIcon({ size = 24 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} strokeWidth={2.4}>
      <path d="M18 5v14" />
      <path d="M6 5l7 7-7 7" />
    </svg>
  );
}
