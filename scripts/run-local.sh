#!/usr/bin/env bash
# Starts NutriVerse on this machine: local Neo4j, Ollama, backend and frontend.
# Safe to run repeatedly. Press Ctrl+C to stop the backend and frontend.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  python3 - <<'PY'
import secrets
open(".env", "w").write(f"""NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD={secrets.token_urlsafe(24)}
AUTH_SECRET_KEY={secrets.token_urlsafe(48)}
GROQ_API_KEY=
OLLAMA_MODEL=llama3.2
AUTH_DEV_LOGIN=true
STT_BACKEND=none
""")
PY
  chmod 600 .env
fi
get_env() { grep "^$1=" .env | cut -d= -f2- || true; }

if [ ! -x .venv/bin/python ]; then
  python3.11 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt pandas
fi
[ -d Frontend/node_modules ] || (cd Frontend && npm ci --ignore-scripts)

# Only manage a database on this machine; never wipe one .env points elsewhere at.
case "$(get_env NEO4J_URI)" in
  bolt://localhost*|neo4j://localhost*|bolt://127.0.0.1*)
    if ! docker ps -a --format '{{.Names}}' | grep -q '^nutriverse-neo4j$'; then
      docker run -d --name nutriverse-neo4j --restart unless-stopped \
        -p 127.0.0.1:7474:7474 -p 127.0.0.1:7687:7687 \
        -v nutriverse-neo4j-data:/data \
        -e NEO4J_AUTH="neo4j/$(get_env NEO4J_PASSWORD)" neo4j:5 >/dev/null
    fi
    docker start nutriverse-neo4j >/dev/null
    until curl -s -m 2 http://localhost:7474 >/dev/null; do sleep 2; done

    recipes=$(.venv/bin/python - <<'PY'
import os
from dotenv import load_dotenv
from neo4j import GraphDatabase
load_dotenv()
auth = (os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"])
with GraphDatabase.driver(os.environ["NEO4J_URI"], auth=auth) as driver:
    print(driver.execute_query("MATCH (r:Recipe) RETURN count(r) AS c").records[0]["c"])
PY
)
    if [ "$recipes" = "0" ]; then
      echo "Loading recipe data (first run only)..."
      .venv/bin/python scripts/migrate_v2_dual_cluster.py
      .venv/bin/python scripts/tag_health_nodes.py
      .venv/bin/python scripts/generate_embeddings.py
    fi
    ;;
esac

if [ -z "$(get_env GROQ_API_KEY)" ] && ! curl -s -m 2 http://localhost:11434/api/tags >/dev/null; then
  nohup ollama serve >/dev/null 2>&1 &
fi

[ -n "$(get_env MODEL_PATH)" ] || echo "Note: MODEL_PATH is not set, so photo recognition is off."

trap 'kill 0' EXIT
.venv/bin/python -m uvicorn Backend.main:app --host 127.0.0.1 --port 8000 &
(cd Frontend && npx --no-install vite --host localhost --port 5173) &
echo "Starting: open http://localhost:5173 once the backend reports it is ready."
wait
