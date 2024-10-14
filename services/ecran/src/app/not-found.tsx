import Image from 'next/image'
import styles from './not-found.module.css'

export default function NotFound() {
  return (
    <div className="text-center min-h-[calc(100vh-10rem)] flex flex-col justify-center items-center">
      <div className={styles.wiggle}>
        <Image className="rounded-full shadow-lg" src="/404.jpg" alt="404" width={120} height={120} />
      </div>
      <div className="text-lg text-gray-400 mt-6 max-w-md">
        Oops! Our cute little seal couldn&apos;t find what you&apos;re looking for. Maybe it swam away? 🌊
      </div>
    </div>
  )
}
