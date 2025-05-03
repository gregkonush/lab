package prix

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"time"

	"github.com/google/go-github/v71/github"
)

// GithubRepository maps to the github_repositories table
type GithubRepository struct {
	ID              int64      `db:"id"`
	GithubID        int64      `db:"github_id"`
	NodeID          string     `db:"node_id"`
	Name            string     `db:"name"`
	FullName        string     `db:"full_name"`
	HTMLURL         string     `db:"html_url"`
	Description     *string    `db:"description"`
	StargazersCount int        `db:"stargazers_count"`
	WatchersCount   int        `db:"watchers_count"`
	ForksCount      int        `db:"forks_count"`
	OpenIssuesCount int        `db:"open_issues_count"`
	Language        *string    `db:"language"`
	GithubCreatedAt *time.Time `db:"github_created_at"`
	GithubUpdatedAt *time.Time `db:"github_updated_at"`
	GithubPushedAt  *time.Time `db:"github_pushed_at"`
	ReadmeContent   *string    `db:"readme_content"`
	CreatedAt       time.Time  `db:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at"`
}

// DefaultPerPage defines the default number of repos per page from GitHub API
const DefaultPerPage = 100

// SearchMostPopularRepos searches for GitHub repositories with more than 10,000 stars,
// fetches their details (including README content), and upserts the information
// into the `github_repositories` database table.
// It processes results page by page from the GitHub API.
// Returns an error if the search or database operations fail.
func SearchMostPopularRepos(ctx context.Context) error {
	// Add a timeout for the overall operation
	var cancel context.CancelFunc
	ctx, cancel = context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	ghClient := github.NewClient(nil)
	opts := &github.SearchOptions{
		Sort:        "stars",
		Order:       "desc",
		ListOptions: github.ListOptions{PerPage: DefaultPerPage},
	}
	result, resp, err := ghClient.Search.Repositories(ctx, "stars:>10000", opts)
	if err != nil {
		log.Printf("Error searching repositories: %v", err)
		return fmt.Errorf("failed to search repositories: %w", err)
	}

	dbPool := GetDB()
	if dbPool == nil {
		log.Println("DB pool is not initialized")
		return fmt.Errorf("database connection pool not available")
	}

	log.Printf("Found %d repos\n", *result.Total)
	maxRetries := 3 // Define max retries for API calls
	for {           // Loop through all pages
		for _, repo := range result.Repositories {
			// Basic nil checks for essential fields used later
			if repo == nil {
				log.Println("Skipping nil repository object")
				continue
			}
			if repo.FullName == nil || repo.HTMLURL == nil || repo.ID == nil || repo.NodeID == nil || repo.Name == nil || repo.Owner == nil || repo.Owner.Login == nil {
				repoIdStr := "unknown ID"
				if repo.ID != nil { // ID might be nil itself, but we check it in the condition
					repoIdStr = fmt.Sprintf("ID %d", *repo.ID)
				}
				log.Printf("Skipping repository (%s) due to missing essential information", repoIdStr)
				continue
			}

			log.Printf("Processing repo: %s\n", *repo.FullName)

			var readme *github.RepositoryContent
			var readmeDecoded *string

			// Guard against nils specifically needed for GetReadme
			if repo.Owner == nil || repo.Owner.Login == nil || repo.Name == nil {
				log.Printf("Skipping GetReadme for repo %s: missing owner/name data", *repo.FullName)
				// Continue processing without trying to fetch the README.
			} else {
				var getReadmeErr error // Use a different variable name to avoid shadowing
				readme, _, getReadmeErr = ghClient.Repositories.GetReadme(ctx, *repo.Owner.Login, *repo.Name, nil)
				if getReadmeErr != nil {
					log.Printf("Could not get README for %s: %v", *repo.FullName, getReadmeErr)
				} else if readme == nil || readme.Content == nil { // Also check if readme itself is nil
					log.Printf("README content is nil or unavailable for %s", *repo.FullName)
				} else {
					content, decodeErr := base64.StdEncoding.DecodeString(*readme.Content)
					if decodeErr != nil {
						log.Printf("Could not decode README content for %s: %v", *repo.FullName, decodeErr)
					} else {
						contentStr := string(content)
						readmeDecoded = &contentStr
					}
				}
			}

			// Use repo description as fallback if README couldn't be fetched/decoded
			if readmeDecoded == nil && repo.Description != nil {
				log.Printf("Using repo description as fallback for %s", *repo.FullName)
				readmeDecoded = repo.Description
			}

			repoData := GithubRepository{
				GithubID:        *repo.ID,
				NodeID:          *repo.NodeID,
				Name:            *repo.Name,
				FullName:        *repo.FullName,
				HTMLURL:         *repo.HTMLURL,
				Description:     repo.Description,
				StargazersCount: *repo.StargazersCount,
				WatchersCount:   *repo.WatchersCount,
				ForksCount:      *repo.ForksCount,
				OpenIssuesCount: *repo.OpenIssuesCount,
				Language:        repo.Language,
				GithubCreatedAt: &repo.CreatedAt.Time,
				GithubUpdatedAt: &repo.UpdatedAt.Time,
				GithubPushedAt:  &repo.PushedAt.Time,
				ReadmeContent:   readmeDecoded,
			}

			query := `
            INSERT INTO github_repositories (
                github_id, node_id, name, full_name, html_url, description,
                stargazers_count, watchers_count, forks_count, open_issues_count,
                language, github_created_at, github_updated_at, github_pushed_at,
                readme_content, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
            )
            ON CONFLICT (github_id) DO UPDATE SET
                node_id = EXCLUDED.node_id,
                name = EXCLUDED.name,
                full_name = EXCLUDED.full_name,
                html_url = EXCLUDED.html_url,
                description = EXCLUDED.description,
                stargazers_count = EXCLUDED.stargazers_count,
                watchers_count = EXCLUDED.watchers_count,
                forks_count = EXCLUDED.forks_count,
                open_issues_count = EXCLUDED.open_issues_count,
                language = EXCLUDED.language,
                github_updated_at = EXCLUDED.github_updated_at,
                github_pushed_at = EXCLUDED.github_pushed_at,
                readme_content = EXCLUDED.readme_content,
                updated_at = NOW();
        `

			_, err = dbPool.Exec(ctx, query,
				repoData.GithubID, repoData.NodeID, repoData.Name, repoData.FullName, repoData.HTMLURL,
				repoData.Description, repoData.StargazersCount, repoData.WatchersCount, repoData.ForksCount,
				repoData.OpenIssuesCount, repoData.Language, repoData.GithubCreatedAt, repoData.GithubUpdatedAt,
				repoData.GithubPushedAt, repoData.ReadmeContent,
			)

			if err != nil {
				log.Printf("Error upserting repo %s: %v", *repo.FullName, err)
				// Fail the activity on DB error to allow Temporal retries
				return fmt.Errorf("db upsert failed for repo %s: %w", *repo.FullName, err)
			}
		}

		if resp.NextPage == 0 {
			break // Exit loop if there are no more pages
		}
		opts.Page = resp.NextPage
		// Apply same retry logic for pagination
		for attempts := 0; attempts < maxRetries; attempts++ {
			result, resp, err = ghClient.Search.Repositories(ctx, "stars:>10000", opts)
			if err == nil {
				break // Success
			}

			// Check if we hit rate limit
			if _, ok := err.(*github.RateLimitError); ok {
				log.Printf("Hit rate limit on page %d, waiting before retry %d/%d", opts.Page, attempts+1, maxRetries)
				time.Sleep(time.Second * time.Duration(2<<attempts)) // Exponential backoff
				continue
			}

			// Other errors, break the retry loop (don't retry non-rate-limit errors here)
			log.Printf("Non-rate-limit error on page %d, attempt %d/%d: %v", opts.Page, attempts+1, maxRetries, err)
			break
		}

		if err != nil {
			log.Printf("Error searching repositories on page %d after %d attempts: %v", opts.Page, maxRetries, err)
			if resp != nil {
				log.Printf("Response status: %s", resp.Status)
			}
			return fmt.Errorf("failed to search repositories on page %d: %w", opts.Page, err)
		}
	}

	log.Println("Finished processing repositories.")
	return nil
}
