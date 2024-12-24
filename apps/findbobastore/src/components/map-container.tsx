'use client'

import dynamic from 'next/dynamic'

const MapView = dynamic(() => import('./map-view'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center">
      <div className="text-lg">Loading map...</div>
    </div>
  ),
})

export function MapContainer({ token }: { token: string }) {
  return <MapView token={token} />
}
