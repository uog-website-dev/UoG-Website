import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { postFromResponse, postsFromResponse, postsPageFromResponse, PublicPostDetail, PublicPostFeed } from "./public-post";

const published = {
  site: 11,
  id: "00000000-0000-4000-8000-000000000011",
  title: "Campus update",
  slug: "campus-update",
  excerpt: "News for this Site",
  content: '<p>Safe <script>alert(1)</script><a href="javascript:alert(2)">bad</a> <a href="https://uog.edu.et/news">news</a></p>',
  status: "PUBLISHED",
  published_at: "2026-11-13T09:30:00Z",
  author: "Communications Office",
  featured_media: "",
  featured_alt: "",
  seo: { meta_title: "Campus update SEO", meta_description: "Campus SEO description" },
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
    expect(posts?.[0]?.seo.title).toBe("Campus update SEO");
    expect(postsFromResponse(404, { results: [published] })).toBeNull();
  });
});

describe("PublicPostFeed and PublicPostDetail", () => {
  it("renders responsive news cards and a detail body without script or javascript targets", () => {
    const posts = postsFromResponse(200, { results: [published] });
    render(<PublicPostFeed posts={posts} />);
    const feed = screen.getByTestId("public-post-feed");
    expect(feed.tagName).toBe("UL");
    const link = screen.getByRole("link", { name: "Campus update" });
    expect(link.getAttribute("href")).toBe("/posts/campus-update");
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(screen.getByRole("link", {name:"News"}).getAttribute("href")).toBe("/posts/categories/news");

    render(<PublicPostDetail post={postFromResponse(200, published)} />);
    expect(screen.getByRole("heading", { name: "Campus update", level:1 })).toBeTruthy();
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

  it("renders versioned editor_document bodies without executing hostile markup", () => {
    const document = postFromResponse(200, {
      ...published,
      content: "fallback plain text",
      editor_document: {
        schema_version: 1,
        html: '<h2>Report</h2><script>window.attack=1</script><p onclick="attack()"><a href="javascript:attack()">Unsafe</a><a href="https://uog.edu.et/news">Safe news</a></p>',
      },
    });
    const { container } = render(<PublicPostDetail post={document} />);
    expect(screen.getByRole("heading", { level: 2, name: "Report" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Safe news" }).getAttribute("href")).toBe("https://uog.edu.et/news");
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(container.querySelector("script,[onclick]")).toBeNull();
    expect(container.textContent).not.toContain("fallback plain text");
  });

  it("renders a hero banner, date, optional author, back navigation and omits a broken featured image", () => {
    const document = postFromResponse(200, published);
    const { container } = render(<PublicPostDetail post={document} />);
    expect(screen.getByLabelText("Article banner")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to posts" }).getAttribute("href")).toBe("/posts");
    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-11-13T09:30:00Z");
    expect(screen.getByText("Communications Office")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("This Post has no available featured image.");
  });

  it("can hide the public listing link for private Site preview chrome", () => {
    render(<PublicPostDetail post={postFromResponse(200, published)} showListingLink={false} />);
    expect(screen.queryByRole("link", { name: "Back to posts" })).toBeNull();
    expect(screen.getByLabelText("Article banner")).toBeTruthy();
  });

  it("keeps Site B documents out of Site A rendering helpers", () => {
    const foreign = postFromResponse(200, { ...published, site: 22, title: "Foreign secret", slug: "foreign-secret" });
    expect(foreign?.site).toBe(22);
    expect(postFromResponse(200, { ...published, status: "UNPUBLISHED" })).toBeNull();
  });
});


it("renders an approved thumbnail and publication date and falls back after an image error", () => {
  const asset = "11111111-1111-4111-8111-111111111111";
  const posts = postsFromResponse(200,{results:[{...published,featured_media:`sites/11/assets/${asset}`,featured_alt:"Campus gardens"}]});
  const {container} = render(<PublicPostFeed posts={posts} />);
  const image = screen.getByRole("img",{name:"Campus gardens"});
  expect(image.getAttribute("src")).toBe(`/api/v1/site-context/media/${asset}/?variant=thumbnail`);
  expect(container.querySelector("time")?.getAttribute("datetime")).toBe(published.published_at);
  fireEvent.error(image);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByRole("img",{name:"No image available"})).toBeTruthy();
});

it("keeps foreign or unsafe media out of news cards and escapes card strings", () => {
  const posts = postsFromResponse(200,{results:[{...published,title:'<script>attack()</script>',excerpt:'<img onerror="attack()">',featured_media:"sites/22/assets/11111111-1111-4111-8111-111111111111"}]});
  const {container} = render(<PublicPostFeed posts={posts} />);
  expect(container.querySelector("img,script")).toBeNull();
  expect(screen.getByRole("link",{name:'<script>attack()</script>'}).getAttribute("href")).toBe("/posts/campus-update");
});

it("validates the paginated Site contract without following response URLs", () => {
  const page = {count:2,next:"https://foreign.test/news",previous:null,results:[published]};
  expect(postsPageFromResponse(200,page,11)).toEqual(expect.objectContaining({count:2,hasNext:true,hasPrevious:false}));
  expect(postsPageFromResponse(200,page,22)).toBeNull();
  expect(postsPageFromResponse(200,{...page,count:-1},11)).toBeNull();
  expect(postsPageFromResponse(200,{...page,results:[{...published,status:"DRAFT"}]},11)).toBeNull();
  expect(postsPageFromResponse(500,page,11)).toBeNull();
});
