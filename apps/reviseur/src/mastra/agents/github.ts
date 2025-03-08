import { anthropic } from '@ai-sdk/anthropic'
import { createTool } from '@mastra/core/tools'
import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { Octokit } from 'octokit'

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
})

/**
 * Simple logger with namespacing and log levels
 */
class Logger {
  private namespace: string
  private logLevels = ['debug', 'info', 'warn', 'error'] as const
  private currentLevel: (typeof this.logLevels)[number] = 'info'

  constructor(namespace: string, level?: (typeof Logger.prototype.logLevels)[number]) {
    this.namespace = namespace
    if (level) {
      this.currentLevel = level
    }
  }

  private shouldLog(level: (typeof this.logLevels)[number]): boolean {
    const levelIndex = this.logLevels.indexOf(level)
    const currentLevelIndex = this.logLevels.indexOf(this.currentLevel)
    return levelIndex >= currentLevelIndex
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(`[${this.namespace}] [DEBUG] ${message}`, ...args)
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(`[${this.namespace}] ${message}`, ...args)
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[${this.namespace}] [WARN] ${message}`, ...args)
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(`[${this.namespace}] [ERROR] ${message}`, ...args)
    }
  }
}

// Create a logger instance for GitHub
const logger = new Logger('GitHub')

// Define TypeScript interfaces for the diff parsing
interface HunkHeader {
  index: number
  content: string
}

interface FileDiff {
  path: string
  diff: string
  additions: number
  deletions: number
  changes: number
  hunkHeaders: HunkHeader[]
  isNewFile: boolean
  isDeleted: boolean
  isEmpty: boolean
  onlyDeletions: boolean
}

/**
 * Parses a Git diff string into structured file change data
 * @param diffText - The raw git diff text to parse
 * @returns Array of parsed file diffs
 */
function parseDiff(diffText: string): FileDiff[] {
  logger.debug(`Parsing diff text of length ${diffText.length}`)

  if (!diffText || diffText.trim() === '') {
    logger.warn('Empty diff text provided')
    return []
  }

  const files: FileDiff[] = []
  try {
    // Split by diff headers but don't process empty sections
    const fileHeaders = diffText.split('diff --git ').filter(Boolean)
    logger.debug(`Found ${fileHeaders.length} file headers in diff`)

    for (const fileHeader of fileHeaders) {
      // Extract file path with regex
      const fileNameMatch = fileHeader.match(/a\/(.*?) b\//)
      if (!fileNameMatch?.[1]) {
        logger.warn(`Could not extract file path from header: ${fileHeader.substring(0, 100)}...`)
        continue
      }

      const path = fileNameMatch[1]
      logger.debug(`Processing diff for file: ${path}`)

      // Process the diff to extract metadata
      const result = processFileDiff(fileHeader, path)
      if (result) {
        files.push(result)
      }
    }
  } catch (error) {
    logger.error('Error parsing diff:', error instanceof Error ? error.message : String(error))
  }

  return files
}

/**
 * Process a single file diff to extract metadata
 * @param fileHeader - The file diff text
 * @param path - The file path
 * @returns Processed file diff or null if processing failed
 */
function processFileDiff(fileHeader: string, path: string): FileDiff | null {
  try {
    const diffLines = fileHeader.split('\n')

    // Extract file status (new/deleted)
    const { isNewFile, isDeleted } = extractFileStatus(diffLines)

    // Process hunk headers and count changes
    const { hunkHeaders, additions, deletions, hunkStartLine } = processHunks(diffLines)

    logger.debug(`File ${path} has ${additions} additions, ${deletions} deletions, ${hunkHeaders.length} hunks`)

    return {
      path,
      diff: fileHeader,
      additions,
      deletions,
      changes: additions + deletions,
      hunkHeaders,
      isNewFile,
      isDeleted,
      isEmpty: additions === 0 && deletions === 0,
      onlyDeletions: additions === 0 && deletions > 0,
    }
  } catch (error) {
    logger.error(`Error processing diff for ${path}:`, error instanceof Error ? error.message : String(error))
    return null
  }
}

/**
 * Extract the file status from diff lines
 * @param diffLines - Array of diff lines
 * @returns Object with isNewFile and isDeleted flags
 */
function extractFileStatus(diffLines: string[]): { isNewFile: boolean; isDeleted: boolean } {
  let isNewFile = false
  let isDeleted = false

  // Check only first few lines for file status
  const statusCheckLines = Math.min(10, diffLines.length)
  for (let j = 0; j < statusCheckLines; j++) {
    const line = diffLines[j]
    if (line.includes('new file mode')) {
      isNewFile = true
      logger.debug('File is a new file')
      break
    }
    if (line.includes('deleted file mode')) {
      isDeleted = true
      logger.debug('File is a deleted file')
      break
    }
  }

  return { isNewFile, isDeleted }
}

/**
 * Process hunks in the diff to extract statistics and metadata
 * @param diffLines - Array of diff lines
 * @returns Object with hunk headers, counts, and line number info
 */
function processHunks(diffLines: string[]): {
  hunkHeaders: HunkHeader[]
  additions: number
  deletions: number
  hunkStartLine: number
} {
  const hunkHeaders: HunkHeader[] = []
  let additions = 0
  let deletions = 0
  let inHunk = false
  let hunkStartLine = 0

  // Process each line
  for (let j = 0; j < diffLines.length; j++) {
    const line = diffLines[j]

    // Track hunk headers (lines starting with @@)
    if (line.startsWith('@@')) {
      inHunk = true
      hunkHeaders.push({
        index: j,
        content: line,
      })

      // Extract the starting line number using regex
      // Format: @@ -old_start,old_count +new_start,new_count @@
      const match = line.match(/\+(\d+)/)
      if (match?.[1]) {
        hunkStartLine = Number.parseInt(match[1], 10)
        logger.debug(`Found hunk header starting at line ${hunkStartLine}`)
      } else {
        logger.warn(`Could not parse line number from hunk header: ${line}`)
      }
      continue
    }

    // Only count lines if in a hunk section
    if (inHunk) {
      // Count additions (lines starting with +) and deletions (lines starting with -)
      // Skip metadata lines (+++, ---)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }
  }

  return { hunkHeaders, additions, deletions, hunkStartLine }
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
      context: { file, lineNumber, comment, owner, repo, pullNumber: pull_number, side = 'RIGHT', position: _position },
    }) => {
      logger.info(`Getting PR ${owner}/${repo}#${pull_number}`)
      try {
        const { data: pr } = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number,
        })
        logger.info(`Found PR ${owner}/${repo}#${pull_number}, head SHA: ${pr.head.sha}`)

