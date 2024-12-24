export interface BobaStore {
  id: string
  name: string
  coordinates: [number, number]
  rating: number
  address: string
}

export const stores: BobaStore[] = [
  {
    id: '1',
    name: 'Boba Bliss',
    coordinates: [-122.113011, 37.401621],
    rating: 10,
    address: '685 San Antonio Rd Suite 15, Mountain View, CA 94040',
  },
  {
    id: '2',
    name: 'Ume Tea',
    coordinates: [-122.079391, 37.393631],
    rating: 9,
    address: '220 Castro St, Mountain View, CA 94041',
  },
  {
    id: '3',
    name: 'Teaspoon',
    coordinates: [-122.078385, 37.394757],
    rating: 7,
    address: '134A Castro St, Mountain View, CA 94041',
  },
  {
    id: '4',
    name: 'Happy Lemon',
    coordinates: [-122.0786353, 37.3935868],
    rating: 5,
    address: '742 Villa St, Mountain View, CA 94041',
  },
  {
    id: '5',
    name: 'Yi Fang Taiwan Fruit Tea',
    coordinates: [-122.0783587, 37.3944675],
    rating: 5,
    address: '143 Castro St, Mountain View, CA 94041',
  },
  {
    id: '6',
    name: 'Molly Tea 茉莉奶白',
    coordinates: [-122.0398861, 37.3696433],
    rating: 9,
    address: '605 E El Camino Real Suite 1, Sunnyvale, CA 94087',
  },
  {
    id: '7',
    name: 'TP TEA Sunnyvale',
    coordinates: [-122.0384433, 37.3692649],
    rating: 9,
    address: '567b E El Camino Real, Sunnyvale, CA 94087',
  },
  {
    id: '8',
    name: 'MoonTea',
    coordinates: [-122.0407241, 37.3709747],
    rating: 8,
    address: '513 S Pastoria Ave, Sunnyvale, CA 94086',
  },
  {
    id: '9',
    name: 'Sunright Tea Studio - Sunnyvale',
    coordinates: [-122.0179472, 37.3562008],
    rating: 8,
    address: '795 E El Camino Real, Sunnyvale, CA 94087',
  },
  {
    id: '10',
    name: 'Tong Sui Desserts & Drinks (Sunnyvale)',
    coordinates: [-122.0076786, 37.3812265],
    rating: 9,
    address: '927 E Arques Ave #151, Sunnyvale, CA 94085',
  },
  {
    id: '11',
    name: 'MOOMO TEA',
    coordinates: [-122.033623, 37.3674971],
    rating: 7,
    address: '715 Sunnyvale Saratoga Rd, Sunnyvale, CA 94087',
  },
  {
    id: '12',
    name: 'Teazzi Tea Shop',
    coordinates: [-122.032146, 37.3742401],
    rating: 8,
    address: '200 W McKinley Ave #105, Sunnyvale, CA 94086',
  },
  {
    id: '13',
    name: 'Chun Yang Tea',
    coordinates: [-121.9998913, 37.3732914],
    rating: 7,
    address: '1120 Kifer Rd Suite C, Sunnyvale, CA 94086',
  },
  {
    id: '14',
    name: 'T% Coffee + Tea Santa Clara',
    coordinates: [-121.9812209, 37.3522062],
    rating: 8,
    address: '3030 El Camino Real, Santa Clara, CA 95051',
  },
  {
    id: '15',
    name: 'Meet Fresh Cupertino',
    coordinates: [-122.011207, 37.3244107],
    rating: 6,
    address: '19449 Stevens Creek Blvd STE 120, Cupertino, CA 95014',
  },
  {
    id: '16',
    name: 'ZERO& | Cupertino Village',
    coordinates: [-122.014669, 37.3357109],
    rating: 7,
    address: '10815 N Wolfe Rd Suite 102, Cupertino, CA 95014',
  },
  {
    id: '17',
    name: 'Wanpo Tea Shop',
    coordinates: [-122.054475, 37.3228851],
    rating: 9,
    address: '19319 Stevens Creek Blvd, Cupertino, CA 95014',
  },
  {
    id: '18',
    name: 'Chicha San Chen 吃茶三千',
    coordinates: [-122.0347858, 37.3225755],
    rating: 9,
    address: '20688 Stevens Creek Blvd, Cupertino, CA 95014',
  },
  {
    id: '19',
    name: 'Shang Yu Lin-Cupertino上宇林',
    coordinates: [-122.040335, 37.3367908],
    rating: 7,
    address: '20956 Homestead Rd, Cupertino, CA 95014',
  },
  {
    id: '20',
    name: 'Tea Top 台灣第一味',
    coordinates: [-122.012591, 37.308738],
    rating: 7,
    address: '6158 Bollinger Rd, San Jose, CA 95129',
  },
]
