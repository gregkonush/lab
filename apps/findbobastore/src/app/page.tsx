import { MapContainer } from '@/components/map-container'

export default function Home() {
  return (
    <main className="relative w-full h-screen">
      <div className="absolute top-4 left-4 z-10 bg-slate-900/80 px-4 py-2 rounded-lg">
        <h1 className="text-xl font-bold text-white">Find Boba Store</h1>
      </div>
      <MapContainer />
    </main>
  )
}
