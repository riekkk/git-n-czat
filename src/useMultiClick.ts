import { useRef } from "react";

export function useMultiClick(onTrigger: () => void, count = 5, windowMs = 2000) {
  const clicks = useRef<number[]>([]);
  return () => {
    const now = Date.now();
    clicks.current = [...clicks.current.filter(t => now - t < windowMs), now];
    if (clicks.current.length >= count) {
      clicks.current = [];
      onTrigger();
    }
  };
}