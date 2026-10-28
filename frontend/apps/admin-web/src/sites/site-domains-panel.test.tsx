import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Site, SiteDomain } from "@uog/types";
import { ToastProvider } from "@uog/ui";

import { publicWebsiteUrl } from "./site-domains-panel";

// --- server action mocks -------------------------------------------------
const listAllSiteDomains = vi.fn();
const activateSiteDomain = vi.fn();
const deactivateSiteDomain = vi.fn();
const makeSiteDomainPrimary = vi.fn();

vi.mock("@/app/sites/actions", () => ({
  listAllSiteDomains: (...args: unknown[]) => listAllSiteDomains(...args),
  activateSiteDomain: (...args: unknown[]) => activateSiteDomain(...args),
  deactivateSiteDomain: (...args: unknown[]) => deactivateSiteDomain(...args),
  makeSiteDomainPrimary: (...args: unknown[]) => makeSiteDomainPrimary(...args),
}));

import { SiteDomainsPanel } from "./site-domains-panel";

const STAMP = "2026-01-01T00:00:00Z";

function site(partial: Partial<Site> = {}): Site {
  return {
    id: 1,
    code: "UOG_MAIN",
    name: "University of Gondar",
    short_name: "UoG",
    organization_unit: 1,
    default_language: "en",
    status: "ACTIVE",
    is_main: true,
    template: null,
    configuration: { schema_version: 1 } as Site["configuration"],
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

function domain(partial: Partial<SiteDomain> = {}): SiteDomain {
  return {
    id: 1,
    site: 1,
    hostname: "www.uog.edu.et",
    is_primary: true,
    redirect_to_primary: false,
    status: "ACTIVE",
    created_at: STAMP,
    updated_at: STAMP,
    ...partial,
  };
}

/** The default fixture set: an active primary, an active alias, an inactive alias. */
const THREE = [
  domain(),
  domain({
    id: 2,
    hostname: "uog.edu.et",
    is_primary: false,
    redirect_to_primary: true,
  }),
  domain({
    id: 3,
    hostname: "old.uog.edu.et",
    is_primary: false,
    status: "INACTIVE" as const,
  }),
];

function okWrite(partial: Partial<SiteDomain> = {}, id: number = 99) {
  const row: SiteDomain = { ...domain({ id, ...partial }) };
  return { ok: true as const, data: { data: row, etag: '"e2"', requestId: "req-w" } };
}

function rejection(partial: {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string[]> | null;
  requestId?: string;
}) {
  return {
    ok: false as const,
    error: {
      status: partial.status,
      code: partial.code,
      message: partial.message,
      details: partial.details ?? null,
      requestId: partial.requestId ?? null,
    },
  };
}

describe(publicWebsiteUrl, () => {
  it("builds a protocol-relative URL from the bare hostname", () => {
    // No scheme guessing: DNS/TLS provisioning is not the platform's job,
    // so the link inherits the console's scheme.
    expect(publicWebsiteUrl("www.uog.edu.et")).toBe("//www.uog.edu.et");
    expect(publicWebsiteUrl("portal.uog.edu.et")).toBe("//portal.uog.edu.et");
  });
});

function renderPanel(props: { site?: Site; onChanged?: () => void } = {}) {
  const onChanged = props.onChanged ?? vi.fn();
  const view = render(
    <ToastProvider>
      <SiteDomainsPanel site={props.site ?? site()} onChanged={onChanged} />
    </ToastProvider>,
  );
  return { onChanged, container: view.container };
}

/**
 * Pick an option in the shared `SelectFilter` — a non-native MUI Select is a
 * combobox, driven by opening the listbox with a mouseDown and clicking the
 * option that appears.
 */
async function pickOption(name: RegExp, option: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

/** A row action button by its aria-label, read straight from the DOM. */
function rowButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`Missing row button: ${label}`);
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  listAllSiteDomains.mockResolvedValue({ ok: true, data: THREE });
  activateSiteDomain.mockResolvedValue(okWrite({ status: "ACTIVE" as const }));
  deactivateSiteDomain.mockResolvedValue(okWrite({ status: "INACTIVE" as const }));
  makeSiteDomainPrimary.mockResolvedValue(okWrite({ is_primary: true }));
});

