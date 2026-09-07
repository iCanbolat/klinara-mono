import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Viewport genişliğine göre mobil olup olmadığımız.
 *
 * `useSyncExternalStore` kullanılıyor, `useState` + `useEffect` DEĞİL: ikincisi
 * ilk render'ı her zaman "masaüstü" varsayıp effect'te düzeltir, yani mobilde
 * bir kare boyunca yanlış düzen çizilir (ve `react-hooks/set-state-in-effect`
 * tam olarak bunu işaret ediyor). `useSyncExternalStore` değeri render
 * sırasında okur; sunucuda ise üçüncü argüman devreye girip masaüstü döner —
 * hidrasyon uyuşmazlığı olmaz.
 */
function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    // Sunucuda `window` yok; SSR ve ilk hidrasyon masaüstü varsayar.
    () => false,
  )
}
