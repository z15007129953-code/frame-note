"use client";

type IconName =
  | "brand"
  | "home"
  | "projects"
  | "feedback"
  | "share"
  | "settings"
  | "search"
  | "plus"
  | "arrow-up-right"
  | "upload"
  | "layers"
  | "message"
  | "close";

const paths: Record<IconName, React.ReactNode> = {
  brand: <path d="M5 19 19 5M7 5h12v12" />,
  home: <><path d="m4 10 8-6 8 6v9H4z" /><path d="M9 19v-5h6v5" /></>,
  projects: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  feedback: <><path d="M5 5h14v10H9l-4 4z" /><path d="M8 9h8M8 12h5" /></>,
  share: <><path d="M14 5h5v5" /><path d="m19 5-9 9" /><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6.7v-2.4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L8 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
  search: <><circle cx="10.8" cy="10.8" r="5.8" /><path d="m16 16 4 4" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  "arrow-up-right": <><path d="M6 18 18 6M9 6h9v9" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></>,
  layers: <><path d="m12 4 8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4" /></>,
  message: <><path d="M5 5h14v10H9l-4 4z" /><path d="M8 9h8" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
};

export function Icon({ name, size = 18, strokeWidth = 1.7 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