describe("SiteDomainsPanel — reads", () => {
  it("renders domains with lifecycle chips, the redirect warning and lifecycle info", async () => {
    renderPanel();

    expect(await screen.findByText("www.uog.edu.et")).toBeTruthy();
    expect(screen.getByText("uog.edu.et")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText(/Redirects to the primary domain/)).toBeTruthy();
    // Active and inactive domains are both labeled — "Inactive" is an
    // explicit state, never hidden.
    expect(screen.getAllByText("Active")).toHaveLength(2);
    expect(screen.getByText("Inactive")).toBeTruthy();
    // Lifecycle stamps are shown for every row.
    expect(screen.getAllByText(/Lifecycle: added/)).toHaveLength(3);
  });

  it("links directly to the public website only for active domains", async () => {
    renderPanel();

    const links = await screen.findAllByRole("link", { name: "Open www.uog.edu.et" });
    // The aria-label names the destination; the visible text is the label.
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("//www.uog.edu.et");
    expect(links[0].textContent).toContain("Public website");
    // The active alias is linked too.
    const aliasLink = await screen.findByRole("link", { name: "Open uog.edu.et" });
    expect(aliasLink.getAttribute("href")).toBe("//uog.edu.et");
    // The inactive alias has no public link at all.
    expect(screen.queryByRole("link", { name: "Open old.uog.edu.et" })).toBeNull();
  });

  it("states when no hostnames are registered", async () => {
    listAllSiteDomains.mockResolvedValue({ ok: true, data: [] });

    renderPanel();

    expect(
      await screen.findByText("No hostnames are registered for this site yet."),
    ).toBeTruthy();
  });

  it("reports a failed domain read instead of implying there are no domains", async () => {
    listAllSiteDomains.mockResolvedValue(
      rejection({
        status: 403,
        code: "permission_denied",
        message: "Not allowed.",
        requestId: "req-403",
      }),
    );

    renderPanel();

    expect(
      await screen.findByText(/domain list could not be loaded/i),
    ).toBeTruthy();
    expect(screen.getByText(/does not mean the site has no domains/i)).toBeTruthy();
    expect(screen.queryByText("No hostnames are registered for this site yet.")).toBeNull();
  });
});

describe("SiteDomainsPanel — set as primary", () => {
  it("confirms by naming both hostnames, then applies the switch atomically", async () => {
    const { onChanged } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Set as primary uog.edu.et" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: /primary domain\?/i,
    });
    // Both the proposed replacement and the displaced current primary are
    // named in the dialog body.
    expect(confirm.textContent).toMatch(/New primary/);
    expect(confirm.textContent).toMatch(/uog\.edu\.et/);
    expect(confirm.textContent).toMatch(/Current primary/);
    expect(confirm.textContent).toMatch(/www\.uog\.edu\.et/);
    expect(makeSiteDomainPrimary).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Set as primary" }));

    await waitFor(() =>
      expect(makeSiteDomainPrimary).toHaveBeenCalledWith(1, 2),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(
      await screen.findByText(/Primary domain changed to uog\.edu\.et/),
    ).toBeTruthy();
  });

  it("does not change anything when the confirmation is cancelled", async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Set as primary uog.edu.et" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: /primary domain\?/i,
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(makeSiteDomainPrimary).not.toHaveBeenCalled();
  });

  it("surfaces a backend rejection in the dialog and stays open", async () => {
    makeSiteDomainPrimary.mockResolvedValue(
      rejection({
        status: 409,
        code: "conflict",
        message: "The request conflicts with the current resource state.",
        requestId: "req-409",
      }),
    );

    const { onChanged } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Set as primary uog.edu.et" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: /primary domain\?/i,
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Set as primary" }));

    const alert = await within(confirm).findByRole("alert");
    expect(alert.textContent).toMatch(/conflicts with the current resource state/);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /primary domain\?/i })).toBeTruthy();
  });

  it("warns when the chosen alias is not active", async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Set as primary old.uog.edu.et" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: /primary domain\?/i,
    });
    expect(
      within(confirm).getByText(/currently inactive/),
    ).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  });
});

describe("SiteDomainsPanel — activation", () => {
  it("activates an inactive domain after confirmation", async () => {
    const { onChanged } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Activate old.uog.edu.et" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: /Activate domain\?/i,
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Activate" }));

    await waitFor(() =>
      expect(activateSiteDomain).toHaveBeenCalledWith(1, 3),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText(/Activated old\.uog\.edu\.et/)).toBeTruthy();
  });

  it("surfaces a rejection without closing the dialog or claiming success", async () => {
    activateSiteDomain.mockResolvedValue(
      rejection({
        status: 403,
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        requestId: "req-403",
      }),
    );

    const { onChanged } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Activate old.uog.edu.et" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: /Activate domain\?/i,
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Activate" }));

    const alert = await within(confirm).findByRole("alert");
    expect(alert.textContent).toMatch(/do not have permission/i);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Activate domain\?/i })).toBeTruthy();
  });
});

