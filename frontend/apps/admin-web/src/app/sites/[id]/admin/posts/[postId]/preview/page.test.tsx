import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const { load, context } = vi.hoisted(() => ({
  load: vi.fn(),
  context: {
    site: { id: 11, name: "Informatics", code: "INF" },
    permissions: ["content.posts.view"],
    enabledModuleCodes: ["POSTS"],
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ postId: "00000000-0000-4000-8000-000000000011" }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: React.ComponentProps<"a">) => <a href={href}>{children}</a>,
}));
vi.mock("@/sites/site-admin-frame", () => ({
  useSiteAdmin: () => context,
  SiteSection: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/app/sites/post-actions", () => ({ getSitePostPreview: load }));

import PostPreview from "./page";

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue({
    ok: true,
    data: {
      id: "00000000-0000-4000-8000-000000000011",
      site: 11,
      title: "Campus report",
      slug: "campus-report",
      excerpt: "Campus summary",
      content: "<p>Body copy</p>",
      featured_media: "sites/11/assets/00000000-0000-4000-8000-000000000022",
      featured_alt: "Campus lawn",
      status: "DRAFT",
      revision_number: 3,
      categories: [],
      tags: [],
      author: null,
      published_at: null,
      blocks: [],
      seo: {},
      created_at: "2026-11-13T00:00:00Z",
      updated_at: "2026-11-13T00:00:00Z",
    },
  });
});

it("opens the private Post preview across the full Site surface with header and hero", async () => {
  render(<PostPreview />);
  expect(await screen.findByRole("heading", { level: 1, name: "Campus report" })).toBeTruthy();
  expect(screen.getByText("Informatics")).toBeTruthy();
  expect(screen.getByRole("img", { name: "Campus lawn" })).toBeTruthy();
  expect(screen.getByLabelText("Full post preview")).toBeTruthy();
  expect(screen.getByLabelText("Article banner")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to Posts" }).getAttribute("href")).toContain("/posts");
  expect(screen.getByRole("link", { name: "Open editor" }).getAttribute("href")).toContain("/edit");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(load).toHaveBeenCalledWith(11, "00000000-0000-4000-8000-000000000011");
});

it("surfaces preview load failures without mounting article content", async () => {
  load.mockResolvedValue({
    ok: false,
    error: {
      status: 403,
      code: "permission_denied",
      message: "Preview denied.",
      details: null,
      requestId: "preview-denied",
    },
  });
  render(<PostPreview />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Preview denied/i));
  expect(screen.queryByRole("heading", { name: "Campus report" })).toBeNull();
});
