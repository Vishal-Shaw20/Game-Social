import { useCallback, useState } from "react";
import { useLocation } from "react-router-dom";
import QuickLook from "./QuickLook";
import { QuickLookContext, toSeed } from "./quickLookContext";

/*
 * Holds the app's one quick look: which game it shows, the list ← / → step
 * through, and the page it was opened on (leaving that page closes it).
 */
export default function QuickLookProvider({ children }) {
  const location = useLocation();
  const [look, setLook] = useState(null); // { seed, list, onShelf, path }

  const open = useCallback(
    (game, { list = [], onShelf = null } = {}) => {
      const seed = toSeed(game);
      if (!seed?.rawgId) return;
      const seeds = list.map(toSeed).filter((s) => s?.rawgId);
      setLook({ seed, list: seeds, onShelf, path: location.pathname });
    },
    [location.pathname]
  );
  const close = useCallback(() => setLook(null), []);
  const step = useCallback(
    (dir) =>
      setLook((l) => {
        // (a list can repeat a game, e.g. the homepage's art wall: step by
        // distinct games)
        const ids = [...new Set(l?.list.map((s) => s.rawgId) ?? [])];
        if (ids.length < 2) return l;
        const i = ids.indexOf(l.seed.rawgId);
        const next = ids[(i + dir + ids.length) % ids.length];
        return { ...l, seed: l.list.find((s) => s.rawgId === next) };
      }),
    []
  );

  // Left the page it was opened on (a link, Back): it's gone, not waiting
  // there for when you come back.
  if (look && look.path !== location.pathname) setLook(null);

  return (
    <QuickLookContext.Provider value={open}>
      {children}
      {look && look.path === location.pathname && <QuickLook seed={look.seed} onClose={close} onStep={step} onShelf={look.onShelf} />}
    </QuickLookContext.Provider>
  );
}
