import Link from "next/link";

export default function NotFound() {
  return (
    <section className="py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        That page does not exist, or it moved.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm underline underline-offset-4">
        Back to the store
      </Link>
    </section>
  );
}
