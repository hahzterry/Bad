"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAppStore } from "@/lib/store";

const BUTTON_SIZE = 56;
const PADDING = 20;

/**
 * Draggable floating Shyft AI button.
 * - Only visible on the Feed tab.
 * - Drag with mouse / touch; snaps to nearest horizontal edge on release.
 * - Click (no drag) opens the AI tab.
 */
export default function FloatingAIButton() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  // Store position as { right, bottom } so it survives window resizes nicely.
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  // Initialize bottom-right after mount (window not available during SSR).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPos({
      x: window.innerWidth - BUTTON_SIZE - PADDING,
      y: window.innerHeight - BUTTON_SIZE - PADDING - 80, // above mobile nav
    });
  }, []);

  // Pointer-based dragging
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true;
      setPos({
        x: Math.max(PADDING, Math.min(window.innerWidth - BUTTON_SIZE - PADDING, startRef.current.posX + dx)),
        y: Math.max(PADDING, Math.min(window.innerHeight - BUTTON_SIZE - PADDING, startRef.current.posY + dy)),
      });
    };

    const onUp = () => {
      setDragging(false);
      // Snap horizontally to nearest edge
      setPos((p) => {
        const snapX = p.x + BUTTON_SIZE / 2 < window.innerWidth / 2
          ? PADDING
          : window.innerWidth - BUTTON_SIZE - PADDING;
        return { x: snapX, y: p.y };
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  const onPointerDown = (e: React.PointerEvent) => {
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
    setDragging(true);
  };

  const onClick = () => {
    if (movedRef.current) return; // suppress click after drag
    setActiveTab("ai");
  };

  // Only render on feed tab
  if (activeTab !== "feed") return null;

  return (
    <button
      type="button"
      aria-label="Open Shyft AI"
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        borderRadius: BUTTON_SIZE / 2,
        zIndex: 9999,
        cursor: dragging ? "grabbing" : "grab",
        transition: dragging ? "none" : "left 280ms cubic-bezier(.2,.9,.3,1.2)",
        touchAction: "none",
      }}
      className="bg-[#0A0A0A] border border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.35)] flex items-center justify-center hover:bg-[#1a1a1a] active:scale-95"
    >
      <Sparkles className="w-5 h-5 text-white" />
    </button>
  );
}
