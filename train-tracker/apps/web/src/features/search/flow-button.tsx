type Props = { label: string; type?: 'submit' | 'button' };

/** Right-pointing arrow */
function Arrow({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function FlowButton({ label, type = 'submit' }: Props) {
  return (
    <button type={type} className="flow">
      <span className="flow-fill" aria-hidden="true"></span>
      <Arrow className="flow-arrow flow-out" />
      <Arrow className="flow-arrow flow-in" />
      <span className="flow-label">{label}</span>
    </button>
  );
}
