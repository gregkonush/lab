import { auth, signOut } from '@/auth'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChevronDown, UserIcon } from 'lucide-react'

export async function UserMenu() {
  const session = await auth()

  if (!session) return null

  const handleSignOut = async () => {
    'use server'
    await signOut()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="space-x-2 text-center px-1 rounded-2xl">
          <ChevronDown className="size-4" />
          <div className="text-base">{session.user?.name}</div>
          <UserIcon className="rounded-full border border-zinc-600 text-zinc-500 size-6" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href="/profile">Profile</a>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <form action={handleSignOut}>
            <button type="submit" className="w-full text-left">
              Sign Out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
