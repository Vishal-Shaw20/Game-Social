import PlatformIcon from "../PlatformIcon";
import GameYourStats from "./GameYourStats";
import { toPlatformFamilies } from "../../utils/normalizeGames";
import { scoreColor } from "../../utils/scoreColor";
import { date, full } from "./format";
import s from "./GameHero.module.css";

/* The title panel under the banner, in the dock and Trending card's
   language: on the left the game (name, who made it and when, genres and
   platforms, then pills for its Metacritic score, who's playing it now and
   its price); on the right your own card (GameYourStats) if you own it. Faintly tinted with the game's colour
   (--tint, set on the page by GameDetails). */
export default function GameHero({ game, me }) {
  const metacritic = game.ratings?.metacritic;
  const playing = game.players?.now;
  const price = game.price;
  const hasPrice = price && (price.isFree || price.finalFormatted);
  const families = toPlatformFamilies(game.platforms);
  const releaseLabel = game.comingSoon
    ? `Coming ${game.releaseText || date(game.released) || "soon"}`
    : date(game.released) || game.releaseText;

  const byline = [
    game.developers?.[0],
    game.publishers?.[0] && game.publishers[0] !== game.developers?.[0] ? game.publishers[0] : null,
    releaseLabel,
  ].filter(Boolean);

  return (
    <div className={s.panel}>
      <div className={s.main}>
        <h1 className={s.title}>
          {game.name}
          {game.originalName && <span className={s.originalName}>{game.originalName}</span>}
        </h1>
        {byline.length > 0 && <div className={s.byline}>{byline.join(" · ")}</div>}

        {(game.genres?.length > 0 || families.length > 0) && (
          <div className={s.chips}>
            {game.genres?.map((g) => (
              <span key={g} className={s.chip}>{g}</span>
            ))}
            {families.length > 0 && (
              <span className={s.platforms} title={game.platforms.join(", ")}>
                {families.map((f) => (
                  <PlatformIcon key={f.key} platform={f.key} size={15} />
                ))}
              </span>
            )}
          </div>
        )}

        {(metacritic != null || playing != null || hasPrice) && (
          <div className={s.pills}>
            {metacritic != null && (
              <span className={`${s.chip} ${s.pill}`}>
                Metacritic <b style={{ color: scoreColor(metacritic) }}>{metacritic}</b>
              </span>
            )}
            {playing != null && (
              <span className={`${s.chip} ${s.pill}`} title="Playing on Steam right now">
                <span className={s.liveDot} /> <b>{full(playing)}</b> playing now
              </span>
            )}
            {hasPrice && (
              <span className={`${s.chip} ${s.pill}`}>
                {price.isFree ? (
                  <b>Free to play</b>
                ) : (
                  <>
                    {price.discountPercent > 0 && (
                      <>
                        <span className={s.discount}>-{price.discountPercent}%</span>
                        <span className={s.strike}>{price.initialFormatted}</span>
                      </>
                    )}
                    <b>{price.finalFormatted}</b>
                  </>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      <GameYourStats me={me} />
    </div>
  );
}
