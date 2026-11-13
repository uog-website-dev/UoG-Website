"use client";
import { useLayoutEffect, useRef, useState } from "react";

export const PREVIEW_VIEWPORTS = {
  desktop: { label: "Desktop", width: 1280 },
  tablet: { label: "Tablet", width: 768 },
  mobile: { label: "Mobile", width: 390 },
} as const;

export type PreviewViewport = keyof typeof PREVIEW_VIEWPORTS;

/** Fit the device surface while retaining its CSS layout width. */
export function usePreviewScale(width: number, active = true) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!active || !frame || typeof ResizeObserver === "undefined") return;
    const resize = () => {
      if (frame.clientWidth > 0) setScale(Math.min(1, frame.clientWidth / width));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [width, active]);
  return { frameRef, scale };
}

