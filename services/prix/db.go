package prix

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

var pool *pgxpool.Pool

func InitDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://prix:prix@localhost:5432/prix"
	}

	var err error
	pool, err = pgxpool.New(context.Background(), dbURL)
	if err != nil {
		return fmt.Errorf("unable to connect to database: %w", err)
	}

	return nil
}

func CloseDB() {
	if pool != nil {
		pool.Close()
	}
}

func GetDB() *pgxpool.Pool {
	return pool
}
