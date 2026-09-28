import { useEffect, useRef, useState } from "react";
import HeroCarousel from "./components/HeroCarousel";
import GameSearch from "./components/GameSearch";
import NewReleases from "./components/NewReleases";
import Upcoming from "./components/Upcoming";
import GameSocialRecommended from "./components/GSRecommended";
import RecommendedForYou from "./components/RecommendedForYou";
import TrendingSpotlight from "./components/TrendingSpotlight";
import Footer from "./components/Footer";
import styles from "./HomePage.module.css";

export default function HomePage() {
  // True once the page is scrolled all the way down (the marker after the
  // footer is on screen). The floating search dock gets out of the way there,
  // so it doesn't sit over the footer's last line.
  const endRef = useRef(null);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = endRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setAtEnd(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={styles.homepage}>
      <HeroCarousel />

      <GameSocialRecommended />

      <TrendingSpotlight />
      <NewReleases />
      <Upcoming />
      <RecommendedForYou />
      <Footer />
      <div ref={endRef} className={styles.endMarker} aria-hidden="true" />
      <GameSearch hidden={atEnd} />
    </div>
  );
}
