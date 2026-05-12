import GameCarousel from "./GameCarousel";

const API_URL = import.meta.env.VITE_API_URL;

export default function GameSocialRecommended() {
  return (
    <GameCarousel
      url={`${API_URL}/api/gsrecommended`}
      title="GameSocial Picks"
      badgeText="Recommended"
      showHero
      renderSubtitle={(item) =>
        item.released ? `Released ${item.released}` : "Release date N/A"
      }
    />
  );
}
