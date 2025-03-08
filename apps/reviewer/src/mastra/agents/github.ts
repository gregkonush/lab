import { anthropic } from '@ai-sdk/anthropic'
import { createTool } from '@mastra/core/tools'
import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { Octokit } from 'octokit'

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
})

// Helper function to parse diff text
function parseDiff(diffText: string) {
  const files = []
  const fileHeaders = diffText.split('diff --git ')

  // Skip the first empty element
  for (let i = 1; i < fileHeaders.length; i++) {
    const fileHeader = fileHeaders[i]
    const fileNameMatch = fileHeader.match(/a\/(.*?) b\//)

    if (fileNameMatch?.[1]) {
      const path = fileNameMatch[1]
      const diffLines = fileHeader.split('\n')

      // Count additions and deletions
      let additions = 0
      let deletions = 0

      for (const line of diffLines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++
        }
      }

      files.push({
        path,
        diff: fileHeader,
        additions,
        deletions,
        changes: additions + deletions,
      })
    }
  }

  return files
}

// Helper function to find line positions in diff
function findPositionInDiff(diffText: string, filePath: string, lineNumber: number): number | undefined {
  console.log(`[GitHub] Finding position in diff for ${filePath}:${lineNumber}`)

  const files = parseDiff(diffText)
  console.log(`[GitHub] Parsed ${files.length} files from diff`)

  const fileDiff = files.find((file) => file.path === filePath)
  if (!fileDiff) {
    console.log(`[GitHub] File ${filePath} not found in diff`)
    return undefined
  }

  console.log(
    `[GitHub] Found file ${filePath} in diff with ${fileDiff.additions} additions, ${fileDiff.deletions} deletions`,
  )

  const lines = fileDiff.diff.split('\n')
  console.log(`[GitHub] Diff for ${filePath} has ${lines.length} lines`)

  let currentLine = 0
  let position = 0
  const headerLines = 0
  const debugLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    position++

    // Skip diff header lines
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('@@')
    ) {
      continue
    }

    // Count lines in the new file
    if (!line.startsWith('-')) {
      currentLine++

      // Store some context for debugging
      if (Math.abs(currentLine - lineNumber) <= 3) {
        debugLines.push(
          `Line ${currentLine} (position ${position}): ${line.substring(0, 50)}${line.length > 50 ? '...' : ''}`,
        )
      }
    }

    if (currentLine === lineNumber) {
      console.log(`[GitHub] Found position ${position} for line ${lineNumber} in ${filePath}`)
      console.log(`[GitHub] Context around line ${lineNumber}:`)
      for (const l of debugLines) {
        console.log(`  ${l}`)
      }
      return position
    }
  }

  console.log(`[GitHub] Could not find position for line ${lineNumber} in ${filePath}`)
  console.log(`[GitHub] Last line reached: ${currentLine}, header lines: ${headerLines}`)
  if (debugLines.length > 0) {
    console.log('[GitHub] Last context lines:')
    for (const l of debugLines) {
      console.log(`  ${l}`)
    }
  }

  return undefined
}

