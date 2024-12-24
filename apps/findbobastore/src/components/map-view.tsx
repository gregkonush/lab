import { useCallback, memo, useState } from 'react'
import ReactMapGL, { Marker, NavigationControl, GeolocateControl } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { stores, type BobaStore } from '@/data/stores'
import 'mapbox-gl/dist/mapbox-gl.css'

function MapOverlay({ store }: { store: BobaStore | null }) {
  if (!store) return null

  return (
    <AnimatePresence>
      <motion.aside
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className={cn(
          'absolute bottom-4 left-4 p-4 bg-slate-900/40 rounded-lg shadow-lg',
          'backdrop-blur-sm border border-slate-800',
          'max-w-sm w-full z-10',
        )}
        aria-label="Store information"
      >
        <h3 className="text-lg font-semibold text-slate-100 mb-2">{store.name}</h3>
        <div className="text-sm text-slate-300 space-y-1">
          <p>Rating: {store.rating.toFixed(1)} ⭐️</p>
          <p>{store.address}</p>
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}

export function MapView({ token }: { token: string | undefined }) {
  console.log({ token })
  const [selectedStore, setSelectedStore] = useState<BobaStore | null>(null)
  const [viewState, setViewState] = useState({
    longitude: -122.4194,
    latitude: 37.7749,
    zoom: 12,
  })
  const [locationError, setLocationError] = useState<string | null>(null)

  const getUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setViewState((prev) => ({
          ...prev,
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
        }))
      },
      (error) => {
        setLocationError(error.message)
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      },
    )
  }, [])

  if (!token) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-slate-900 text-slate-100">
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-lg">Mapbox token is missing</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      <ReactMapGL
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        mapboxAccessToken={token}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        maxZoom={15}
        onLoad={() => {
          getUserLocation()
        }}
      >
        <NavigationControl />
        <GeolocateControl positionOptions={{ enableHighAccuracy: true }} trackUserLocation />

        {stores.map((store) => (
          <Marker
            key={store.id}
            longitude={store.coordinates[0]}
            latitude={store.coordinates[1]}
            onClick={(e) => {
              e.originalEvent.stopPropagation()
              setSelectedStore(store)
              setViewState((prev) => ({
                ...prev,
                longitude: store.coordinates[0],
                latitude: store.coordinates[1],
                zoom: 15,
              }))
            }}
          >
            <div className="text-4xl cursor-pointer" aria-label={`${store.name} location marker`}>
              🧋
            </div>
          </Marker>
        ))}

        {/* User location marker */}
        {viewState.longitude !== -122.4194 && (
          <Marker longitude={viewState.longitude} latitude={viewState.latitude}>
            <div className="text-4xl" aria-label="Your location">
              📍
            </div>
          </Marker>
        )}
      </ReactMapGL>
      <MapOverlay store={selectedStore} />
      {locationError && <div className="absolute top-4 left-4 p-4 bg-slate-900/90 rounded-lg text-slate-100 text-sm">{locationError}</div>}
    </div>
  )
}

export default memo(MapView)