describe("SiteDomainsPanel — deactivating an alias", () => {
  it("deactivates an alias without any replacement payload", async () => {
    const { onChanged } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Deactivate uog.edu.et" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: /Deactivate domain\?/i,
    });
    // An alias deactivation does not ask for a replacement.
    expect(within(confirm).queryByRole("combobox")).toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Deactivate" }));

    await waitFor(() =>
      expect(deactivateSiteDomain).toHaveBeenCalledWith(1, 2, undefined),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText(/Deactivated uog\.edu\.et\.?$/)).toBeTruthy();
  });
});

describe("SiteDomainsPanel — deactivating the active primary", () => {
  it("requires a replacement before the server is contacted at all", async () => {
    // Only the primary is active; the other alias is inactive, so no valid
    // replacement exists.
    listAllSiteDomains.mockResolvedValue({
      ok: true,
      data: [domain(), THREE[2]],
    });

    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Deactivate www.uog.edu.et" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: /Deactivate domain\?/i,
    });
    expect(
      within(confirm).getByText(/no other active domain/),
    ).toBeTruthy();

    // Guard: the panel refuses to submit without a chosen replacement (the
    // backend would reject it too).
    fireEvent.click(within(confirm).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(deactivateSiteDomain).not.toHaveBeenCalled());
  });

  it("sends the chosen replacement and reports the primary swap", async () => {
    const { onChanged } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Deactivate www.uog.edu.et" }),
    );

    const confirm = await screen.findByRole("dialog", {
      name: /Deactivate domain\?/i,
    });
    // Only other ACTIVE domains on the same site are offered.
    await pickOption(/Replacement domain/i, "uog.edu.et");
    fireEvent.click(within(confirm).getByRole("button", { name: "Deactivate" }));

    await waitFor(() =>
      expect(deactivateSiteDomain).toHaveBeenCalledWith(1, 1, 2),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(
      await screen.findByText(
        /Deactivated www\.uog\.edu\.et\. uog\.edu\.et is now the site's primary domain\./,
      ),
    ).toBeTruthy();
  });

  it("shows the backend's rejected-replacement sentences, not a generic failure", async () => {
    deactivateSiteDomain.mockResolvedValue(
      rejection({
        status: 400,
        code: "validation_error",
        message: "The request is invalid.",
        details: {
          replacement: [
            "Select an active domain on this Site before deactivating the primary.",
          ],
        },
        requestId: "req-400",
      }),
    );

    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Deactivate www.uog.edu.et" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: /Deactivate domain\?/i,
    });
    await pickOption(/Replacement domain/i, "uog.edu.et");
    fireEvent.click(within(confirm).getByRole("button", { name: "Deactivate" }));

    const alert = await within(confirm).findByRole("alert");
    expect(alert.textContent).toContain(
      "The request is invalid. Select an active domain on this Site before deactivating the primary.",
    );
    // The dialog stays open and no success is claimed.
    expect(screen.getByRole("dialog", { name: /Deactivate domain\?/i })).toBeTruthy();
  });
});

describe("SiteDomainsPanel — conflicting updates", () => {
  it("locks every row action while a confirmation is open", async () => {
    const { container } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Set as primary uog.edu.et" }),
    );
    await screen.findByRole("dialog", { name: /primary domain\?/i });

    // No second lifecycle operation can be issued behind the open dialog.
    // (Row buttons are queried in the DOM: MUI closes the page with
    // aria-hidden while the modal is up, so role queries cannot reach them.)
    expect(rowButton(container, "Deactivate www.uog.edu.et").disabled).toBe(true);
    expect(rowButton(container, "Activate old.uog.edu.et").disabled).toBe(true);
  });

  it("keeps the lock while a confirmed change is in flight, then applies it", async () => {
    let release: (value: unknown) => void = () => {};
    makeSiteDomainPrimary.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const { onChanged, container } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Set as primary uog.edu.et" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: /primary domain\?/i,
    });
    fireEvent.click(within(confirm).getByRole("button", { name: "Set as primary" }));

    await waitFor(() =>
      expect(makeSiteDomainPrimary).toHaveBeenCalledWith(1, 2),
    );
    expect(within(confirm).getByRole("button", { name: /working/i })).toBeTruthy();
    expect(rowButton(container, "Deactivate www.uog.edu.et").disabled).toBe(true);

    release(okWrite({ is_primary: true }, 2));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /primary domain\?/i })).toBeNull(),
    );
    // The lock lifts once the change is applied.
    expect(rowButton(container, "Deactivate www.uog.edu.et").disabled).toBe(false);
  });
});
