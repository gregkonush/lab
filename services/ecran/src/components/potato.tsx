'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Music } from 'lucide-react'

const VEGETABLES = [
  { id: 1, delay: '0ms', scale: 1, type: 'potato', rotation: 6 },
  { id: 2, delay: '200ms', scale: 0.8, type: 'tomato', rotation: -8 },
  { id: 3, delay: '400ms', scale: 0.9, type: 'potato', rotation: 12 },
  { id: 4, delay: '600ms', scale: 0.7, type: 'tomato', rotation: -6 },
]

export function Potato() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const toggleMusic = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  return (
    <div className="relative flex h-full items-center justify-center">
      <Button
        onClick={toggleMusic}
        variant="outline"
        size="icon"
        className="absolute right-4 top-4"
        aria-label={`${isPlaying ? 'Stop' : 'Play'} music`}
      >
        <Music className={cn('h-4 w-4', isPlaying ? 'opacity-50' : 'opacity-100')} />
      </Button>

      <div className="relative grid grid-cols-2 gap-8">
        {VEGETABLES.map((veg) => (
          <div key={veg.id} className="relative" style={{ animationDelay: veg.delay }}>
            <div
              className={cn(
                'motion-ease-elastic motion-preset-bounce',
                veg.type === 'potato' ? 'motion-preset-float' : 'motion-preset-spin',
                'motion-duration-500',
                'animate-[pulse_500ms_ease-in-out_infinite]',
                veg.type === 'tomato' ? 'motion-preset-shake' : 'motion-preset-wobble',
                'rounded-full p-4',
                isPlaying && [`motion-rotate-loop-${veg.rotation}/mirror`, 'motion-duration-300', 'motion-ease-linear'],
              )}
            >
              <div
                className={cn(
                  'absolute inset-0 -z-10',
                  'rounded-full',
                  'animate-[ping_1s_ease-in-out_infinite]',
                  veg.type === 'potato' ? 'bg-indigo-500/20' : 'bg-red-500/20',
                  isPlaying && 'opacity-100',
                  !isPlaying && 'opacity-0',
                  'transition-opacity duration-300',
                )}
              />

              <div
                className="relative"
                style={{
                  transform: `scale(${veg.scale})`,
                  animationDelay: `calc(${veg.delay} + 100ms)`,
                }}
              >
                <Image
                  src={`/${veg.type}.png`}
                  alt={`Dancing ${veg.type}`}
                  width={150}
                  height={150}
                  className={cn(
                    veg.type === 'potato' ? 'motion-preset-wobble' : 'motion-preset-bounce',
                    'motion-duration-1500',
                    'motion-reduce:transform-none',
                    isPlaying && veg.type === 'potato'
                      ? 'animate-[bounce_500ms_ease-in-out_infinite]'
                      : 'animate-[spin_700ms_ease-in-out_infinite]',
                  )}
                  priority
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <audio ref={audioRef} src="/techno-beat.mp3" loop className="hidden">
        <track kind="captions" src="/techno-beat.vtt" srcLang="en" default />
      </audio>
    </div>
  )
}
