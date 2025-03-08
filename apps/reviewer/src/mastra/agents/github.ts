import { anthropic } from '@ai-sdk/anthropic'
import { createTool } from '@mastra/core/tools'
import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { Octokit } from 'octokit'

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
})

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
    }),
    execute: async ({ context: { file, lineNumber, comment, owner, repo, pullNumber: pull_number } }) => {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number,
      })

      await octokit.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number,
        commit_id: pr.head.sha,
        path: file,
        line: lineNumber,
        body: comment,
      })
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
    execute: async ({ context: { body, event, owner, repo, pullNumber: pull_number } }) => {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number,
        body,
        event,
      })
    },
  }),

  getDiff: createTool({
    id: 'getDiff',
    description: 'Get the PR diff',
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
    execute: async ({ context: { owner, repo, pullNumber: pull_number } }) => {
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number,
        mediaType: {
          format: 'diff',
        },
      })
      return data
    },
  }),

  getFiles: createTool({
    id: 'getFiles',
    description: 'Get list of files changed in the PR',
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pullNumber: z.number(),
    }),
    execute: async ({ context: { owner, repo, pullNumber: pull_number } }) => {
      const { data } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number,
      })
      return data
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
    execute: async ({ context: { owner, repo, pullNumber: pull_number } }) => {
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
    }),
    execute: async ({ context: { owner, repo, pullNumber: pull_number } }) => {
      const { data } = await octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number,
      })
      return data
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

    Keep your reviews:
    - Actionable with specific suggestions
    - Professional and constructive
    - Focused on important issues rather than style nitpicks
    - Clear with code examples when relevant
  `,
  model: anthropic('claude-3-5-sonnet-20241022'),
  tools: githubTools,
})
