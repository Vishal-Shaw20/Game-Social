def clean_field(field):
    if isinstance(field, list):
        return ", ".join(field)
    if isinstance(field, dict):
        return field.get("name", "")
    return field or ""


def build_structured_text(name, genres, tags, esrb, developers, publishers, description):
    if name:
        core = f"CORE IDENTITY: This game is {name}, an {genres} title. "
    else:
        core = f"CORE IDENTITY: An {genres} title. "

    text = (
        core +
        f"GAMEPLAY MECHANICS: {genres} gameplay involving {tags}. "
        f"NARRATIVE THEME: The setting and story involve {description}. "
        f"AUDIENCE: Rated {esrb} by ESRB. "
        f"STUDIO: Developed by {developers}, published by {publishers}."
    )

    return f"Represent this game for retrieving similar gameplay experiences: {text}"
