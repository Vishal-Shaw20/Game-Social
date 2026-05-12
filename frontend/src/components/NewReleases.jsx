import GameCarousel from "./GameCarousel";

const API_URL = import.meta.env.VITE_API_URL;

export default function NewReleases() {
  return (
    <GameCarousel
      url={`${API_URL}/api/new-releases`}
      title="New Releases"
      badgeText="New"
      showHero
      renderSubtitle={(item) =>
        item.released ? `Released ${item.released}` : "Release date N/A"
      }
    />
  );
}
