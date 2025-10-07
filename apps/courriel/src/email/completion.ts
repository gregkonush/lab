import type { AppConfig } from '../config'
import type { WorkflowCompletion } from '../schema/completion'

export interface CompletionEmail {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html: string
  replyTo?: string
  headers: Record<string, string>
}

const EMAIL_TO_ANNOTATION = 'courriel/email-to'
const EMAIL_CC_ANNOTATION = 'courriel/email-cc'
const EMAIL_BCC_ANNOTATION = 'courriel/email-bcc'
const EMAIL_FROM_ANNOTATION = 'courriel/email-from'
const EMAIL_SUBJECT_ANNOTATION = 'courriel/email-subject'
const EMAIL_REPLY_TO_ANNOTATION = 'courriel/email-reply-to'

const candidateParameterNames = ['notify_to', 'notify-to', 'email_to', 'email-to', 'emailRecipients']

const splitAddresses = (raw: string | undefined): string[] => {
  if (!raw) {
    return []
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const unique = (values: string[]): string[] => {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const value of values) {
    const normalized = value.toLowerCase()
    if (seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    deduped.push(value)
  }

  return deduped
}

const formatDateTime = (iso: string | undefined): string | null => {
  if (!iso) {
    return null
  }

  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    return iso
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(parsed)
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const resolveParameterRecipients = (completion: WorkflowCompletion): string[] => {
  const parameters = completion.spec?.arguments?.parameters ?? []

  for (const candidate of candidateParameterNames) {
    const match = parameters.find((parameter) => parameter.name.toLowerCase() === candidate.toLowerCase())
    if (match?.value) {
      const addresses = splitAddresses(match.value)
      if (addresses.length > 0) {
        return addresses
      }
    }
  }

  return []
}

const resolveRecipients = (
  completion: WorkflowCompletion,
  fallbackRecipients: string[],
): { to: string[]; cc: string[]; bcc: string[] } => {
  const annotations = completion.metadata.annotations ?? {}

  const toCandidates = splitAddresses(annotations[EMAIL_TO_ANNOTATION])
  const parameterRecipients = resolveParameterRecipients(completion)
  const to = unique([
    ...toCandidates,
    ...parameterRecipients,
    ...(toCandidates.length === 0 && parameterRecipients.length === 0 ? fallbackRecipients : []),
  ])

  const cc = unique(splitAddresses(annotations[EMAIL_CC_ANNOTATION]))
  const bcc = unique(splitAddresses(annotations[EMAIL_BCC_ANNOTATION]))

  return { to, cc, bcc }
}

const resolveFromAddress = (completion: WorkflowCompletion, defaultFrom: string): string => {
  const annotations = completion.metadata.annotations ?? {}
  return annotations[EMAIL_FROM_ANNOTATION]?.trim() || defaultFrom
}

const resolveReplyTo = (completion: WorkflowCompletion): string | undefined => {
  const annotations = completion.metadata.annotations ?? {}
  const replyTo = annotations[EMAIL_REPLY_TO_ANNOTATION]?.trim()
  return replyTo && replyTo.length > 0 ? replyTo : undefined
}

const buildSubject = (completion: WorkflowCompletion, subjectPrefix: string | null, defaultPhase: string): string => {
  const annotations = completion.metadata.annotations ?? {}
  const annotatedSubject = annotations[EMAIL_SUBJECT_ANNOTATION]?.trim()
  if (annotatedSubject && annotatedSubject.length > 0) {
    return annotatedSubject
  }

  const prefix = subjectPrefix ? `${subjectPrefix.trim()} ` : ''
  return `${prefix}Workflow ${completion.metadata.name} ${defaultPhase}`.trim()
}

const buildSummaryLines = (completion: WorkflowCompletion): string[] => {
  const lines = [
    `Workflow: ${completion.metadata.name}`,
    `Namespace: ${completion.metadata.namespace}`,
    `UID: ${completion.metadata.uid}`,
    `Status: ${completion.status.phase}`,
  ]

  if (completion.status.progress) {
    lines.push(`Progress: ${completion.status.progress}`)
  }

  if (completion.status.message) {
    lines.push(`Message: ${completion.status.message}`)
  }

  const startedAt = formatDateTime(completion.status.startedAt)
  const finishedAt = formatDateTime(completion.status.finishedAt)

  if (startedAt) {
    lines.push(`Started: ${startedAt}`)
  }

  if (finishedAt) {
    lines.push(`Finished: ${finishedAt}`)
  }

  return lines
}

const linesToHtml = (lines: string[]): string => {
  const items = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')

  return `<ul>${items}</ul>`
}

const linesToText = (lines: string[]): string => lines.join('\n')

export const buildCompletionEmail = (completion: WorkflowCompletion, config: AppConfig): CompletionEmail => {
  const { to, cc, bcc } = resolveRecipients(completion, config.resend.fallbackRecipients)
  const from = resolveFromAddress(completion, config.resend.from)
  const replyTo = resolveReplyTo(completion)
  const subject = buildSubject(completion, config.email.subjectPrefix, completion.status.phase)

  const summaryLines = buildSummaryLines(completion)

  const html = `
    <h1>${escapeHtml(subject)}</h1>
    ${linesToHtml(summaryLines)}
    <p>This notification was sent by courriel from the argo.workflows.completions topic.</p>
  `
    .replace(/\s+/g, ' ')
    .trim()

  const text = `${subject}\n\n${linesToText(summaryLines)}\n\nThis notification was sent by courriel.`

  return {
    from,
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    replyTo,
    headers: {
      'X-Courriel-Workflow-UID': completion.metadata.uid,
      'X-Courriel-Workflow-Name': completion.metadata.name,
    },
  }
}
