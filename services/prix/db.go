package prix

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var pool *pgxpool.Pool

func InitDB() error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://prix:prix@localhost:5432/prix"
	}

	var err error
	maxRetries := 5
	var retryErr error

	for i := 0; i < maxRetries; i++ {
		// Create a context with timeout for each attempt
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)

		pool, err = pgxpool.New(ctx, dbURL)
		cancel() // Cancel the context once New returns or times out

		if err == nil {
			// Verify connection works before breaking loop
			pingCtx, pingCancel := context.WithTimeout(context.Background(), 5*time.Second)
			err = pool.Ping(pingCtx)
			pingCancel()
			if err == nil {
				break // Connection successful and ping verified
			} else {
				log.Printf("Database ping failed after connect (attempt %d/%d): %v", i+1, maxRetries, err)
				// Close the pool if ping fails, as it might be invalid
				pool.Close()
				pool = nil
			}
		}

		retryErr = err // Store the last error
		log.Printf("Failed to connect to database (attempt %d/%d): %v", i+1, maxRetries, err)
		if i < maxRetries-1 { // Don't sleep after the last attempt
			time.Sleep(time.Duration(i+1) * time.Second) // Exponential backoff
		}
	}

	// If pool is still nil after all retries, return the last error
	if pool == nil {
		return fmt.Errorf("unable to connect to database after %d attempts: %w", maxRetries, retryErr)
	}

	log.Println("Database connection established successfully")
	return nil
}

func CloseDB() {
	if pool != nil {
		pool.Close()
	}
}

func GetDB() *pgxpool.Pool {
	if pool == nil {
		log.Println("Warning: Attempting to access database pool before initialization")
	}
	return pool
}
