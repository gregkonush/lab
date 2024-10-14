'use client'

import { useEffect, useState } from 'react'
import styles from './typed-text.module.css'

interface TypedTextProps {
  text: string
  delaySeconds?: number
  totalDuration?: number
}

const TypedText: React.FC<TypedTextProps> = ({ text, delaySeconds = 7, totalDuration = 1.5 }) => {
  const [key, setKey] = useState(0)

  useEffect(() => {
    const timer = setInterval(
      () => {
        setKey((prevKey) => prevKey + 1)
      },
      totalDuration * 1000 + delaySeconds * 1000,
    )

    return () => clearInterval(timer)
  }, [totalDuration, delaySeconds])

  return (
    <span
      key={key}
      className={styles.typedText}
      style={
        {
          '--text-length': text.length,
          '--total-duration': `${totalDuration}s`,
        } as React.CSSProperties
      }
    >
      {text}
    </span>
  )
}

export default TypedText
