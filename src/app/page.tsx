import Image from "next/image";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";

/**
 * F0 homepage: proves the stack is wired end to end by listing seeded products
 * straight from Postgres. F2 replaces this with the real hero carousel,
 * category navigation and ISR-cached listings.
 */

export const revalidate = 60;

type ProductCard = {
  id: string;
  slug: string;
  title: string;
  brand: string | null;
  images: string[];
  basePrice: string;
  inStock: boolean;
  variantCount: number;
};

async function loadProducts(): Promise<
  { ok: true; products: ProductCard[] } | { ok: false; reason: string }
> {
  try {
    const rows = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        slug: true,
        title: true,
        brand: true,
        images: true,
        basePrice: true,
        variants: { select: { stock: true }, where: { isActive: true } },
      },
    });

    return {
      ok: true,
      products: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        brand: row.brand,
        images: row.images,
        basePrice: row.basePrice.toString(),
        inStock: row.variants.some((variant) => variant.stock > 0),
        variantCount: row.variants.length,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}

function SetupNotice({ reason }: { reason: string }) {
  return (
    <section className="rounded-lg border border-[var(--color-line)] p-6">
      <h1 className="text-xl font-semibold">Foundation is up; the database is not</h1>
      <p className="mt-2 max-w-prose text-sm text-[var(--color-muted)]">
        The app builds and renders, but no products could be read. Point{" "}
        <code className="rounded bg-black/5 px-1">DATABASE_URL</code> at a Neon database,
        then run the migration and the seed:
      </p>
      <pre className="mt-4 overflow-x-auto rounded bg-black/5 p-4 text-xs leading-relaxed">
        {`cp .env.example .env      # fill in DATABASE_URL
npm run db:migrate        # applies prisma/migrations
npm run db:seed           # demo catalogue`}
      </pre>
      <p className="mt-4 text-xs text-[var(--color-muted)]">Reported: {reason}</p>
    </section>
  );
}

export default async function HomePage() {
  const result = await loadProducts();
  if (!result.ok) return <SetupNotice reason={result.reason} />;

  const currency = serverEnv().BASE_CURRENCY;

  if (result.products.length === 0) {
    return (
      <section className="rounded-lg border border-[var(--color-line)] p-6">
        <h1 className="text-xl font-semibold">Database connected, catalogue empty</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Run <code className="rounded bg-black/5 px-1">npm run db:seed</code> to load the
          demo catalogue.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">New arrivals</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        {result.products.length} of the seeded catalogue, straight from Postgres.
      </p>

      <ul className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {result.products.map((product, index) => (
          <li key={product.id}>
            <article>
              <div className="relative aspect-3/4 overflow-hidden rounded-lg bg-black/5">
                {product.images[0] ? (
                  <Image
                    src={product.images[0]}
                    alt={product.title}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover"
                    priority={index === 0}
                  />
                ) : null}
              </div>
              <h2 className="mt-3 text-sm font-medium">{product.title}</h2>
              {product.brand ? (
                <p className="text-xs text-[var(--color-muted)]">{product.brand}</p>
              ) : null}
              <p className="mt-1 text-sm">
                {formatMoney(product.basePrice, currency)}
                <span className="ml-2 text-xs text-[var(--color-muted)]">
                  {product.variantCount} variants
                  {product.inStock ? "" : " · out of stock"}
                </span>
              </p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
