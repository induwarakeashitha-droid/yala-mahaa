import { useEffect, useState } from 'react'

// Bars and gauges have a CSS transition, but a transition only runs when the value changes on
// screen. Starting at 0 and switching to the real value after the first paint makes them grow in
// every time they appear, not only when data refreshes.
export function useGrowIn(value) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    // Two frames: the first lets the browser paint the empty bar
    let second
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(value))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [value])
  return shown
}
