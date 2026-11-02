import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { postFromResponse, postsFromResponse, PublicPostDetail, PublicPostFeed } from "./public-post";

const published = {
  title: "Campus update",
  slug: "campus-update",
  excerpt: "News for this Site",
  content: '<p>Safe <script>alert(1)</script><a href="javascript:alert(2)">bad</a> <a href="https://uog.edu.et/news">news</a></p>',
  status: "PUBLISHED",
  categories: [{ name: "News", slug: "news" }],
  tags: [{ name: "Campus", slug: "campus" }],
};

describe("postsFromResponse", () => {
  it("keeps published posts and drops drafts, foreign markup slugs and a disabled module", () => {
    const posts = postsFromResponse(200, {
      results: [
        published,
        { ...published, title: "Draft", slug: "draft-post", status: "DRAFT" },
        { ...published, title: "Bad", slug: "../other" },
      ],
    });
    expect(posts?.map((post) => post.slug)).toEqual(["campus-update"]);
    expect(postsFromResponse(404, { results: [published] })).toBeNull();
  });
});

describe("PublicPostFeed and PublicPostDetail", () => {
  it("renders a stacked feed link and a detail body without script or javascript targets", () => {
    const posts = postsFromResponse(200, { results: [published] });
    render(<PublicPostFeed posts={posts} />);
    const feed = screen.getByTestId("public-post-feed");
    expect(feed.tagName).toBe("UL");
    const link = screen.getByRole("link", { name: "Campus update" });
    expect(link.getAttribute("href")).toBe("/posts/campus-update");
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(screen.getByText("News · Campus")).toBeTruthy();

    render(<PublicPostDetail post={postFromResponse(200, published)} />);
    expect(screen.getByRole("heading", { name: "Campus update" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "news" }).getAttribute("href")).toBe("https://uog.edu.et/news");
    expect(document.querySelector("script")).toBeNull();
    expect(document.body.textContent).not.toContain("javascript:");
    expect(document.body.textContent).not.toContain("alert(1)");
  });

  it("shows nothing for a missing feed or detail", () => {
    render(<PublicPostFeed posts={postsFromResponse(404, null)} />);
    render(<PublicPostDetail post={postFromResponse(404, { title: "Hidden", slug: "hidden", content: "secret" })} />);
    expect(screen.getAllByText(/no published post/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("secret")).toBeNull();
  });
});