export const githubTools = {
  commentOnLineNumber: createTool({
    id: 'commentOnLineNumber',
    description: 'Comment on a specific line number in a file',
    inputSchema: z.object({
      file: z.string(),
      lineNumber: z.number(),
      comment: z.string(),
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
      side: z.enum(['RIGHT', 'LEFT']).optional(),
      position: z.number().optional(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string().optional(),
    }),
    execute: async ({
      context: { file, lineNumber, comment, owner, repo, pullNumber: pull_number, side = 'RIGHT', position },
    }) => {
      console.log(`[GitHub] Getting PR ${owner}/${repo}#${pull_number}`)
      try {
        const { data: pr } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number,
        })
        console.log(`[GitHub] Found PR ${owner}/${repo}#${pull_number}, head SHA: ${pr.head.sha}`)

        // If position is not provided, try to find it in the diff
        if (!position) {
          console.log(`[GitHub] Finding position for ${file}:${lineNumber}`)
          const { data: diffData } = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number,
            mediaType: {
              format: 'diff',
            },
          })
          console.log(
            `[GitHub] Retrieved diff for PR ${owner}/${repo}#${pull_number}, size: ${diffData.toString().length} bytes`,
          )

          const diffText = diffData.toString()
          position = findPositionInDiff(diffText, file, lineNumber)

          if (!position) {
            console.log(`[GitHub] Failed to find position for ${file}:${lineNumber} in the diff`)
            return {
              success: false,
              message: `Could not find position for ${file}:${lineNumber} in the diff`,
            }
          }
        }

        console.log(`[GitHub] Creating review comment on ${file}:${lineNumber} at position ${position}, side: ${side}`)
        console.log(
          `[GitHub] Comment content (first 100 chars): ${comment.substring(0, 100)}${comment.length > 100 ? '...' : ''}`,
        )

        const response = await octokit.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number,
          commit_id: pr.head.sha,
          path: file,
          line: lineNumber,
          side,
          position,
          body: comment,
        })

        console.log(`[GitHub] Successfully created comment with ID: ${response.data.id}`)
        console.log(`[GitHub] Comment URL: ${response.data.html_url}`)

        return {
          success: true,
          message: `Comment added to ${file}:${lineNumber}`,
        }
      } catch (error: unknown) {
        console.error('[GitHub] Error commenting on line:', error)
        if (error instanceof Error) {
          console.error(`[GitHub] Error details: ${error.message}`)
          if ('response' in error) {
            // @ts-ignore
            console.error(`[GitHub] API response: ${JSON.stringify(error.response?.data)}`)
          }
        }
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }),

  batchCreateComments: createTool({
    id: 'batchCreateComments',
    description: 'Create multiple review comments in a single review',
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
      comments: z.array(
        z.object({
          path: z.string(),
          line: z.number(),
          body: z.string(),
          side: z.enum(['RIGHT', 'LEFT']).optional(),
          position: z.number().optional(),
        }),
      ),
      reviewBody: z.string().optional(),
      event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).optional(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string().optional(),
      commentCount: z.number().optional(),
    }),
    execute: async ({
      context: { owner, repo, pullNumber: pull_number, comments, reviewBody = '', event = 'COMMENT' },
    }) => {
      console.log(`[GitHub] Creating batch review with ${comments.length} comments for ${owner}/${repo}#${pull_number}`)
      console.log(`[GitHub] Review event: ${event}, body length: ${reviewBody.length} chars`)

      try {
        const { data: pr } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number,
        })
        console.log(`[GitHub] Found PR ${owner}/${repo}#${pull_number}, head SHA: ${pr.head.sha}`)

        // If positions are not provided for comments, try to find them in the diff
        console.log('[GitHub] Retrieving diff to find positions for comments')
        const { data: diffData } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number,
          mediaType: {
            format: 'diff',
          },
        })
        console.log(`[GitHub] Retrieved diff, size: ${diffData.toString().length} bytes`)

        const diffText = diffData.toString()

        // Prepare comments with positions
        console.log(`[GitHub] Processing ${comments.length} comments to find positions`)
        const commentsWithPositions = await Promise.all(
          comments.map(async (comment, index) => {
            console.log(
              `[GitHub] Processing comment ${index + 1}/${comments.length} for ${comment.path}:${comment.line}`,
            )

            if (!comment.position) {
              console.log(`[GitHub] Finding position for ${comment.path}:${comment.line}`)
              const position = findPositionInDiff(diffText, comment.path, comment.line)

              if (!position) {
                console.warn(`[GitHub] Could not find position for ${comment.path}:${comment.line}`)
                return null
              }

              console.log(`[GitHub] Found position ${position} for ${comment.path}:${comment.line}`)
              return {
                ...comment,
                position,
                side: comment.side || 'RIGHT',
              }
            }

            console.log(`[GitHub] Using provided position ${comment.position} for ${comment.path}:${comment.line}`)
            return {
              ...comment,
              side: comment.side || 'RIGHT',
            }
          }),
        )

        // Filter out comments where position couldn't be found
        const validComments = commentsWithPositions.filter(
          (comment): comment is NonNullable<typeof comment> => comment !== null,
        )

        console.log(`[GitHub] Found valid positions for ${validComments.length}/${comments.length} comments`)

        if (validComments.length === 0) {
          console.log('[GitHub] No valid comments found, aborting review creation')
          return {
            success: false,
            message: 'Could not find valid positions for any comments',
            commentCount: 0,
          }
        }

        // Create a review with all comments
        console.log(`[GitHub] Creating review with ${validComments.length} comments`)
        const response = await octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number,
          commit_id: pr.head.sha,
          body: reviewBody,
          event,
          comments: validComments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            side: comment.side,
            position: comment.position,
            body: comment.body,
          })),
        })

        console.log(`[GitHub] Successfully created review with ID: ${response.data.id}`)

        return {
          success: true,
          message: `Created review with ${validComments.length} comments`,
          commentCount: validComments.length,
        }
      } catch (error: unknown) {
        console.error('[GitHub] Error creating batch comments:', error)
        if (error instanceof Error) {
          console.error(`[GitHub] Error details: ${error.message}`)
          if ('response' in error) {
            // @ts-ignore
            console.error(`[GitHub] API response: ${JSON.stringify(error.response?.data)}`)
          }
        }
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
          commentCount: 0,
        }
      }
    },
  }),

  submitReview: createTool({
    id: 'submitReview',
    description: 'Submit a review for the entire PR',
    inputSchema: z.object({
      body: z.string(),
      event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string().optional(),
    }),
    execute: async ({ context: { body, event, owner, repo, pullNumber: pull_number } }) => {
      console.log(`[GitHub] Submitting review for ${owner}/${repo}#${pull_number} with event ${event}`)
      try {
        await octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number,
          body,
          event,
        })

        return {
          success: true,
          message: `Review submitted with event: ${event}`,
        }
      } catch (error: unknown) {
        console.error('[GitHub] Error submitting review:', error)
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }),

  getDiff: createTool({
    id: 'getDiff',
    description: 'Get the diff for a specific file in the PR',
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
      filePath: z.string(),
    }),
    outputSchema: z.object({
      path: z.string(),
      diff: z.string().optional(),
      additions: z.number().optional(),
      deletions: z.number().optional(),
      changes: z.number().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ context: { owner, repo, pullNumber: pull_number, filePath } }) => {
      console.log(`[GitHub] Getting diff for file ${filePath} in ${owner}/${repo}#${pull_number}`)

      try {
        // Check if file exists in PR
        const { data: files } = await octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number,
        })

        const fileExists = files.some((file) => file.filename === filePath)
        if (!fileExists) {
          console.log(`[GitHub] File ${filePath} not found in PR ${owner}/${repo}#${pull_number}`)
          return {
            path: filePath,
            error: 'File not found in PR',
          }
        }

        // Get diff for the file
        const { data } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number,
          mediaType: {
            format: 'diff',
          },
        })

        // Parse the diff to extract just the requested file
        const diffText = data.toString()
        const fileDiffs = parseDiff(diffText)
        const fileDiff = fileDiffs.find((diff) => diff.path === filePath)

        if (!fileDiff) {
          console.log(`[GitHub] Diff for ${filePath} not found in PR ${owner}/${repo}#${pull_number}`)
          return {
            path: filePath,
            error: 'Diff not found for file',
          }
        }

        console.log(`[GitHub] Successfully retrieved diff for ${filePath}`)
        return {
          path: filePath,
          diff: fileDiff.diff,
          additions: fileDiff.additions,
          deletions: fileDiff.deletions,
          changes: fileDiff.changes,
        }
      } catch (error: unknown) {
        console.error(`[GitHub] Error getting diff for ${filePath}:`, error)
        return {
          path: filePath,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }),

  getFiles: createTool({
    id: 'getFiles',
    description: 'Get list of files changed in the PR',
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
      page: z.number().optional(),
      perPage: z.number().optional(),
      skipLockFiles: z.boolean().optional(),
      maxFileSize: z.number().optional(),
    }),
    outputSchema: z.object({
      files: z.array(
        z.object({
          filename: z.string(),
          changes: z.number(),
          additions: z.number(),
          deletions: z.number(),
          status: z.string(),
        }),
      ),
      page: z.number(),
      perPage: z.number(),
      hasMore: z.boolean(),
      skipped: z.array(z.string()),
      totalFiles: z.number(),
      filteredFiles: z.number(),
    }),
    execute: async ({
      context: {
        owner,
        repo,
        pullNumber: pull_number,
        page = 1,
        perPage = 30,
        skipLockFiles = true,
        maxFileSize = 100000,
      },
    }) => {
      console.log(`[GitHub] Getting changed files for ${owner}/${repo}#${pull_number} (page ${page})`)
      const { data } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number,
        per_page: perPage * 2, // Fetch more to account for filtered files
        page,
      })

      console.log(`[GitHub] Found ${data.length} files in PR ${owner}/${repo}#${pull_number}`)

      // Log file sizes to help diagnose issues
      for (const file of data) {
        console.log(
          `[GitHub] File: ${file.filename}, Size: ${file.changes} changes, ${file.additions} additions, ${file.deletions} deletions`,
        )
      }

      let filteredFiles = data
      if (skipLockFiles) {
        const lockFilePatterns = [
          /package-lock\.json$/,
          /yarn\.lock$/,
          /pnpm-lock\.yaml$/,
          /Gemfile\.lock$/,
          /Cargo\.lock$/,
          /composer\.lock$/,
          /poetry\.lock$/,
          /\.lock$/,
          /\.sum$/,
          /\.snap$/,
          /\.min\.(js|css)$/,
          /\.d\.ts$/,
        ]

        const beforeCount = filteredFiles.length
        filteredFiles = filteredFiles.filter((file) => !lockFilePatterns.some((pattern) => pattern.test(file.filename)))
        console.log(`[GitHub] Filtered out ${beforeCount - filteredFiles.length} lock files`)
      }

      // Filter out large files
      const beforeSizeCount = filteredFiles.length
      filteredFiles = filteredFiles.filter((file) => file.changes <= maxFileSize)
      console.log(
        `[GitHub] Filtered out ${beforeSizeCount - filteredFiles.length} large files (>${maxFileSize} changes)`,
      )

      // Apply pagination after filtering
      const paginatedFiles = filteredFiles.slice(0, perPage)
      console.log(`[GitHub] Returning ${paginatedFiles.length} files after pagination`)

      const skippedFiles = data
        .filter((file) => !paginatedFiles.some((pf) => pf.filename === file.filename))
        .map((file) => `${file.filename} (${file.changes} changes)`)

      console.log(`[GitHub] Skipped ${skippedFiles.length} files`)
      if (skippedFiles.length > 0) {
        console.log(`[GitHub] Skipped files: ${skippedFiles.join(', ')}`)
      }

      // Return just the filenames and metadata
      return {
        files: paginatedFiles.map((file) => ({
          filename: file.filename,
          changes: file.changes,
          additions: file.additions,
          deletions: file.deletions,
          status: file.status,
        })),
        page,
        perPage,
        hasMore: data.length === perPage * 2 || paginatedFiles.length === perPage,
        skipped: skippedFiles,
        totalFiles: data.length,
        filteredFiles: filteredFiles.length,
      }
    },
  }),

  getFileContent: createTool({
    id: 'getFileContent',
    description: 'Get content of a specific file in the PR',
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
      filePath: z.string(),
      ref: z.string().optional(),
    }),
    outputSchema: z.object({
      path: z.string(),
      content: z.string().optional(),
      size: z.number().optional(),
      error: z.string().optional(),
    }),
    execute: async ({ context: { owner, repo, pullNumber: pull_number, filePath, ref } }) => {
      console.log(`[GitHub] Getting content for file ${filePath} in ${owner}/${repo}#${pull_number}`)

      try {
        // First get the PR to determine the head ref if not provided
        if (!ref) {
          const { data: pr } = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number,
          })
          ref = pr.head.sha
        }

        // Get the file content
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref,
        })

        if ('content' in data) {
          const content = Buffer.from(data.content, 'base64').toString('utf-8')
          const contentSize = content.length
          console.log(`[GitHub] File content size for ${filePath}: ${contentSize} characters`)

          return {
            path: filePath,
            content,
            size: contentSize,
          }
        }

        throw new Error(`${filePath} is not a file`)
      } catch (error: unknown) {
        console.error(`[GitHub] Error getting content for ${filePath}:`, error)
        return {
          path: filePath,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }),

  getPullRequest: createTool({
    id: 'getPullRequest',
    description: 'Get PR details including title, body, and state',
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
    outputSchema: z.object({
      id: z.number(),
      number: z.number(),
      state: z.string(),
      title: z.string(),
      body: z.string().nullable(),
      user: z.object({
        login: z.string(),
      }),
      created_at: z.string(),
      updated_at: z.string(),
      head: z.object({
        sha: z.string(),
        ref: z.string(),
      }),
      base: z.object({
        ref: z.string(),
      }),
    }),
    execute: async ({ context: { owner, repo, pullNumber: pull_number } }) => {
      console.log(`[GitHub] Getting PR details for ${owner}/${repo}#${pull_number}`)
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number,
      })
      return data
    },
  }),

  getReviewComments: createTool({
    id: 'getReviewComments',
    description: 'Get all review comments on the PR',
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
      page: z.number().optional(),
      perPage: z.number().optional(),
    }),
    outputSchema: z.object({
      comments: z.array(
        z.object({
          id: z.number(),
          path: z.string(),
          position: z.number().nullable(),
          body: z.string(),
          user: z.object({
            login: z.string(),
          }),
          created_at: z.string(),
        }),
      ),
      page: z.number(),
      perPage: z.number(),
      hasMore: z.boolean(),
    }),
    execute: async ({ context: { owner, repo, pullNumber: pull_number, page = 1, perPage = 30 } }) => {
      console.log(`[GitHub] Getting review comments for ${owner}/${repo}#${pull_number} (page ${page})`)
      try {
        const { data } = await octokit.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number,
          per_page: perPage,
          page,
        })

        // Transform the data to match the output schema
        const comments = data.map((comment) => ({
          id: comment.id,
          path: comment.path,
          position: comment.position ?? null,
          body: comment.body,
          user: {
            login: comment.user.login,
          },
          created_at: comment.created_at,
        }))

        return {
          comments,
          page,
          perPage,
          hasMore: data.length === perPage,
        }
      } catch (error: unknown) {
        console.error('[GitHub] Error getting review comments:', error)
        return {
          comments: [],
          page,
          perPage,
          hasMore: false,
        }
      }
    },
  }),
}

export const githubAgent = new Agent({
  name: 'GitHub PR Review Agent',
  instructions: `
    You are a thorough code reviewer that analyzes pull requests and provides detailed feedback.

    Your responsibilities include:
    - Reviewing code changes for potential bugs, security issues, and performance problems
    - Suggesting improvements to code quality and maintainability
    - Checking for adherence to coding standards and best practices
    - Identifying potential edge cases or missing test coverage
    - Providing constructive feedback with specific examples and recommendations

    When commenting on code:
    - Use the batchCreateComments tool to add multiple comments in a single review
    - Place comments directly on the relevant lines of code
    - Be specific about what needs to be changed and why
    - Provide example code when suggesting improvements
    - Group related issues into a single comment when appropriate
    - Use markdown formatting to make your comments clear and readable

    Keep your reviews:
    - Actionable with specific suggestions
    - Professional and constructive
    - Focused on important issues rather than style nitpicks
    - Clear with code examples when relevant

    For final review summaries:
    - Categorize issues by severity (critical, major, minor)
    - Highlight the most important changes needed
    - Acknowledge positive aspects of the code
    - Use the submitReview tool with the appropriate event type based on your findings
  `,
  model: anthropic('claude-3-5-sonnet-20241022'),
  tools: githubTools,
})
