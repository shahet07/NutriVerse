from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    # Cluster A
    recipes: int
    ingredients: int
    image_classes: int
    # Cluster B
    food_products: int = 0
    brands: int = 0
    categories: int = 0
    # Cross-cluster
    allergen_tags: int = 0
    # Image model
    image_model_loaded: bool
    num_classes: int
    data_source: str = "neo4j"
