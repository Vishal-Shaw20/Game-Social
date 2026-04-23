"""
GAMIQ Eval Script
Hits the recommend endpoint for all test cases and prints + saves results.

Usage: python eval.py
"""

import requests
import psycopg2
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from recommender.config import DB_CONFIG

API_BASE = "http://127.0.0.1:8000"  # change if needed
ENDPOINT = "/recommend"             # change if needed

TEST_CASES = [
    {"id": 3498, "name": "Grand Theft Auto V"},
    {"id": 28, "name": "Red Dead Redemption 2"},
    {"id": 3328, "name": "The Witcher 3: Wild Hunt"},
    {"id": 58175, "name": "God of War (2018)"},
    {"id": 2551, "name": "Dark Souls III"},
    {"id": 326243, "name": "Elden Ring"},
    {"id": 50734, "name": "Sekiro: Shadows Die Twice"},
    {"id": 3387, "name": "Bloodborne"},
    {"id": 437059, "name": "Assassins Creed Valhalla"},

    {"id": 323065, "name": "Call of Duty: Modern Warfare (2019)"},
    {"id": 998, "name": "Battlefield 1"},
    {"id": 58777, "name": "DOOM Eternal"},
    {"id": 965470, "name": "Counter-Strike 2"},

    {"id": 29177, "name": "Detroit: Become Human"},
    {"id": 3439, "name": "Life is Strange"},
    {"id": 2743, "name": "Heavy Rain"},
    {"id": 3209, "name": "Until Dawn"},

    {"id": 22509, "name": "Minecraft"},
    {"id": 422, "name": "Terraria"},
    {"id": 248521, "name": "Valheim"},
    {"id": 2093, "name": "No Mans Sky"},

    {"id": 823549, "name": "FIFA 23"},
    {"id": 872266, "name": "Football Manager 2023"},
    {"id": 846505, "name": "NBA 2K23"},
    {"id": 914781, "name": "WWE 2K23"},

    {"id": 22121, "name": "Celeste"},
    {"id": 9767, "name": "Hollow Knight"},
    {"id": 11726, "name": "Dead Cells"},
    {"id": 19590, "name": "Ori and the Blind Forest"},

    {"id": 4200, "name": "Portal 2"},
    {"id": 12929, "name": "The Talos Principle"},
    {"id": 327219, "name": "Superliminal"},
    {"id": 13247, "name": "Human: Fall Flat"},

    {"id": 622492, "name": "Forza Horizon 5"},
    {"id": 452633, "name": "Gran Turismo 7"},
    {"id": 364806, "name": "Need for Speed Heat"},
    {"id": 962397, "name": "F1 23"},
]


def fetch(game_id: int) -> list:
    resp = requests.post(
        f"{API_BASE}{ENDPOINT}",
        json={"rawg_ids": [game_id]},
        timeout=120
    )
    resp.raise_for_status()

    result = resp.json()
    ids = result.get("rawg_ids", [])

    # flatten if nested
    if ids and isinstance(ids[0], list):
        ids = [i for sub in ids for i in sub]

    return ids


def get_names(ids: list, conn) -> dict:
    if not ids:
        return {}

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, name FROM games WHERE id = ANY(%s)",
            (ids,)
        )
        return {row[0]: row[1] for row in cur.fetchall()}


def main():
    conn = psycopg2.connect(**DB_CONFIG)

    output_blocks = []

    for tc in TEST_CASES:
        print(f"Fetching {tc['name']} ({tc['id']})...", flush=True)

        try:
            ids = fetch(tc["id"])
            names = get_names(ids, conn)

            lines = [f"{tc['name']} (ID: {tc['id']})"]

            for rank, gid in enumerate(ids, 1):
                lines.append(f"{rank}. {gid} - {names.get(gid, 'Unknown')}")

            output_blocks.append("\n".join(lines))

        except Exception as e:
            output_blocks.append(
                f"{tc['name']} (ID: {tc['id']})\nERROR: {e}"
            )

    conn.close()

    # final structured output
    final_output = "=== TEST RESULTS ===\n\n" + "\n\n".join(output_blocks)

    # print to terminal
    print("\n" + "=" * 50 + "\n")
    print(final_output)

    # save to file (overwrite each run)
    with open("C:\\Users\\KIIT0001\\Documents\\Projects\\Gamiq\\docs\\gamiq_eval_output.txt", "w", encoding="utf-8") as f:
        f.write(final_output)


if __name__ == "__main__":
    main()