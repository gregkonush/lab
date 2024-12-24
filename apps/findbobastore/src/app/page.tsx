import { MapView } from '@/components/map-view'

export default async function Home() {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
  return (
    <main className="relative w-full h-screen">
      <div className="absolute top-4 left-4 z-10 bg-slate-900/50 px-4 py-2 rounded-lg">
        <h1 className="text-xl font-bold text-white">Find Boba Store</h1>
      </div>
      <MapView token={mapboxToken} />
    </main>
  )
}