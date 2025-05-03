CREATE TABLE IF NOT EXISTS github_repositories (
    id SERIAL PRIMARY KEY,
    github_id BIGINT UNIQUE NOT NULL,
    node_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    full_name VARCHAR(511) UNIQUE NOT NULL,
    html_url VARCHAR(2048) NOT NULL,
    description TEXT,
    stargazers_count INT DEFAULT 0,
    watchers_count INT DEFAULT 0,
    forks_count INT DEFAULT 0,
    open_issues_count INT DEFAULT 0,
    language VARCHAR(100),
    github_created_at TIMESTAMPTZ,
    github_updated_at TIMESTAMPTZ,
    github_pushed_at TIMESTAMPTZ,
    readme_content TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Add an index for faster lookups on full_name
CREATE INDEX IF NOT EXISTS idx_github_repositories_full_name ON github_repositories (full_name);
