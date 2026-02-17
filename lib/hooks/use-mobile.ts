"use client"

import { useState, useEffect } from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Hook that returns true when the viewport width is below the md breakpoint (768px).
 * Uses matchMedia for efficient, listener-based detection.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches)
    }
    // Set initial value
    onChange(mql)
    mql.addEventListener("change", onChange as (e: MediaQueryListEvent) => void)
    return () => mql.removeEventListener("change", onChange as (e: MediaQueryListEvent) => void)
  }, [])

  return isMobile
}
