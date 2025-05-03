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

func SearchMostPopularRepos(ctx context.Context) error {
	ghClient := github.NewClient(nil)
	opts := &github.SearchOptions{
		Sort:        "stars",
		Order:       "desc",
		ListOptions: github.ListOptions{PerPage: 100},
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
	for { // Loop through all pages
		for _, repo := range result.Repositories {
			log.Printf("Processing repo: %s\n", *repo.FullName)

			readme, _, err := ghClient.Repositories.GetReadme(ctx, *repo.Owner.Login, *repo.Name, nil)
			var readmeDecoded *string
			if err != nil {
				log.Printf("Could not get README for %s: %v", *repo.FullName, err)
			} else {
				content, err := base64.StdEncoding.DecodeString(*readme.Content)
				if err != nil {
					log.Printf("Could not decode README content for %s: %v", *repo.FullName, err)
				} else {
					contentStr := string(content)
					readmeDecoded = &contentStr
				}
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
			}
		}

		if resp.NextPage == 0 {
			break // Exit loop if there are no more pages
		}
		opts.Page = resp.NextPage
		result, resp, err = ghClient.Search.Repositories(ctx, "stars:>10000", opts)
		if err != nil {
			log.Printf("Error searching repositories on page %d: %v", opts.Page, err)
			return fmt.Errorf("failed to search repositories on page %d: %w", opts.Page, err)
		}
	}

	log.Println("Finished processing repositories.")
	return nil
}
