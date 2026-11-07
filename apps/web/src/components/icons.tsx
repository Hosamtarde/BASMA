import type { SVGProps } from 'react';

/**
 * Line icons drawn for the approved direction A (docs/design-directions/a-brand-gradient.html):
 * our own artwork, 24×24, stroke = currentColor. Decorative unless a label is passed by the caller.
 */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const HomeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M10 20v-5.5h4V20" />
  </Icon>
);

export const ToothIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7.2 3.5C4.8 3.5 3.5 5.4 3.5 7.6c0 2.9 1.4 4.3 1.9 7.2.4 2.5 1 5.7 2.4 5.7 1.5 0 1.6-3.6 2.4-5.5.4-1 1.2-1 1.6 0 .8 1.9.9 5.5 2.4 5.5 1.4 0 2-3.2 2.4-5.7.5-2.9 1.9-4.3 1.9-7.2 0-2.2-1.3-4.1-3.7-4.1-1.9 0-2.9.9-4.8.9s-2.9-.9-4.8-.9Z" />
  </Icon>
);

export const ClipboardIcon = (p: P) => (
  <Icon {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V2.8h6V4M8.5 10h7M8.5 14h7M8.5 18h4" />
  </Icon>
);

export const DoctorsIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.3" />
    <path d="M3.5 20c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M16.2 14.3c2.3.1 3.9 1.7 4.3 4.7" />
  </Icon>
);

export const IncomingIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3v11M7.5 9.5 12 14l4.5-4.5" />
    <path d="M4 15.5V20h16v-4.5" />
  </Icon>
);

export const OutgoingIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 14V3M7.5 7.5 12 3l4.5 4.5" />
    <path d="M4 15.5V20h16v-4.5" />
  </Icon>
);

export const ScaleIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 4v16M7.5 20h9M5 7h14" />
    <path d="m5 7-2.6 6a2.8 2.8 0 0 0 5.2 0Z" />
    <path d="m19 7-2.6 6a2.8 2.8 0 0 0 5.2 0Z" />
  </Icon>
);

export const ChequeIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6.5 14h6M6.5 10.5h3M15 14h2.5" />
  </Icon>
);

export const InvoiceIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 3h8.5L19 7.5V21H6Z" />
    <path d="M14.5 3v4.5H19M9 12h7M9 16h7M9 8.5h3" />
  </Icon>
);

export const GearIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
    <circle cx="12" cy="12" r="6.6" />
  </Icon>
);