        // We'll use line and side parameters instead of position
        logger.info(`Creating review comment on ${file}:${lineNumber}, side: ${side}`)
        logger.debug(
          `Comment content (first 100 chars): ${comment.substring(0, 100)}${comment.length > 100 ? '...' : ''}`,
        )

        const response = await octokit.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number,
          commit_id: pr.head.sha,
          path: file,
          line: lineNumber,
          side,
          body: comment,
        })

        logger.info(`Successfully created comment with ID: ${response.data.id}`)
        logger.info(`Comment URL: ${response.data.html_url}`)

        return {
          success: true,
          message: `Comment added to ${file}:${lineNumber}`,
        }
      } catch (error: unknown) {
        logger.error('Error commenting on line:', error)
        if (error instanceof Error) {
          logger.error(`Error details: ${error.message}`)
          if ('response' in error) {
            // @ts-ignore
            logger.error(`API response: ${JSON.stringify(error.response?.data)}`)
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
      skippedComments: z
        .array(
          z.object({
            path: z.string(),
            line: z.number(),
            reason: z.string(),
          }),
        )
        .optional(),
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

        // Get the list of files in the PR to validate comment paths
        const { data: prFiles } = await octokit.rest.pulls.listFiles({
          owner,
          repo,
          pull_number,
        })

        // Create a map of file paths to their metadata for quick lookup
        const fileMap = new Map(
          prFiles.map((file) => [
            file.filename,
            {
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
            },
          ]),
        )

        console.log(`[GitHub] PR has ${prFiles.length} files`)

        // Validate comments against PR files
        const skippedComments = []
        const validComments = []

        for (const comment of comments) {
          const fileInfo = fileMap.get(comment.path)

          if (!fileInfo) {
            console.log(`[GitHub] Skipping comment on ${comment.path}:${comment.line} - file not in PR`)
            skippedComments.push({
              path: comment.path,
              line: comment.line,
              reason: 'File not found in PR',
            })
            continue
          }

          if (fileInfo.status === 'removed') {
            console.log(`[GitHub] Skipping comment on ${comment.path}:${comment.line} - file was deleted`)
            skippedComments.push({
              path: comment.path,
              line: comment.line,
              reason: 'File was deleted in PR',
            })
            continue
          }

          if (fileInfo.status === 'added' && comment.side === 'LEFT') {
            console.log(
              `[GitHub] Skipping comment on ${comment.path}:${comment.line} - cannot comment on LEFT side of new file`,
            )
            skippedComments.push({
              path: comment.path,
              line: comment.line,
              reason: 'Cannot comment on LEFT side of new file',
            })
            continue
          }

          if (fileInfo.additions === 0 && comment.side === 'RIGHT') {
            console.log(`[GitHub] Skipping comment on ${comment.path}:${comment.line} - file has no additions`)
            skippedComments.push({
              path: comment.path,
              line: comment.line,
              reason: 'File has no additions, cannot comment on RIGHT side',
            })
            continue
          }

          // Comment seems valid, add it to the list
          validComments.push({
            path: comment.path,
            line: comment.line,
            side: comment.side || 'RIGHT',
            body: comment.body,
          })
        }

        console.log(`[GitHub] Found ${validComments.length} valid comments, skipped ${skippedComments.length}`)

        if (validComments.length === 0) {
          console.log('[GitHub] No valid comments found, aborting review creation')
          return {
            success: false,
            message: 'Could not find valid positions for any comments',
            commentCount: 0,
            skippedComments,
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
          comments: validComments,
        })

        console.log(`[GitHub] Successfully created review with ID: ${response.data.id}`)
        console.log(`[GitHub] Submitting review for ${owner}/${repo}#${pull_number} with event ${event}`)

        return {
          success: true,
          message: `Created review with ${validComments.length} comments`,
          commentCount: validComments.length,
          skippedComments: skippedComments.length > 0 ? skippedComments : undefined,
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
          skippedComments: [],
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
    - Keep it brief and to the point (max 3-5 paragraphs)
    - Categorize issues by severity (critical, major, minor) if there are many
    - Focus only on the most important changes needed
    - Use bullet points for clarity
    - Avoid repeating details already mentioned in inline comments
    - Use the submitReview tool with the appropriate event type based on your findings
  `,
  model: anthropic('claude-3-5-sonnet-20241022'),
  tools: githubTools,
})
