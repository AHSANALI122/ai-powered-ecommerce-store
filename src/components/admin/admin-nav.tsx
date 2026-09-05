"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

/**
 * Admin section navigation.
 *
 * `canManageSettings` hides the settings tab from STAFF. That is a convenience,
 * not a control: the settings route re-checks the role against the database and
 * the PATCH handler requires ADMIN specifically. UI hiding is never a control
 * (SEC-7), so this file is allowed to be wrong without anything being unsafe.
 */

const LINKS: { href: Route; label: string; adminOnly?: boolean }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/inventory", label: "Inventory" },
  { href: "/admin/categories", label: "Categories" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/shipping", label: "Shipping" },
  { href: "/admin/settings", label: "Settings", adminOnly: true },
];

export function AdminNav({ canManageSettings }: { canManageSettings: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections">
      <ul className="flex flex-wrap gap-1 text-sm">
        {LINKS.filter((link) => canManageSettings || !link.adminOnly).map((link) => {
          const active =
            link.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block rounded-md px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-[var(--color-ink)] text-[var(--color-surface)]"
                    : "hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
