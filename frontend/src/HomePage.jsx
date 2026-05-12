import GameSearch from "./components/GameSearch";
import NewReleases from "./components/NewReleases";
import GameSocialRecommended from "./components/GSRecommended";
import GameCarousel from "./components/GameCarousel";
import styles from "./HomePage.module.css";

const API_URL = import.meta.env.VITE_API_URL;

export default function HomePage() {
  return (
    <div className={styles.homepage}>
      <header className={styles.header}>
        <GameSearch />
      </header>

      <GameSocialRecommended />
      <NewReleases />

      <GameCarousel
        url={`${API_URL}/api/trending`}
        title="Trending"
        limit={25}
        renderSubtitle={(item) =>
          item.players ? `${item.players} playing` : "Players: N/A"
        }
      />
    </div>
  );
}
