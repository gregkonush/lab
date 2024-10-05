'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import * as THREE from 'three'
import { useRef, useMemo } from 'react'

function Cubie({ position }: { position: [number, number, number] }) {
  const { x, y, z } = { x: position[0], y: position[1], z: position[2] }

  const materials = useMemo(() => {
    const createMaterial = (color: string) =>
      new THREE.MeshStandardMaterial({
        color,
        metalness: 1,
        roughness: 0.15,
      })

    const metalMaterial = createMaterial('#888888') // Gray metal for internal faces

    return [
      x === 1 ? createMaterial('#FF0000') : metalMaterial, // Right face (+X) - Red
      x === -1 ? createMaterial('#0000FF') : metalMaterial, // Left face (-X) - Blue
      y === 1 ? createMaterial('#FFFF00') : metalMaterial, // Top face (+Y) - Yellow
      y === -1 ? createMaterial('#FFFFFF') : metalMaterial, // Bottom face (-Y) - White
      z === 1 ? createMaterial('#FFA500') : metalMaterial, // Front face (+Z) - Orange
      z === -1 ? createMaterial('#00FF00') : metalMaterial, // Back face (-Z) - Green
    ]
  }, [x, y, z])

  const geometry = useMemo(() => new THREE.BoxGeometry(0.95, 0.95, 0.95), [])

  return <mesh position={[x, y, z]} material={materials} geometry={geometry} />
}

function RubiksCube() {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((_state, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.x += delta * 0.3
      groupRef.current.rotation.y += delta * 0.3
    }
  })

  const positions = [-1, 0, 1]

  return (
    <group ref={groupRef} scale={1.5}>
      {positions.map((x) =>
        positions.map((y) => positions.map((z) => <Cubie key={`${x}${y}${z}`} position={[x, y, z]} />)),
      )}
    </group>
  )
}

export function ThreeScene() {
  return (
    <Canvas camera={{ position: [0, 0, 7] }} shadows>
      <RubiksCube />
      <Environment preset="city" />
      <OrbitControls enableZoom={false} />
    </Canvas>
  )
}
