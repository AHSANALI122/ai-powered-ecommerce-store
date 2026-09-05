"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiFetch, postJson } from "@/lib/client/api";
import { TextField } from "@/components/ui/form";
import { FormError, FormNotice } from "@/components/ui/form";
import { Button, CheckboxField, SelectField } from "@/components/admin/ui";
import { Badge } from "@/components/admin/table";
import type { AdminCategoryNode } from "@/server/admin/categories";

/**
 * Category CRUD.
 *
 * Deleting is refused server-side while products or sub-categories still point
 * at a category, and the message says which. That is friendlier than a foreign
 * key error and, more usefully, it is the same answer whether the operator
 * clicks the button or calls the endpoint — the rule lives in the service, not
 * in this file.
 */
export function CategoryManager({
  initialCategories,
}: {
  initialCategories: AdminCategoryNode[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  const roots = initialCategories;
  const flat = roots.flatMap((root) => [root, ...root.children]);

  function remove(id: string, name: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await apiFetch<{ ok: true }>(`/api/admin/categories/${id}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setNotice(`Deleted ${name}.`);
      router.refresh();
    });
  }

  function toggleActive(category: AdminCategoryNode) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await apiFetch<{ category: unknown }>(
        `/api/admin/categories/${category.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isActive: !category.isActive }),
        },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <FormError>{error}</FormError>
      <FormNotice>{notice}</FormNotice>

      <ul className="flex flex-col gap-2">
        {roots.map((root) => (
          <li key={root.id} className="rounded-lg border border-[var(--color-line)] p-4">
            <CategoryRow
              category={root}
              pending={pending}
              onToggle={() => toggleActive(root)}
              onDelete={() => remove(root.id, root.name)}
            />
            {root.children.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2 border-l border-[var(--color-line)] pl-4">
                {root.children.map((child) => (
                  <li key={child.id}>
                    <CategoryRow
                      category={child}
                      pending={pending}
                      onToggle={() => toggleActive(child)}
                      onDelete={() => remove(child.id, child.name)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      {roots.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          No categories yet. Every product needs one, so start here.
        </p>
      ) : null}

      {creating ? (
        <NewCategoryForm
          parents={roots.map((root) => ({ id: root.id, name: root.name }))}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div>
          <Button tone="primary" onClick={() => setCreating(true)}>
            New category
          </Button>
        </div>
      )}

      <p className="text-xs text-[var(--color-muted)]">
        {flat.length} categor{flat.length === 1 ? "y" : "ies"} in total.
      </p>
    </div>
  );
}

function CategoryRow({
  category,
  pending,
  onToggle,
  onDelete,
}: {
  category: AdminCategoryNode;
  pending: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
      <div>
        <p className="font-medium">
          {category.name}{" "}
          {category.isActive ? <Badge tone="good">live</Badge> : <Badge>hidden</Badge>}
        </p>
        <p className="text-xs text-[var(--color-muted)]">
          /c/{category.slug} · {category.productCount} product
          {category.productCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button disabled={pending} onClick={onToggle}>
          {category.isActive ? "Hide" : "Show"}
        </Button>
        <Button tone="danger" disabled={pending} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

function NewCategoryForm({
  parents,
  onDone,
  onCancel,
}: {
  parents: { id: string; name: string }[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await postJson<{ category: { id: string } }>(
        "/api/admin/categories",
        {
          name: name.trim(),
          // An empty slug is derived from the name, which is what an operator
          // means by leaving it blank. The server validates the result either
          // way, so a derived slug gets no special trust.
          slug: slug.trim() === "" ? slugify(name) : slug.trim(),
          parentId: parentId === "" ? null : parentId,
          isActive,
          position: 0,
        },
      );
      if (!result.ok) {
        setError(result.error.message);
        setFieldErrors(result.error.fieldErrors ?? {});
        return;
      }
      onDone();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-lg border border-[var(--color-line)] p-4"
    >
      <h3 className="text-sm font-medium">New category</h3>
      <FormError>{error}</FormError>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          value={name}
          errors={fieldErrors.name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Slug"
          value={slug}
          placeholder={slugify(name)}
          hint="Leave blank to derive it from the name."
          errors={fieldErrors.slug}
          disabled={pending}
          onChange={(event) => setSlug(event.target.value)}
        />
      </div>

      <SelectField
        label="Parent"
        value={parentId}
        disabled={pending}
        errors={fieldErrors.parentId}
        onChange={(event) => setParentId(event.target.value)}
      >
        <option value="">None — this is a top-level category</option>
        {parents.map((parent) => (
          <option key={parent.id} value={parent.id}>
            {parent.name}
          </option>
        ))}
      </SelectField>

      <CheckboxField
        label="Visible in navigation"
        checked={isActive}
        disabled={pending}
        onChange={setIsActive}
      />

      <div className="flex items-center gap-2">
        <Button type="submit" tone="primary" disabled={pending}>
          {pending ? "Working…" : "Create"}
        </Button>
        <Button disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Matches the server's slug rule; the server still validates the result. */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
