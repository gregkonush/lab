import { useCallback, useEffect, useRef, memo, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../lib/utils'
import 'mapbox-gl/dist/mapbox-gl.css'

interface BobaStore {
  id: string
  name: string
  coordinates: [number, number]
  rating: number
  address: string
}

const mockBobaStores: BobaStore[] = [
  {
    id: '1',
    name: 'Urban Ritual',
    coordinates: [-122.426, 37.553],
    rating: 4.8,
    address: '140 South B St, San Mateo, CA 94401',
  },
  {
    id: '2',
    name: 'Tea Hut',
    coordinates: [-122.4862, 37.7324],
    rating: 4.5,
    address: '1541 Sloat Blvd, San Francisco, CA 94132',
  },
  {
    id: '3',
    name: 'District Tea',
    coordinates: [-122.4194, 37.7749],
    rating: 4.3,
    address: '2154 Mission St, San Francisco, CA 94110',
  },
  {
    id: '4',
    name: 'Plentea',
    coordinates: [-122.4044, 37.7946],
    rating: 4.7,
    address: '341 Kearny St, San Francisco, CA 94108',
  },
  {
    id: '5',
    name: 'Boba Guys',
    coordinates: [-122.4194, 37.7649],
    rating: 4.0,
    address: '3491 19th St, San Francisco, CA 94110',
  },
  {
    id: '6',
    name: 'Purple Kow',
    coordinates: [-122.4862, 37.7857],
    rating: 4.5,
    address: '3620 Balboa St, San Francisco, CA 94121',
  },
  {
    id: '7',
    name: 'Little Sweet',
    coordinates: [-122.475, 37.779],
    rating: 4.2,
    address: '3836 Geary Blvd, San Francisco, CA',
  },
  {
    id: '8',
    name: 'Honeybear Boba',
    coordinates: [-122.4194, 37.7749],
    rating: 4.2,
    address: '801 22nd St, San Francisco, CA 94107',
  },
  {
    id: '9',
    name: 'Yi Fang Taiwan Fruit Tea',
    coordinates: [-122.4194, 37.7849],
    rating: 4.5,
    address: '950 E 3rd St Unit 2A, Los Angeles, CA 90013',
  },
  {
    id: '10',
    name: 'Lady Luck Cafe',
    coordinates: [-122.4064, 37.7946],
    rating: 4.5,
    address: '956 Grant Ave, San Francisco, CA 94108',
  },
  {
    id: '11',
    name: 'Boba Bliss',
    coordinates: [-122.1089, 37.4006],
    rating: 4.6,
    address: '685 San Antonio Rd Suite 15, Mountain View, CA 94040',
  },
  {
    id: '12',
    name: 'Ume Tea',
    coordinates: [-122.075, 37.3894],
    rating: 4.4,
    address: '220 Castro St, Mountain View, CA 94041',
  },
  {
    id: '13',
    name: 'Tea Era',
    coordinates: [-122.075, 37.3894],
    rating: 4.3,
    address: '271 Castro St, Mountain View, CA 94041',
  },
  {
    id: '14',
    name: 'Teaspoon',
    coordinates: [-122.075, 37.3894],
    rating: 4.2,
    address: '134A Castro St, Mountain View, CA 94041',
  },
  {
    id: '15',
    name: 'FENG CHA',
    coordinates: [-122.0891, 37.3894],
    rating: 4.8,
    address: '1040 Grant Rd Suite #350, Mountain View, CA 94040',
  },
  {
    id: '16',
    name: 'Happy Lemon',
    coordinates: [-122.075, 37.3894],
    rating: 4.0,
    address: '742 Villa St, Mountain View, CA 94041',
  },
  {
    id: '17',
    name: 'Alma Dessert',
    coordinates: [-122.0307, 37.3774],
    rating: 4.8,
    address: '165 S Murphy Ave Suite D, Sunnyvale, CA 94086',
  },
  {
    id: '18',
    name: 'Molly Tea',
    coordinates: [-122.0317, 37.3784],
    rating: 4.6,
    address: '605 E El Camino Real Suite 1, Sunnyvale, CA 94087',
  },
  {
    id: '19',
    name: 'TP TEA Sunnyvale',
    coordinates: [-122.0297, 37.3764],
    rating: 4.7,
    address: '567b E El Camino Real, Sunnyvale, CA 94087',
  },
  {
    id: '20',
    name: 'R&B Tea Sunnyvale',
    coordinates: [-122.0327, 37.3794],
    rating: 4.1,
    address: '568 E El Camino Real ste a, Sunnyvale, CA 94087',
  },
  {
    id: '21',
    name: 'Teazzi Tea Shop',
    coordinates: [-122.0287, 37.3754],
    rating: 4.2,
    address: '200 W McKinley Ave #105, Sunnyvale, CA 94086',
  },
  {
    id: '22',
    name: 'MOOMO TEA',
    coordinates: [-122.0337, 37.3804],
    rating: 4.6,
    address: '715 Sunnyvale Saratoga Rd, Sunnyvale, CA 94087',
  },
  {
    id: '23',
    name: 'Chun Yang Tea',
    coordinates: [-122.0277, 37.3744],
    rating: 4.0,
    address: '1120 Kifer Rd Suite C, Sunnyvale, CA 94086',
  },
  {
    id: '24',
    name: 'Sunright Tea Studio',
    coordinates: [-122.0347, 37.3814],
    rating: 4.4,
    address: '795 E El Camino Real, Sunnyvale, CA 94087',
  },
  {
    id: '25',
    name: 'Boba Drive',
    coordinates: [-122.0267, 37.3734],
    rating: 4.5,
    address: '677 Tasman Dr, Sunnyvale, CA 94089',
  },
  {
    id: '26',
    name: 'Pekoe',
    coordinates: [-122.0317, 37.3784],
    rating: 3.9,
    address: '939 W El Camino Real Suite 117, Sunnyvale, CA 94087',
  },
  {
    id: '27',
    name: 'Tastea Sunnyvale',
    coordinates: [-122.0327, 37.3794],
    rating: 4.2,
    address: '114 E El Camino Real, Sunnyvale, CA 94087',
  },
  {
    id: '28',
    name: 'Mr. Sun Tea Mountain View',
    coordinates: [-122.0891, 37.3894],
    rating: 4.1,
    address: '801 W El Camino Real A, Mountain View, CA 94040',
  },
]

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

    for (const store of mockBobaStores) {
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
    if (!mapContainer.current) return

    try {
      // Try to get user location first
      const location = await getUserLocation()

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: location,
        zoom: 12,
        maxZoom: 15,
        accessToken: token,
      })

      map.current.on('load', () => {
        clearMarkers()
        addUserLocationMarker(location)
        addBobaMarkers()
      })
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Failed to get location')

      // Fall back to showing all stores if location access fails
      const bounds = new mapboxgl.LngLatBounds()
      for (const store of mockBobaStores) {
        bounds.extend(store.coordinates)
      }

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        bounds: bounds,
        fitBoundsOptions: { padding: 50 },
        maxZoom: 15,
      })

      map.current.on('load', () => {
        clearMarkers()
        addBobaMarkers()
      })
    }

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.current.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
        trackUserLocation: true,
      }),
    )
  }, [getUserLocation, clearMarkers, addUserLocationMarker, addBobaMarkers, token])

  useEffect(() => {
    if (!map.current) {
      initializeMap()
    }

    return () => {
      if (map.current) {
        clearMarkers()
        map.current.remove()
        map.current = null
      }
    }
  }, [initializeMap, clearMarkers])

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" aria-label="Interactive map showing boba store locations" />
      <MapOverlay store={selectedStore} />
      {locationError && <div className="absolute top-4 left-4 p-4 bg-slate-900/90 rounded-lg text-slate-100 text-sm">{locationError}</div>}
    </div>
  )
}

export default memo(MapView)
