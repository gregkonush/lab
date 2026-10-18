export function workspaceRequestPath(guestPath: string): string {
  if (!guestPath.startsWith('/workspace/')) throw new Error('A workspace file path is required.')
  return guestPath.slice('/workspace'.length)
}
