import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function ProfilePage() {
  const session = await auth()

  if (!session) {
    redirect('/sign-in')
  }

  return (
    <div className="container mx-auto p-4 max-w-screen-md">
      <h1 className="text-2xl font-bold mb-4 px-5">Profile</h1>
      <Card className="bg-inherit">
        <CardHeader>
          <CardTitle>User Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p><strong>Name:</strong> {session.user?.name || 'N/A'}</p>
            <p><strong>Email:</strong> {session.user?.email || 'N/A'}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
