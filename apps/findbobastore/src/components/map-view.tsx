import { useCallback, useEffect, useRef, memo, useState } from 'react'
import mapboxgl from 'mapbox-gl'
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
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [selectedStore, setSelectedStore] = useState<BobaStore | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [locationError, setLocationError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [mapError, setMapError] = useState<string | null>(null)

  const clearMarkers = useCallback(() => {
    for (const marker of markersRef.current) {
      marker.remove()
    }
    markersRef.current = []
  }, [])

  const addUserLocationMarker = useCallback((location: [number, number]) => {
    if (!map.current) return

    const el = document.createElement('div')
    el.className = 'user-location-marker'
    el.innerHTML = '📍'
    el.style.fontSize = '2rem'
    el.setAttribute('aria-label', 'Your location')

    const marker = new mapboxgl.Marker({ element: el }).setLngLat(location).addTo(map.current)
    markersRef.current.push(marker)
  }, [])

  const addBobaMarkers = useCallback(() => {
    if (!map.current) return

    for (const store of stores) {
      const el = document.createElement('div')
      el.className = 'boba-marker'
      el.innerHTML = '🧋'
      el.style.fontSize = '2rem'
      el.style.cursor = 'pointer'
      el.setAttribute('aria-label', `${store.name} location marker`)

      const marker = new mapboxgl.Marker({ element: el }).setLngLat(store.coordinates).addTo(map.current)

      el.addEventListener('click', () => {
        setSelectedStore(store)
        map.current?.flyTo({
          center: store.coordinates,
          zoom: 15,
          duration: 1500,
          essential: true,
        })
      })

      markersRef.current.push(marker)
    }
  }, [])

  const getUserLocation = useCallback(() => {
    return new Promise<[number, number]>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'))
        return
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve([position.coords.longitude, position.coords.latitude])
        },
        (error) => {
          reject(error)
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0,
        },
      )
    })
  }, [])

  const initializeMap = useCallback(async () => {
    console.log('initializeMap')
    console.log('token', token)
    if (!mapContainer.current) return
    if (!token) {
      setMapError('Mapbox token is missing')
      setIsLoading(false)
      return
    }

    try {
      if (map.current) {
        map.current.remove()
        map.current = null
      }

      mapboxgl.accessToken = token

      let initialCenter: [number, number]
      try {
        initialCenter = await getUserLocation()
      } catch (error) {
        console.warn('Failed to get user location:', error)
        initialCenter = [-122.4194, 37.7749] // Default to San Francisco
        setLocationError(error instanceof Error ? error.message : 'Failed to get location')
      }

      const mapInstance = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: initialCenter,
        zoom: 12,
        maxZoom: 15,
      })

      map.current = mapInstance

      mapInstance.on('load', () => {
        clearMarkers()
        if (initialCenter) {
          addUserLocationMarker(initialCenter)
        }
        addBobaMarkers()
        setIsLoading(false)
      })

      mapInstance.on('error', (e) => {
        console.error('Mapbox error:', e)
        setMapError('Failed to load map')
        setIsLoading(false)
      })

      mapInstance.addControl(new mapboxgl.NavigationControl(), 'top-right')
      mapInstance.addControl(
        new mapboxgl.GeolocateControl({
          positionOptions: {
            enableHighAccuracy: true,
          },
          trackUserLocation: true,
        }),
      )
    } catch (error) {
      console.error('Map initialization error:', error)
      setMapError(error instanceof Error ? error.message : 'Failed to initialize map')
      setIsLoading(false)
    }
  }, [token, getUserLocation, clearMarkers, addUserLocationMarker, addBobaMarkers])

  useEffect(() => {
    initializeMap()

    return () => {
      if (map.current) {
        clearMarkers()
        map.current.remove()
        map.current = null
      }
    }
  }, [initializeMap, clearMarkers])

  if (mapError) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-slate-900 text-slate-100">
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-lg">Failed to load map: {mapError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 bg-opacity-50 z-50">
          <div className="p-4 bg-slate-800 rounded-lg">
            <p className="text-slate-100">Loading map...</p>
          </div>
        </div>
      )}
      <div ref={mapContainer} className="w-full h-full" aria-label="Interactive map showing boba store locations" />
      <MapOverlay store={selectedStore} />
      {locationError && <div className="absolute top-4 left-4 p-4 bg-slate-900/90 rounded-lg text-slate-100 text-sm">{locationError}</div>}
    </div>
  )
}

export default memo(MapView)
