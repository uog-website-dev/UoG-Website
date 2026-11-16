"use client";
import type {ReactNode} from "react";
export function SessionSignOutForm({action, children}: {action: () => Promise<void>; children: ReactNode}) {
  return <form action={action} style={{display: "inline"}} onSubmit={() => window.dispatchEvent(new Event("uog:session:clear"))}>{children}</form>;
}
