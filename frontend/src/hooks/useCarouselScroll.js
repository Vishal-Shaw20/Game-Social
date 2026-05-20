import { useRef, useCallback, useEffect } from "react";

export function useCarouselScroll() {
  const carouselRef = useRef(null);
  const rafRef = useRef(null);
  const scrollSpeed = useRef(0);

  const animateScroll = useCallback(() => {
    if (!carouselRef.current) return;
    carouselRef.current.scrollLeft += scrollSpeed.current;
    // eslint-disable-next-line react-hooks/immutability
    rafRef.current = requestAnimationFrame(animateScroll);
  }, []);

  const handleMouseMove = useCallback((e) => {
    const el = carouselRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const edge = 120;

    if (x < edge) {
      scrollSpeed.current = -((edge - x) / edge) * 18;
    } else if (x > rect.width - edge) {
      scrollSpeed.current = ((x - (rect.width - edge)) / edge) * 18;
    } else {
      scrollSpeed.current = 0;
    }

    if (!rafRef.current && scrollSpeed.current !== 0) {
      rafRef.current = requestAnimationFrame(animateScroll);
    }
  }, [animateScroll]);

  const handleMouseLeave = useCallback(() => {
    scrollSpeed.current = 0;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return { carouselRef, handleMouseMove, handleMouseLeave };
}
