from recommender.text_builder import build_structured_text, clean_field


# -------------------- clean_field --------------------

def test_clean_field_list():
    assert clean_field(["Action", "RPG"]) == "Action, RPG"


def test_clean_field_dict():
    assert clean_field({"name": "Mature", "slug": "mature"}) == "Mature"


def test_clean_field_string():
    assert clean_field("Action") == "Action"


def test_clean_field_none():
    assert clean_field(None) == ""


def test_clean_field_empty_list():
    assert clean_field([]) == ""


# -------------------- build_structured_text --------------------

def test_build_structured_text_contains_all_sections():
    result = build_structured_text(
        name="GTA V",
        genres="Action, Adventure",
        tags="Open World, Crime",
        esrb="Mature",
        developers="Rockstar North",
        publishers="Rockstar Games",
        description="Crime game set in Los Santos",
    )
    assert "CORE IDENTITY: This game is GTA V" in result
    assert "GAMEPLAY MECHANICS: Action, Adventure gameplay involving Open World, Crime" in result
    assert "NARRATIVE THEME: The setting and story involve Crime game set in Los Santos" in result
    assert "AUDIENCE: Rated Mature by ESRB" in result
    assert "STUDIO: Developed by Rockstar North, published by Rockstar Games" in result
    assert result.startswith("Represent this game for retrieving similar gameplay experiences:")


def test_build_structured_text_handles_empty_fields():
    result = build_structured_text(
        name="",
        genres="",
        tags="",
        esrb="",
        developers="",
        publishers="",
        description="",
    )
    assert "CORE IDENTITY:" in result
    assert "Represent this game for retrieving" in result


def test_build_structured_text_prefix_is_exact():
    """The BGE instruction prefix must never change — embeddings depend on it."""
    result = build_structured_text("X", "", "", "", "", "", "")
    prefix = "Represent this game for retrieving similar gameplay experiences: "
    assert result.startswith(prefix)
