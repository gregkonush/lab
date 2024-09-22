'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { useRef } from 'react'

function SpinningCube() {
  const meshRef = useRef<THREE.Mesh>(null)

  useFrame((_state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.3
      meshRef.current.rotation.y += delta * 0.3
    }
  })

  return (
    <RoundedBox args={[2, 2, 2]} radius={0.1} smoothness={4} ref={meshRef} scale={1.5}>
      <meshPhysicalMaterial
        color="#242424"
        metalness={0.8}
        roughness={0.001}
        reflectivity={100}
        clearcoat={1}
        clearcoatRoughness={1}
        emissive="#000000"
        emissiveIntensity={0.1}
      />
      <pointLight intensity={0.05} distance={50} color="#FFFFFF" />
    </RoundedBox>
  )
}

function ChangingAmbientLight() {
  const lightRef = useRef<THREE.AmbientLight>(null)

  useFrame((state) => {
    if (lightRef.current) {
      const time = state.clock.getElapsedTime()
      const r = Math.sin(time * 0.3) * 0.2 + 0.4
      const g = Math.sin(time * 0.4) * 0.1 + 0.3
      const b = Math.cos(time * 0.5) * 0.2 + 0.7
      lightRef.current.color.setRGB(r, g, b)
    }
  })

  return <ambientLight ref={lightRef} intensity={150} />
}

export function ThreeScene() {
  return (
    <Canvas camera={{ position: [0, 0, 5] }} dpr={[1, 2]}>
      <ChangingAmbientLight />
      <directionalLight position={[50, 100, 50]} intensity={1} color="#FFFFFF" />
      <SpinningCube />
    </Canvas>
  )
}
