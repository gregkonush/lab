import { EmailTemplate } from '@/components/email-template'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: Request) {
  const body = await request.json()
  if (!body.email) {
    return Response.json({ error: 'Email is required' })
  }
  try {
    const data = await resend.emails.send({
      from: 'ProomptEng.AI <eng@proompteng.ai>',
      to: body.email,
      subject: 'Welcome to our app!',
      react: EmailTemplate({}),
      text: 'Welcome, traveller. We will let you know when our app is ready.',
    })

    return Response.json(data)
  } catch (error) {
    return Response.json({ error })
  }
}
