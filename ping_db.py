import os
from neo4j import GraphDatabase

# Fetch credentials from environment variables (set by GitHub Actions)
URI = os.getenv("NEO4J_URI")
USER = os.getenv("NEO4J_USER")
PASSWORD = os.getenv("NEO4J_PASSWORD")

def ping_database():
    try:
        # Establish connection
        driver = GraphDatabase.driver(URI, auth=(USER, PASSWORD))
        driver.verify_connectivity()
        
        records, summary, keys = driver.execute_query(
            "RETURN 1 AS ping",
        )
        print(" Successfully pinged Neo4j database to keep it awake!")
        driver.close()
        
    except Exception as e:
        print(f" Failed to connect to Neo4j: {e}")
        exit(1)

if __name__ == "__main__":
    ping_database()