import { Link } from "react-router-dom";
import { Github } from "lucide-react";
import styles from "./Footer.module.css";

const REPO_URL = "https://github.com/Vishal-Shaw20/Game-Social";

/* Routes that exist in App.jsx. About / Contact / Privacy / Terms have no
   pages yet and land on the 404 route until they're built. */
const COLUMNS = [
  {
    heading: "Explore",
    links: [
      { label: "Home", to: "/" },
      { label: "Dashboard", to: "/dashboard" },
      { label: "Library", to: "/library" },
      { label: "Social", to: "/social" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Log in", to: "/login" },
      { label: "Sign up", to: "/signup" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", to: "/about" },
      { label: "Contact", to: "/contact" },
      { label: "Privacy", to: "/privacy" },
      { label: "Terms", to: "/terms" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <div className={styles.brandCol}>
            <Link to="/" className={styles.brand}>
              GameSocial
            </Link>
            <p className={styles.tagline}>
              Discover what's trending, track your library and play with
              friends, all in one place.
            </p>
            <div className={styles.social}>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GameSocial on GitHub"
                title="GitHub"
              >
                <Github size={18} strokeWidth={1.8} />
              </a>
            </div>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} className={styles.col} aria-label={col.heading}>
              <h3 className={styles.heading}>{col.heading}</h3>
              <ul>
                {col.links.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className={styles.bottom}>
          <span>© {new Date().getFullYear()} GameSocial. All rights reserved.</span>
          {/* RAWG's API terms require crediting them with a link. */}
          <span>
            Game data from{" "}
            <a href="https://rawg.io" target="_blank" rel="noopener noreferrer">
              RAWG
            </a>{" "}
            and{" "}
            <a href="https://steamspy.com" target="_blank" rel="noopener noreferrer">
              SteamSpy
            </a>
            . Not affiliated with Valve or Steam.
          </span>
        </div>
      </div>
    </footer>
  );
}
