import { ICONS, IconName } from "@/game/icons";

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

export default function Icon({ name, size = 18, className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
