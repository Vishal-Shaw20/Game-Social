import { useEffect, useState } from "react";
import DOMPurify from "dompurify";

function RAWGTest() {
  const [game, setGame] = useState(null);

  useEffect(() => {
    const gameId = 3498;

    fetch(`${import.meta.env.VITE_API_URL}/api/rawg/game/${gameId}`)
      .then((res) => res.json())
      .then((json) => {
        console.log("RAWG RAW DATA:", json);
        setGame(json);
      })
      .catch((err) => console.error(err));
  }, []);

  return (
    <div style={{ padding: "20px" }}>
      <h2>RAWG Game Details</h2>

      {game ? (
        <div>
          <h3>{game.name}</h3>
          <p>⭐ Rating: {game.rating}</p>
          <p>Released: {game.released}</p>

          {game.background_image && (
            <img
              src={game.background_image}
              alt={game.name}
              width="400"
              style={{ borderRadius: "10px", margin: "10px 0" }}
            />
          )}

          <h4>Description:</h4>
          <div
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(game.description) }}
            style={{ maxWidth: "600px" }}
          />

          <h3 style={{ marginTop: "30px" }}>All API Data</h3>

          <pre
            style={{
              padding: "15px",
              background: "#111",
              color: "#0f0",
              borderRadius: "10px",
              overflowX: "auto",
              maxHeight: "500px"
            }}
          >
{JSON.stringify(game, null, 2)}
          </pre>
        </div>
      ) : (
        <p>Loading...</p>
      )}
    </div>
  );
}

export default RAWGTest;
