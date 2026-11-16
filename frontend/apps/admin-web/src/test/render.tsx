import {createElement, type ReactNode} from "react";
import {render as renderUI, type RenderOptions} from "@testing-library/react";
import {QueryScope} from "@/data/query-cache";
export * from "@testing-library/react";

/** Fresh, real query client per mounted test tree; no mocks of cache behavior. */
export function render(ui: ReactNode, options: RenderOptions = {}) {
  const Wrapper = ({children}: {children: ReactNode}) => <QueryScope identity="test-session" siteId={null} authorization="test">
    {options.wrapper ? createElement(options.wrapper, {children}) : children}
  </QueryScope>;
  return renderUI(ui, {...options, wrapper: Wrapper});
}
