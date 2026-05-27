export interface DocsNavItem {
  href: string;
  title: string;
}

export interface DocsNavSection {
  title: string;
  items: DocsNavItem[];
}

export const docsNav: DocsNavSection[] = [
  {
    title: 'Introduction',
    items: [
      { href: '/docs', title: 'Overview' },
      { href: '/docs/getting-started', title: 'Getting started' },
    ],
  },
  {
    title: 'Core features',
    items: [
      { href: '/docs/organizing', title: 'Warehouses, boxes & items' },
      { href: '/docs/scanning-and-ai', title: 'Scanning and AI' },
      { href: '/docs/expiry-and-reminders', title: 'Expiry & reminders' },
    ],
  },
  {
    title: 'Readiness loop',
    items: [
      { href: '/docs/readiness', title: 'Readiness dashboard' },
      { href: '/docs/shopping-and-restock', title: 'Shopping list & restock' },
    ],
  },
  {
    title: 'Working with others',
    items: [
      { href: '/docs/collaboration', title: 'Sharing & P2P sync' },
      { href: '/docs/printing', title: 'Printing QR labels' },
    ],
  },
];

// Flat list in reading order — used by Previous/Next navigation.
export const docsOrder: DocsNavItem[] = docsNav.flatMap((s) => s.items);

export function getAdjacentDocs(currentHref: string): {
  prev: DocsNavItem | null;
  next: DocsNavItem | null;
} {
  const idx = docsOrder.findIndex((i) => i.href === currentHref);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? docsOrder[idx - 1] : null,
    next: idx < docsOrder.length - 1 ? docsOrder[idx + 1] : null,
  };
}
