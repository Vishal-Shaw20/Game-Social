import GameCarousel from "./GameCarousel";
import { formatRelease } from "../utils/formatRelease";

const API_URL = import.meta.env.VITE_API_URL;

// Games not out yet, soonest release first (/api/upcoming), with the full
// release date in the card's top-left tag, as New Releases shows it.
export default function Upcoming() {
  return (
    <GameCarousel
      url={`${API_URL}/api/upcoming`}
      title="Upcoming"
      renderDateTag={formatRelease}
    />
  );
}
