# Smart Campus Complaint Management System (Node.js + MongoDB + Docker)

## Run
    docker compose up -d --build
Open http://localhost:8080

## Optional: Mongo Express database browser
    docker compose --profile tools up -d
Open http://localhost:8081 (user: admin, password: your MONGO_PASSWORD)

## Logs / status
    docker compose ps
    docker compose logs -f app

## Stop
    docker compose down          # keeps the data volume
    docker compose down -v       # also deletes all complaints
