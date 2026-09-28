import GameCarousel from "./GameCarousel";
import { formatRelease } from "../utils/formatRelease";

const API_URL = import.meta.env.VITE_API_URL;

export default function NewReleases() {
  return (
    <GameCarousel
      url={`${API_URL}/api/new-releases`}
      title="New Releases"
      renderDateTag={formatRelease}
    />
  );
}
