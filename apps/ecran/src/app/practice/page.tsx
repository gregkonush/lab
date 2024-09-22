import Editor from '@/components/editor'

export const dynamic = 'force-dynamic'

export default async function Practice() {
  return (
    <div className="flex flex-row h-[calc(100vh-70px)] w-full p-4">
      <div className="basis-1/2">
        <div className="p-4">
          <h1 className="text-2xl font-bold">Practice Area</h1>
          <p>Instructions or other content can go here.</p>
        </div>
      </div>
      <div className="basis-1/2 shrink-0">
        <Editor />
      </div>
    </div>
  )
}
